const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/init');
const {
  formatUser,
  findUserByTagOrPublicId,
  createUser,
  verifyPassword,
  createSession,
  getUserByToken,
  deleteSession,
  deleteAllUserSessions,
  generateId
} = require('../db/users');
const { checkAndUnlock, getUserAchievements, getStats } = require('../db/achievements');

const router = express.Router();

router.get('/health', async (req, res) => {
  res.json({ ok: true, service: 'Таскли', version: '1.0', time: new Date().toISOString() });
});

router.get('/', async (req, res) => {
  res.json({
    name: 'Таскли API',
    version: '1.0',
    hint: 'Это REST API, не веб-страница. Откройте сайт: http://localhost:3000',
    auth: {
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      me: 'GET /api/auth/me (Bearer token)'
    },
    examples: [
      'POST /api/auth/login — body: { "email", "password" }',
      'GET /api/bootstrap — загрузка данных после входа (нужен токен)',
      'GET /api/stats — статистика',
      'GET /api/achievements — достижения'
    ]
  });
});

function getTokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.method === 'GET' && req.query.token) return String(req.query.token);
  return null;
}

async function authMiddleware(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const user = await getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Сессия истекла' });
  }
  req.user = user;
  req.token = token;
  next();
}

function parseJson(val, fallback) {
  try {
    return JSON.parse(val || '');
  } catch {
    return fallback;
  }
}

function rowToTask(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    userId: row.owner_id,
    projectId: row.project_id || null,
    title: row.title,
    description: row.description || '',
    status: row.status,
    priority: row.priority,
    date: row.date,
    type: row.type || 'task',
    assignees: parseJson(row.assignees_json, []),
    shareWithFriends: !!row.share_with_friends,
    attachments: parseJson(row.attachments_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToProject(row, memberIds) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    ownerId: row.owner_id,
    memberIds: memberIds.filter(id => id !== row.owner_id),
    createdAt: row.created_at
  };
}

function rowToNote(row) {
  return {
    id: row.id,
    title: row.title || '',
    content: row.content || '',
    color: row.color || '#fff9c4',
    tags: parseJson(row.tags_json, []),
    pinned: !!row.pinned,
    attachments: parseJson(row.attachments_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getProjectMembers(projectId) {
  const db = getDb();
  return (await db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(projectId))
    .map(r => r.user_id);
}

async function userCanAccessProject(userId, projectId) {
  const db = getDb();
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return false;
  if (project.owner_id === userId) return true;
  const member = await db.prepare(
    'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, userId);
  return !!member;
}

async function areFriends(db, userId, friendId) {
  return !!(await db.prepare(
    'SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?'
  ).get(userId, friendId));
}

async function filterFriendIds(db, userId, ids) {
  const filtered = [];
  for (const id of (ids || [])) {
    if (id !== userId && await areFriends(db, userId, id)) {
      filtered.push(id);
    }
  }
  return Array.from(new Set(filtered));
}

async function fetchRelatedUsers(db, userId) {
  const ids = new Set([userId]);

  (await db.prepare('SELECT friend_id AS id FROM friendships WHERE user_id = ?').all(userId))
    .forEach(r => ids.add(r.id));
  (await db.prepare('SELECT from_user_id AS id FROM friend_requests WHERE to_user_id = ? AND status = ?').all(userId, 'pending'))
    .forEach(r => ids.add(r.id));
  (await db.prepare('SELECT to_user_id AS id FROM friend_requests WHERE from_user_id = ? AND status = ?').all(userId, 'pending'))
    .forEach(r => ids.add(r.id));
  (await db.prepare(`
    SELECT DISTINCT pm2.user_id AS id FROM project_members pm1
    JOIN project_members pm2 ON pm2.project_id = pm1.project_id
    WHERE pm1.user_id = ?
  `).all(userId)).forEach(r => ids.add(r.id));
  (await db.prepare(`
    SELECT DISTINCT p.owner_id AS id FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ?
  `).all(userId)).forEach(r => ids.add(r.id));

  const idList = [...ids];
  if (!idList.length) return [];
  const placeholders = idList.map(() => '?').join(',');
  return (await db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).all(...idList)).map(formatUser);
}

async function getFriendRequestsForUser(db, userId) {
  const incoming = (await db.prepare(`
    SELECT from_user_id FROM friend_requests WHERE to_user_id = ? AND status = 'pending'
  `).all(userId)).map(r => r.from_user_id);

  const outgoing = (await db.prepare(`
    SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending'
  `).all(userId)).map(r => r.to_user_id);

  return { incoming, outgoing };
}

// ——— Auth ———
router.post('/auth/register', async (req, res) => {
  const { username, email, password, personalDataConsent } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  if (!personalDataConsent) {
    return res.status(400).json({ error: 'Требуется согласие на обработку персональных данных' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }

  const db = getDb();
if (await (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.trim()))) {
    return res.status(400).json({ error: 'Email уже занят' });
  }

  const user = await createUser({
    username,
    email,
    password,
    personalDataConsent
  });
  const token = await createSession(user.id);
  res.json({ token, user });
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const db = getDb();
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim());
  if (!row || !verifyPassword(row, password)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const user = formatUser(row);
  const token = await createSession(user.id);
  res.json({ token, user });
});

router.post('/auth/logout', authMiddleware, async (req, res) => {
  await deleteSession(req.token);
  res.json({ ok: true });
});

router.get('/auth/me', authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

router.post('/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Введите email' });

  const db = getDb();
  const row = await db.prepare('SELECT id, email FROM users WHERE lower(email) = ?').get(email);
  if (row) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000;
await db.prepare(`      INSERT INTO password_codes (user_id, code, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at
`).run(row.id, code, expiresAt);

    const { sendPasswordResetEmail } = require('./email');
    try {
      await sendPasswordResetEmail(row.email, code);
    } catch (e) {
      console.error('Reset email error:', e.message);
    }
  }

  res.json({
    ok: true,
    message: 'Если аккаунт с таким email существует, код отправлен на почту'
  });
});

router.post('/auth/reset-password', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const password = req.body?.password;

  if (!email || !code) return res.status(400).json({ error: 'Введите email и код' });
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }

  const db = getDb();
  const row = await db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!row) return res.status(400).json({ error: 'Неверный код или email' });

  const stored = await db.prepare('SELECT code, expires_at FROM password_codes WHERE user_id = ?').get(row.id);
  if (!stored || Date.now() > stored.expires_at) {
await db.prepare('DELETE FROM password_codes WHERE user_id = ?').run(row.id);
    return res.status(400).json({ error: 'Код просрочен или не запрашивался' });
  }
  if (String(stored.code) !== code) {
    return res.status(400).json({ error: 'Неверный код' });
  }

  const hash = bcrypt.hashSync(password, 10);
await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.id);
await db.prepare('DELETE FROM password_codes WHERE user_id = ?').run(row.id);
  await deleteAllUserSessions(row.id);
  res.json({ ok: true });
});

function isAdminUser(user) {
  const admins = String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(String(user?.email || '').toLowerCase());
}

// ——— Bootstrap ———
router.get('/bootstrap', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.id;

  const taskRows = await db.prepare(`
    SELECT t.* FROM tasks t
    LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
    WHERE t.owner_id = ? OR pm.user_id IS NOT NULL OR t.assignees_json LIKE ?
  `).all(userId, userId, `%"${userId}"%`);

  const projectRows = await db.prepare(`
    SELECT DISTINCT p.* FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id
    WHERE p.owner_id = ? OR pm.user_id = ?
  `).all(userId, userId);

  const projects = [];
  for (const p of projectRows) {
    projects.push(rowToProject(p, await getProjectMembers(p.id)));
  }

  const friendIds = (await db.prepare(
    'SELECT friend_id FROM friendships WHERE user_id = ?'
  ).all(userId)).map(r => r.friend_id);

  const { incoming, outgoing } = await getFriendRequestsForUser(db, userId);

  const achievements = await getUserAchievements(userId);
  const stats = await getStats(userId);
  const users = await fetchRelatedUsers(db, userId);

  const noteRows = await db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC')
    .all(userId);

  res.json({
    tasks: taskRows.map(rowToTask),
    projects,
    friends: friendIds,
    friendRequests: { incoming, outgoing },
    achievements,
    stats,
    users,
    notes: noteRows.map(rowToNote)
  });
});

// ——— Profile ———
router.patch('/users/me', authMiddleware, async (req, res) => {
  const db = getDb();
  const { username, status, phone, bio, avatar, preferences } = req.body || {};
  const updates = [];
  const values = [];

  if (username !== undefined) {
    updates.push('username = ?');
    values.push(username);
  }
  if (status !== undefined) {
    updates.push('status = ?');
    values.push(status);
  }
  if (phone !== undefined) {
    updates.push('phone = ?');
    values.push(phone);
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    values.push(bio);
  }
  if (avatar !== undefined) {
    updates.push('avatar_json = ?');
    values.push(JSON.stringify(avatar));
  }
  if (preferences !== undefined) {
    updates.push('preferences_json = ?');
    values.push(JSON.stringify(preferences));
  }

  if (updates.length) {
    values.push(req.user.id);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const newAchievements = checkAndUnlock(req.user.id);
  res.json({ user: formatUser(row), newAchievements });
});

router.post('/users/password/request-code', authMiddleware, async (req, res) => {
  const db = getDb();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;
await db.prepare(`    INSERT INTO password_codes (user_id, code, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at
`).run(req.user.id, code, expiresAt);

  const row = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  const { sendPasswordCodeEmail } = require('./email');
  try {
    const result = await sendPasswordCodeEmail(row.email, code);
    res.json({
      ok: true,
      message: result.sent
        ? 'Код отправлен на ваш email'
        : 'SMTP не настроен — код выведен в консоль сервера'
    });
  } catch (e) {
    console.error('Email error:', e.message);
    res.status(500).json({ error: 'Не удалось отправить письмо. Проверьте настройки SMTP.' });
  }
});

router.post('/users/password', authMiddleware, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { code, password } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Введите код из письма' });
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }

  const db = getDb();
await db.prepare('SELECT code, expires_at FROM password_codes WHERE user_id = ?').get(req.user.id);
  if (!stored || Date.now() > stored.expires_at) {
await db.prepare('DELETE FROM password_codes WHERE user_id = ?').run(req.user.id);
    return res.status(400).json({ error: 'Код просрочен или не запрашивался' });
  }
  if (String(stored.code) !== String(code).trim()) {
    return res.status(400).json({ error: 'Неверный код' });
  }

  const hash = bcrypt.hashSync(password, 10);
await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
await db.prepare('DELETE FROM password_codes WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.delete('/users/me', authMiddleware, async (req, res) => {
  const { email, password } = req.body || {};
  const db = getDb();
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Пользователь не найден' });

  const confirmEmail = String(email || '').trim().toLowerCase();
  if (confirmEmail !== String(row.email || '').trim().toLowerCase()) {
    return res.status(400).json({ error: 'Email не совпадает с аккаунтом' });
  }
  if (!password || !verifyPassword(row, password)) {
    return res.status(400).json({ error: 'Неверный пароль' });
  }

  await deleteAllUserSessions(req.user.id);

  const userUploadsDir = path.join(__dirname, '..', 'data', 'uploads', req.user.id);
  if (fs.existsSync(userUploadsDir)) {
    try {
      fs.rmSync(userUploadsDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Uploads cleanup:', e.message);
    }
  }

await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ——— Support ———
router.get('/support/tickets', authMiddleware, async (req, res) => {
  const db = getDb();
  const admin = isAdminUser(req.user);
  const rows = admin
    ? await db.prepare(`
        SELECT t.*, u.username, u.email, u.discriminator
        FROM support_tickets t
        JOIN users u ON u.id = t.user_id
        ORDER BY t.updated_at DESC
      `).all()
    : await db.prepare(`
        SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC
      `).all(req.user.id);

  res.json({
    tickets: rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      category: r.category,
      subject: r.subject,
      description: r.description,
      status: r.status,
      adminReply: r.admin_reply || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: admin ? {
        username: r.username,
        email: r.email,
        tag: `${r.username}#${r.discriminator}`
      } : undefined
    })),
    isAdmin: admin
  });
});
router.post('/support/tickets', authMiddleware, async (req, res) => {
  const { category, subject, description } = req.body || {};
  const subj = String(subject || '').trim();
  const desc = String(description || '').trim();
  const cat = String(category || 'bug').trim();

  if (!subj || subj.length < 3) return res.status(400).json({ error: 'Тема минимум 3 символа' });
  if (!desc || desc.length < 10) return res.status(400).json({ error: 'Описание минимум 10 символов' });

  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();
await db.prepare(`    INSERT INTO support_tickets (id, user_id, category, subject, description, status, admin_reply, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', '', ?, ?)
`).run(id, req.user.id, cat, subj, desc, now, now);

  res.json({ ok: true, id });
});

router.patch('/support/tickets/:id', authMiddleware, async (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }

  const { status, adminReply } = req.body || {};
  const db = getDb();
  const ticket = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });

  const updates = [];
  const values = [];
  if (status !== undefined) {
    updates.push('status = ?');
    values.push(String(status));
  }
  if (adminReply !== undefined) {
    updates.push('admin_reply = ?');
    values.push(String(adminReply));
  }
  updates.push('updated_at = ?');
  values.push(new Date().toISOString());

  if (updates.length > 1) {
    values.push(req.params.id);
    await db.prepare(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  res.json({ ok: true });
});

// ——— Tasks ———
router.post('/tasks', authMiddleware, async (req, res) => {
  const db = getDb();
  const task = req.body;
  const id = task.id || generateId();
  const now = new Date().toISOString();

if (task.projectId && !await userCanAccessProject(req.user.id, task.projectId)) {
    return res.status(403).json({ error: 'Нет доступа к проекту' });
  }

await db.prepare(`    INSERT INTO tasks (id, owner_id, project_id, title, description, status, priority, date, type, assignees_json, share_with_friends, attachments_json, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, project_id = EXCLUDED.project_id, title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, priority = EXCLUDED.priority, date = EXCLUDED.date, type = EXCLUDED.type, assignees_json = EXCLUDED.assignees_json, share_with_friends = EXCLUDED.share_with_friends, attachments_json = EXCLUDED.attachments_json, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at
`).run(
    id,
    req.user.id,
    task.projectId || null,
    task.title,
    task.description || '',
    task.status || 'pending',
    task.priority || 'medium',
    task.date || null,
    task.type || 'task',
    JSON.stringify(task.assignees || []),
    task.shareWithFriends ? 1 : 0,
    JSON.stringify(task.attachments || []),
    task.createdAt || now,
    now
  );

  const newAchievements = await checkAndUnlock(req.user.id);
  const row = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.json({ task: rowToTask(row), newAchievements });
});

router.put('/tasks/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const task = req.body;
  const now = new Date().toISOString();
if (task.projectId && !await userCanAccessProject(req.user.id, task.projectId)) {
    return res.status(403).json({ error: 'Нет доступа к проекту' });
  }

await db.prepare(`    INSERT INTO tasks (id, owner_id, project_id, title, description, status, priority, date, type, assignees_json, share_with_friends, attachments_json, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, priority = EXCLUDED.priority, date = EXCLUDED.date, type = EXCLUDED.type, assignees_json = EXCLUDED.assignees_json, share_with_friends = EXCLUDED.share_with_friends, attachments_json = EXCLUDED.attachments_json, updated_at = EXCLUDED.updated_at
`).run(
    req.params.id,
    task.ownerId || req.user.id,
    task.projectId || null,
    task.title,
    task.description || '',
    task.status || 'pending',
    task.priority || 'medium',
    task.date || null,
    task.type || 'task',
    JSON.stringify(task.assignees || []),
    task.shareWithFriends ? 1 : 0,
    JSON.stringify(task.attachments || []),
    task.createdAt || now,
    now
  );

  const newAchievements = await checkAndUnlock(req.user.id);
  const row = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json({ task: rowToTask(row), newAchievements });
});

router.delete('/tasks/:id', authMiddleware, async (req, res) => {
await getDb().prepare('DELETE FROM tasks WHERE id = ? AND owner_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/tasks/sync', authMiddleware, async (req, res) => {
  const { tasks } = req.body || {};
  if (!Array.isArray(tasks)) return res.status(400).json({ error: 'Неверный формат' });
  const db = getDb();
  for (const task of tasks) {
    const id = task.id || generateId();
    const now = new Date().toISOString();
await db.prepare(`      INSERT INTO tasks (id, owner_id, project_id, title, description, status, priority, date, type, assignees_json, share_with_friends, attachments_json, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, project_id = EXCLUDED.project_id, title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, priority = EXCLUDED.priority, date = EXCLUDED.date, type = EXCLUDED.type, assignees_json = EXCLUDED.assignees_json, share_with_friends = EXCLUDED.share_with_friends, attachments_json = EXCLUDED.attachments_json, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at
`).run(
      id,
      task.ownerId || req.user.id,
      task.projectId || null,
      task.title,
      task.description || '',
      task.status || 'pending',
      task.priority || 'medium',
      task.date || null,
      task.type || 'task',
      JSON.stringify(task.assignees || []),
      task.shareWithFriends ? 1 : 0,
      JSON.stringify(task.attachments || []),
      task.createdAt || now,
      now
    );
  }
  await checkAndUnlock(req.user.id);
  res.json({ ok: true });
});

// ——— Projects ———
router.post('/projects', authMiddleware, async (req, res) => {
  const db = getDb();
  const { name, description, memberIds } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Укажите название' });

  const id = req.body.id || `project_${generateId()}`;
  const now = new Date().toISOString();

await db.prepare(`    INSERT INTO projects (id, owner_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)
`).run(id, req.user.id, name, description || '', now);

  const members = new Set([req.user.id, ...filterFriendIds(db, req.user.id, memberIds || [])]);
  const insertMember = db.prepare(
    'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT (project_id, user_id) DO NOTHING'
  );
  for (const uid of members) {
await insertMember.run(id, uid);
  }

await db.prepare(`    INSERT INTO mind_maps (project_id, nodes_json, edges_json, updated_at, updated_by) ON CONFLICT (project_id) DO NOTHING
    VALUES (?, '[]', '[]', ?, ?)
`).run(id, now, req.user.id);

  const newAchievements = await checkAndUnlock(req.user.id);
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.json({
    project: rowToProject(row, await getProjectMembers(id)),
    newAchievements
  });
});

router.put('/projects/:id', authMiddleware, async (req, res) => {
  const db = getDb();
if (!await userCanAccessProject(req.user.id, req.params.id)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const { name, description, memberIds } = req.body || {};
  if (name) {
    await db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?')
      .run(name, description || '', req.params.id);
  }
  if (memberIds) {
    const project = await db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(req.params.id);
    await db.prepare('DELETE FROM project_members WHERE project_id = ?').run(req.params.id);
    const members = new Set([project.owner_id, ...filterFriendIds(db, req.user.id, memberIds || [])]);
    const insertMember = db.prepare(
      'INSERT INTO project_members (project_id, user_id) VALUES (?, ?)'
    );
    for (const uid of members) {
await insertMember.run(req.params.id, uid);
    }
  }
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  const newAchievements = await checkAndUnlock(req.user.id);
  res.json({
    project: rowToProject(row, await getProjectMembers(req.params.id)),
    newAchievements
  });
});

router.post('/friends/request', authMiddleware, async (req, res) => {
  const db = getDb();
  const query = (req.body.query || req.body.email || '').trim();
  if (!query) return res.status(400).json({ error: 'Введите ник#тег или ID' });

  const targetRow = await findUserByTagOrPublicId(query);
  if (!targetRow) return res.status(404).json({ error: 'Пользователь не найден' });
  if (targetRow.id === req.user.id) {
    return res.status(400).json({ error: 'Нельзя добавить себя' });
  }

  const existingFriend = await db.prepare(
    'SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?'
  ).get(req.user.id, targetRow.id);
  if (existingFriend) {
    return res.status(400).json({ error: 'Уже в друзьях' });
  }

  const pending = await db.prepare(`    SELECT * FROM friend_requests
    WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
    AND status = 'pending'
`).get(req.user.id, targetRow.id, targetRow.id, req.user.id);

  if (pending) {
    return res.status(400).json({ error: 'Заявка уже отправлена' });
  }

  const id = generateId();
  const now = new Date().toISOString();
await db.prepare(`    INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
`).run(id, req.user.id, targetRow.id, now);

  const senderRow = await db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
  const { notifyFriendRequest } = require('../db/push');
  notifyFriendRequest(targetRow.id, senderRow?.username || 'Пользователь')
    .catch(err => console.warn('Friend request push:', err.message));

  res.json({ success: true, target: formatUser(targetRow) });
});

router.post('/friends/respond', authMiddleware, async (req, res) => {
  const db = getDb();
  const { userId, accept } = req.body;
  const request = await db.prepare(`SELECT * FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`).get(userId, req.user.id);

  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });

  await db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?')
    .run(accept ? 'accepted' : 'declined', request.id);

  if (accept) {
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, friend_id) DO NOTHING')
      .run(req.user.id, userId, now);
    await db.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, friend_id) DO NOTHING')
      .run(userId, req.user.id, now);
  }

  const newAchievements = await checkAndUnlock(req.user.id);
  if (accept) await checkAndUnlock(userId);
  res.json({ ok: true, newAchievements });
});

router.post('/friends/cancel', authMiddleware, async (req, res) => {
  const { userId } = req.body;
await getDb().prepare(`    DELETE FROM friend_requests
    WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
`).run(req.user.id, userId);
  res.json({ ok: true });
});

router.delete('/friends/:friendId', authMiddleware, async (req, res) => {
  const db = getDb();
  const fid = req.params.friendId;
await db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').run(req.user.id, fid);
await db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').run(fid, req.user.id);
  res.json({ ok: true });
});

router.get('/friends', authMiddleware, async (req, res) => {
  const db = getDb();
  const friendIds = (await db.prepare(
    'SELECT friend_id FROM friendships WHERE user_id = ?'
  ).all(req.user.id)).map(r => r.friend_id);

const { incoming, outgoing } = await getFriendRequestsForUser(db, req.user.id);
const users = await fetchRelatedUsers(db, req.user.id);

  res.json({
    friends: friendIds,
    incoming,
    outgoing,
    users
  });
});

// ——— Messages ———
router.get('/messages/:friendId', authMiddleware, async (req, res) => {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT * FROM messages
    WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
    ORDER BY created_at ASC
  `).all(req.user.id, req.params.friendId, req.params.friendId, req.user.id);

  res.json(rows.map(r => ({
    id: r.id,
    from: r.from_user_id,
    to: r.to_user_id,
    text: r.text,
    attachments: parseJson(r.attachments_json, []),
    timestamp: r.created_at
  })));
});

router.post('/messages/:friendId', authMiddleware, async (req, res) => {
  const db = getDb();
  const { text, attachments } = req.body;
  if (!text?.trim() && !(attachments || []).length) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }

  await db.prepare(
    'SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?'
  ).get(req.user.id, req.params.friendId);
  if (!friend) return res.status(403).json({ error: 'Не в друзьях' });

  const id = generateId();
  const now = Date.now();
  const bodyText = text?.trim() || 'Вложение';
await db.prepare(`    INSERT INTO messages (id, from_user_id, to_user_id, text, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?)
`).run(id, req.user.id, req.params.friendId, bodyText, JSON.stringify(attachments || []), now);

  const senderRow = await db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
  const senderName = senderRow?.username || 'Друг';
  const { notifyNewMessage } = require('../db/push');
  notifyNewMessage(req.params.friendId, senderName, bodyText, req.user.id)
    .catch(err => console.warn('Message push:', err.message));

  const newAchievements = await checkAndUnlock(req.user.id);
  res.json({
    message: {
      id,
      from: req.user.id,
      to: req.params.friendId,
      text: bodyText,
      attachments: attachments || [],
      timestamp: now
    },
    newAchievements
  });
});

router.get('/messages/feed', authMiddleware, async (req, res) => {
  const db = getDb();
  const since = parseInt(req.query.since, 10) || 0;
await db.prepare(`    SELECT m.*, u.username as sender_name
    FROM messages m
    JOIN users u ON u.id = m.from_user_id
    WHERE m.to_user_id = ? AND m.created_at > ?
    ORDER BY m.created_at ASC
`).all(req.user.id, since);

await db.prepare(`    SELECT cm.id, cm.conversation_id, cm.from_user_id, cm.text, cm.created_at,
           u.username as sender_name, c.name as conv_name
    FROM conversation_messages cm
    JOIN conversation_members mem ON mem.conversation_id = cm.conversation_id AND mem.user_id = ?
    JOIN users u ON u.id = cm.from_user_id
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.created_at > ? AND cm.from_user_id != ?
    ORDER BY cm.created_at ASC
`).all(req.user.id, since, req.user.id);

  const direct = rows.map(r => ({
    id: r.id,
    from: r.from_user_id,
    to: r.to_user_id,
    text: r.text,
    timestamp: r.created_at,
    senderName: r.sender_name,
    kind: 'direct'
  }));

  const group = convRows.map(r => ({
    id: r.id,
    from: r.from_user_id,
    conversationId: r.conversation_id,
    text: r.text,
    timestamp: r.created_at,
    senderName: r.sender_name,
    convName: r.conv_name,
    kind: 'group'
  }));

  res.json({ messages: [...direct, ...group].sort((a, b) => a.timestamp - b.timestamp) });
});

router.get('/messages/inbox', authMiddleware, async (req, res) => {
  const db = getDb();
  const since = parseInt(req.query.since, 10) || (Date.now() - 7 * 24 * 60 * 60 * 1000);
await db.prepare(`    SELECT m.id, m.from_user_id, m.text, m.created_at, u.username as sender_name
    FROM messages m
    JOIN users u ON u.id = m.from_user_id
    WHERE m.to_user_id = ? AND m.created_at > ?
    ORDER BY m.created_at DESC
    LIMIT 40
`).all(req.user.id, since);

await db.prepare(`    SELECT cm.id, cm.conversation_id, cm.from_user_id, cm.text, cm.created_at,
           u.username as sender_name, c.name as conv_name
    FROM conversation_messages cm
    JOIN conversation_members mem ON mem.conversation_id = cm.conversation_id AND mem.user_id = ?
    JOIN users u ON u.id = cm.from_user_id
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.created_at > ? AND cm.from_user_id != ?
    ORDER BY cm.created_at DESC
    LIMIT 40
`).all(req.user.id, since, req.user.id);

  res.json({
    messages: [
      ...rows.map(r => ({
        id: r.id,
        from: r.from_user_id,
        text: r.text,
        timestamp: r.created_at,
        senderName: r.sender_name,
        kind: 'direct'
      })),
      ...convRows.map(r => ({
        id: r.id,
        from: r.from_user_id,
        conversationId: r.conversation_id,
        text: r.text,
        timestamp: r.created_at,
        senderName: r.sender_name,
        convName: r.conv_name,
        kind: 'group'
      }))
    ].sort((a, b) => b.timestamp - a.timestamp)
  });
});

// ——— Group conversations ———
router.get('/conversations', authMiddleware, async (req, res) => {
  const db = getDb();
  const rows = await db.prepare(`    SELECT c.* FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id
    WHERE m.user_id = ?
    ORDER BY c.created_at DESC
`).all(req.user.id);

  const memberStmt = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?');
  const convs = [];
  for (const row of rows) {
    const members = await memberStmt.all(row.id);
    convs.push({
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      memberIds: members.map(r => r.user_id),
      createdAt: row.created_at
    });
  }
  res.json({ conversations: convs });
});

router.post('/conversations', authMiddleware, async (req, res) => {
  const db = getDb();
  const { name, memberIds } = req.body || {};
  const title = String(name || '').trim();
  if (!title) return res.status(400).json({ error: 'Укажите название беседы' });

const friends = await filterFriendIds(db, req.user.id, memberIds || []);
  if (!friends.length) {
    return res.status(400).json({ error: 'Выберите хотя бы одного друга' });
  }

  const id = generateId();
  const now = Date.now();
  await db.prepare('INSERT INTO conversations (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, title, req.user.id, now);

  const insertMember = db.prepare(
    'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'
  );
  const members = new Set([req.user.id, ...friends]);
  for (const uid of members) {
    await insertMember.run(id, uid);
  }

  res.json({
    conversation: {
      id,
      name: title,
      ownerId: req.user.id,
      memberIds: [...members],
      createdAt: now
    }
  });
});

router.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
  const db = getDb();
  await db.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Нет доступа' });

await db.prepare(`    SELECT cm.*, u.username as sender_name
    FROM conversation_messages cm
    JOIN users u ON u.id = cm.from_user_id
    WHERE cm.conversation_id = ?
    ORDER BY cm.created_at ASC
`).all(req.params.id);

  res.json({
    messages: rows.map(r => ({
      id: r.id,
      from: r.from_user_id,
      conversationId: r.conversation_id,
      text: r.text,
      attachments: parseJson(r.attachments_json, []),
      timestamp: r.created_at,
      senderName: r.sender_name
    }))
  });
});

router.post('/conversations/:id/messages', authMiddleware, async (req, res) => {
  const db = getDb();
  const { text, attachments } = req.body || {};
  if (!text?.trim() && !(attachments || []).length) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }

  await db.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Нет доступа' });

  const id = generateId();
  const now = Date.now();
  const bodyText = text?.trim() || 'Вложение';
await db.prepare(`    INSERT INTO conversation_messages (id, conversation_id, from_user_id, text, attachments_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
`).run(id, req.params.id, req.user.id, bodyText, JSON.stringify(attachments || []), now);

  const senderRow = await db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
  res.json({
    message: {
      id,
      from: req.user.id,
      conversationId: req.params.id,
      text: bodyText,
      attachments: attachments || [],
      timestamp: now,
      senderName: senderRow?.username || 'Участник'
    }
  });
});

// ——— Stats ———
router.get('/stats', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.id;

  const completedByDay = await db.prepare(`    SELECT date(updated_at) as day, COUNT(*) as count FROM tasks
    WHERE status = 'completed' AND (owner_id = ? OR assignees_json LIKE ?)
    GROUP BY date(updated_at)
    ORDER BY day DESC LIMIT 30
`).all(userId, `%"${userId}"%`);

  const byPriority = await db.prepare(`    SELECT priority, COUNT(*) as count FROM tasks
    WHERE owner_id = ? OR assignees_json LIKE ?
    GROUP BY priority
`).all(userId, `%"${userId}"%`);

  const byStatus = await db.prepare(`    SELECT status, COUNT(*) as count FROM tasks
    WHERE owner_id = ? OR assignees_json LIKE ?
    GROUP BY status
`).all(userId, `%"${userId}"%`);

  const projectsProgress = await db.prepare(`    SELECT p.id, p.name,
    SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
    COUNT(t.id) as total
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.owner_id = ? OR pm.user_id = ?
    GROUP BY p.id
`).all(userId, userId);

  res.json({
    summary: await getStats(userId),
    completedByDay,
    byPriority,
    byStatus,
    projectsProgress
  });
});

// ——— Achievements ———
router.get('/achievements', authMiddleware, async (req, res) => {
  await checkAndUnlock(req.user.id);
  res.json({ achievements: await getUserAchievements(req.user.id) });
});

// ——— Mind maps ———
router.get('/mindmaps/:projectId', authMiddleware, async (req, res) => {
if (!await userCanAccessProject(req.user.id, req.params.projectId)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const db = getDb();
  let row = await db.prepare('SELECT * FROM mind_maps WHERE project_id = ?').get(req.params.projectId);
  if (!row) {
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO mind_maps (project_id, nodes_json, edges_json, updated_at, updated_by)
      VALUES (?, '[]', '[]', ?, ?)
    `).run(req.params.projectId, now, req.user.id);
    row = await db.prepare('SELECT * FROM mind_maps WHERE project_id = ?').get(req.params.projectId);
  }
  res.json({
    projectId: row.project_id,
    nodes: parseJson(row.nodes_json, []),
    edges: parseJson(row.edges_json, []),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  });
});

router.put('/mindmaps/:projectId', authMiddleware, async (req, res) => {
if (!await userCanAccessProject(req.user.id, req.params.projectId)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const { nodes, edges } = req.body;
  const now = new Date().toISOString();
  await getDb().prepare(`
    INSERT INTO mind_maps (project_id, nodes_json, edges_json, updated_at, updated_by)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id) DO UPDATE SET nodes_json = EXCLUDED.nodes_json, edges_json = EXCLUDED.edges_json, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
  `).run(
    req.params.projectId,
    JSON.stringify(nodes || []),
    JSON.stringify(edges || []),
    now,
    req.user.id
  );
  const newAchievements = await checkAndUnlock(req.user.id);
  res.json({ ok: true, updatedAt: now, newAchievements });
});

// ——— Notes ———
router.get('/notes', authMiddleware, async (req, res) => {
  const rows = await getDb().prepare(
    'SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC'
  ).all(req.user.id);
  res.json(rows.map(rowToNote));
});

router.post('/notes', authMiddleware, async (req, res) => {
  const db = getDb();
  const { title, content, color, tags, pinned, attachments } = req.body || {};
  const id = generateId();
  const now = new Date().toISOString();
await db.prepare(`    INSERT INTO notes (id, user_id, title, content, color, tags_json, pinned, attachments_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    id,
    req.user.id,
    (title || '').trim(),
    content || '',
    color || '#fff9c4',
    JSON.stringify(tags || []),
    pinned ? 1 : 0,
    JSON.stringify(attachments || []),
    now,
    now
  );
  const newAchievements = checkAndUnlock(req.user.id);
  await res.json({ note: rowToNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(id)), newAchievements });
});

router.put('/notes/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Заметка не найдена' });

  const { title, content, color, tags, pinned, attachments } = req.body || {};
  const now = new Date().toISOString();
await db.prepare(`    UPDATE notes SET title = ?, content = ?, color = ?, tags_json = ?, pinned = ?, attachments_json = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
`).run(
    title !== undefined ? String(title).trim() : existing.title,
    content !== undefined ? content : existing.content,
    color !== undefined ? color : existing.color,
    tags !== undefined ? JSON.stringify(tags) : existing.tags_json,
    pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
    attachments !== undefined ? JSON.stringify(attachments) : existing.attachments_json,
    now,
    req.params.id,
    req.user.id
  );
  const row = await db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  res.json({ note: rowToNote(row) });
});

router.delete('/notes/:id', authMiddleware, async (req, res) => {
  const result = await getDb().prepare('DELETE FROM notes WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!(result.rowCount || 0)) return res.status(404).json({ error: 'Заметка не найдена' });
  res.json({ ok: true });
});

// ——— Uploads & shared tasks ———
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

router.post('/uploads', authMiddleware, async (req, res) => {
  const { fileName, mimeType, contentBase64 } = req.body || {};
  if (!fileName || !contentBase64) return res.status(400).json({ error: 'Нет файла' });
  const safeName = String(fileName).replace(/[^\w.\-()а-яА-ЯёЁ ]+/g, '_').slice(0, 120);
  const fileId = generateId();
  const userDir = path.join(UPLOADS_DIR, req.user.id);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const diskName = `${fileId}_${safeName}`;
  const filePath = path.join(userDir, diskName);
  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Файл больше 5 МБ' });
  fs.writeFileSync(filePath, buffer);
  res.json({
    id: fileId,
    name: safeName,
    mimeType: mimeType || 'application/octet-stream',
    size: buffer.length,
    url: `/api/uploads/${req.user.id}/${diskName}`
  });
});

router.get('/uploads/:userId/:fileName', authMiddleware, async (req, res) => {
  if (req.user.id !== req.params.userId) {
    await getDb().prepare(
      'SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?'
    ).get(req.user.id, req.params.userId);
    if (!isFriend) return res.status(403).json({ error: 'Нет доступа' });
  }
  const filePath = path.join(UPLOADS_DIR, req.params.userId, req.params.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл не найден' });
  const ext = path.extname(req.params.fileName).toLowerCase();
  const mimeMap = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain'
  };
  if (mimeMap[ext]) res.type(mimeMap[ext]);
  res.sendFile(filePath);
});

router.get('/friends/:friendId/shared-tasks', authMiddleware, async (req, res) => {
  const db = getDb();
  const friendId = req.params.friendId;
  await db.prepare(
    'SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?'
  ).get(req.user.id, friendId);
  if (!isFriend) return res.status(403).json({ error: 'Не в друзьях' });

await db.prepare(`    SELECT * FROM tasks WHERE owner_id = ? AND share_with_friends = 1 AND status != 'completed'
    ORDER BY date ASC
`).all(friendId);
  res.json(rows.map(rowToTask));
});

// ——— Push notifications ———
const {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription
} = require('../db/push');

router.get('/push/vapid-key', async (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post('/push/subscribe', authMiddleware, async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'Неверная подписка' });
  }
  saveSubscription(req.user.id, subscription);
  res.json({ ok: true });
});

router.delete('/push/subscribe', authMiddleware, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Укажите endpoint' });
  removeSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

// ——— Users lookup ———
router.get('/users/search', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const row = await findUserByTagOrPublicId(q);
  if (!row) return res.json({ users: [] });
  res.json({ users: [formatUser(row)] });
});

module.exports = { router, authMiddleware };
