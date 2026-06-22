import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bcrypt from 'bcryptjs';
import { dbGet, dbAll, dbRun, parseJson } from './sql.js';
import {
  formatUser,
  findUserByTagOrPublicId,
  createUser,
  verifyPassword,
  createSession,
  deleteSession,
  deleteAllUserSessions,
  generateId
} from './users.js';
import { checkAndUnlock, getUserAchievements, getStats } from './achievements.js';
import {
  rowToTask,
  rowToProject,
  rowToNote,
  getProjectMembers,
  userCanAccessProject,
  filterFriendIds,
  fetchRelatedUsers,
  getFriendRequestsForUser,
  isAdminUser,
  authMiddleware
} from './helpers.js';
import webPush from 'web-push';
import { sendPasswordCodeEmail, sendPasswordResetEmail } from './email.js';

const app = new Hono().basePath('/api');

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

app.use('*', async (c, next) => {
  if (!c.env.DB) {
    return c.json({
      error: 'База D1 не подключена. Выполните: npm run db:migrate:remote и redeploy через wrangler pages deploy'
    }, 503);
  }
  await next();
});

function getVapidPublicKey(env) {
  return env.VAPID_PUBLIC_KEY || '';
}

let webPushConfigured = false;
function ensureWebPushConfigured(env) {
  if (!webPushConfigured) {
    const pubKey = env.VAPID_PUBLIC_KEY;
    const privKey = env.VAPID_PRIVATE_KEY;
    if (pubKey && privKey) {
      webPush.setVapidDetails('mailto:noreply@taskly.app', pubKey, privKey);
      webPushConfigured = true;
    }
  }
}

async function saveSubscription(d1, userId, subscription) {
  const id = subscription.endpoint.slice(-40);
  const now = new Date().toISOString();
  await dbRun(
    d1,
    `INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, keys_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, subscription.endpoint, JSON.stringify(subscription.keys), now]
  );
}

async function removeSubscription(d1, userId, endpoint) {
  await dbRun(d1, 'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [
    userId,
    endpoint
  ]);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sendWebPush(env, d1, targetUserId, title, body, tag, data) {
  const subs = await dbAll(
    d1,
    'SELECT * FROM push_subscriptions WHERE user_id = ?',
    [targetUserId]
  );
  if (!subs.length) return;

  ensureWebPushConfigured(env);
  if (!webPushConfigured) return;

  const payload = JSON.stringify({ title, body, icon: '/icons/icon-192.png', badge: '/icons/badge.png', tag, data });

  for (const sub of subs) {
    try {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: JSON.parse(sub.keys_json || '{}')
      };
      await webPush.sendNotification(pushSub, payload, { TTL: 86400 });
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        await dbRun(d1, 'DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
      }
    }
  }
}

async function storeNotification(d1, userId, title, body, tag, data) {
  const id = generateId();
  const now = Date.now();
  await dbRun(
    d1,
    `INSERT INTO notifications (id, user_id, title, body, tag, data_json, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, userId, title, body, tag, JSON.stringify(data || {}), now]
  );
}

async function notifyNewMessage(env, d1, targetUserId, senderName, text, senderId) {
  await storeNotification(d1, targetUserId, 'Новое сообщение', `${senderName}: ${(text || '').slice(0, 100)}`, 'message', { fromUserId: senderId, kind: 'message' });
  await sendWebPush(env, d1, targetUserId, 'Новое сообщение', `${senderName}: ${(text || '').slice(0, 100)}`, 'message', { fromUserId: senderId, kind: 'message' });
}

async function notifyFriendRequest(env, d1, targetUserId, senderName, senderId) {
  await storeNotification(d1, targetUserId, 'Запрос в друзья', `${senderName} хочет добавить вас в друзья`, 'friend_request', { fromUserId: senderId, kind: 'friend_request' });
  await sendWebPush(env, d1, targetUserId, 'Запрос в друзья', `${senderName} хочет добавить вас в друзья`, 'friend_request', { fromUserId: senderId, kind: 'friend_request' });
}

function estimateBase64Size(base64) {
  const padding = (base64.match(/=+$/) || [''])[0].length;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// ——— Health & info ———
app.get('/health', (c) => {
  return c.json({ ok: true, service: 'Таскли', version: '1.0', time: new Date().toISOString() });
});

app.get('/', (c) => {
  return c.json({
    name: 'Таскли API',
    version: '1.0',
    hint: 'Это REST API, не веб-страница.',
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

// ——— Auth ———
app.post('/auth/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, email, password, personalDataConsent } = body || {};
  if (!username || !email || !password) {
    return c.json({ error: 'Заполните все поля' }, 400);
  }
  if (!personalDataConsent) {
    return c.json({ error: 'Требуется согласие на обработку персональных данных' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: 'Пароль минимум 6 символов' }, 400);
  }

  const d1 = c.env.DB;
  const existing = await dbGet(d1, 'SELECT 1 AS ok FROM users WHERE email = ?', [email.trim()]);
  if (existing) {
    return c.json({ error: 'Email уже занят' }, 400);
  }

  const user = await createUser(d1, {
    username: username.trim(),
    email: email.trim(),
    password,
    personalDataConsent: true
  });
  const token = await createSession(d1, user.id);
  return c.json({ token, user });
});

app.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body || {};
  const d1 = c.env.DB;
  const row = await dbGet(d1, 'SELECT * FROM users WHERE email = ?', [(email || '').trim()]);
  if (!row || !verifyPassword(row, password)) {
    return c.json({ error: 'Неверный email или пароль' }, 401);
  }
  const user = formatUser(row);
  const token = await createSession(d1, user.id);
  return c.json({ token, user });
});

app.post('/auth/logout', authMiddleware, async (c) => {
  await deleteSession(c.env.DB, c.get('token'));
  return c.json({ ok: true });
});

app.get('/auth/me', authMiddleware, (c) => {
  return c.json({ user: c.get('user') });
});

app.post('/auth/forgot-password', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase();
  if (!email) return c.json({ error: 'Введите email' }, 400);

  const d1 = c.env.DB;
  const row = await dbGet(d1, 'SELECT id, email FROM users WHERE lower(email) = ?', [email]);
  if (row) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000;
    await dbRun(
      d1,
      `INSERT OR REPLACE INTO password_codes (user_id, code, expires_at) VALUES (?, ?, ?)`,
      [row.id, code, expiresAt]
    );
    try {
      await sendPasswordResetEmail(c.env, row.email, code);
    } catch (e) {
      console.error('Reset email error:', e.message);
    }
  }

  return c.json({
    ok: true,
    message: 'Если аккаунт с таким email существует, код отправлен на почту'
  });
});

app.post('/auth/reset-password', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase();
  const code = String(body?.code || '').trim();
  const password = body?.password;

  if (!email || !code) return c.json({ error: 'Введите email и код' }, 400);
  if (!password || password.length < 6) {
    return c.json({ error: 'Пароль минимум 6 символов' }, 400);
  }

  const d1 = c.env.DB;
  const row = await dbGet(d1, 'SELECT * FROM users WHERE lower(email) = ?', [email]);
  if (!row) return c.json({ error: 'Неверный код или email' }, 400);

  const stored = await dbGet(d1, 'SELECT code, expires_at FROM password_codes WHERE user_id = ?', [row.id]);
  if (!stored || Date.now() > stored.expires_at) {
    await dbRun(d1, 'DELETE FROM password_codes WHERE user_id = ?', [row.id]);
    return c.json({ error: 'Код просрочен или не запрашивался' }, 400);
  }
  if (String(stored.code) !== code) {
    return c.json({ error: 'Неверный код' }, 400);
  }

  const hash = bcrypt.hashSync(password, 10);
  await dbRun(d1, 'UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.id]);
  await dbRun(d1, 'DELETE FROM password_codes WHERE user_id = ?', [row.id]);
  await deleteAllUserSessions(d1, row.id);
  return c.json({ ok: true });
});

// ——— Bootstrap ———
app.get('/bootstrap', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;

  const taskRows = await dbAll(
    d1,
    `SELECT t.* FROM tasks t
     LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
     WHERE t.owner_id = ? OR pm.user_id IS NOT NULL OR t.assignees_json LIKE ?`,
    [userId, userId, `%"${userId}"%`]
  );

  const projectRows = await dbAll(
    d1,
    `SELECT DISTINCT p.* FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id
     WHERE p.owner_id = ? OR pm.user_id = ?`,
    [userId, userId]
  );

  const projects = await Promise.all(
    projectRows.map(async (p) => {
      const members = await getProjectMembers(d1, p.id);
      return rowToProject(p, members);
    })
  );

  const friendRows = await dbAll(
    d1,
    'SELECT friend_id FROM friendships WHERE user_id = ?',
    [userId]
  );
  const friendIds = friendRows.map(r => r.friend_id);

  const { incoming, outgoing } = await getFriendRequestsForUser(d1, userId);
  const achievements = await getUserAchievements(d1, userId);
  const stats = await getStats(d1, userId);
  const users = await fetchRelatedUsers(d1, userId);

  const noteRows = await dbAll(
    d1,
    'SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC',
    [userId]
  );

  return c.json({
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
app.patch('/users/me', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { username, status, phone, bio, avatar, preferences } = body || {};

  const updates = [];
  const params = [];

  if (username !== undefined) {
    updates.push('username = ?');
    params.push(username);
  }
  if (status !== undefined) {
    updates.push('status = ?');
    params.push(status);
  }
  if (phone !== undefined) {
    updates.push('phone = ?');
    params.push(phone);
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    params.push(bio);
  }
  if (avatar !== undefined) {
    updates.push('avatar_json = ?');
    params.push(JSON.stringify(avatar));
  }
  if (preferences !== undefined) {
    updates.push('preferences_json = ?');
    params.push(JSON.stringify(preferences));
  }

  if (updates.length) {
    params.push(userId);
    await dbRun(d1, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  const row = await dbGet(d1, 'SELECT * FROM users WHERE id = ?', [userId]);
  const newAchievements = await checkAndUnlock(d1, userId);
  return c.json({ user: formatUser(row), newAchievements });
});

app.post('/users/password/request-code', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await dbRun(
    d1,
    `INSERT OR REPLACE INTO password_codes (user_id, code, expires_at) VALUES (?, ?, ?)`,
    [userId, code, expiresAt]
  );

  const row = await dbGet(d1, 'SELECT email FROM users WHERE id = ?', [userId]);
  try {
    const result = await sendPasswordCodeEmail(c.env, row.email, code);
    return c.json({
      ok: true,
      message: result.sent
        ? 'Код отправлен на ваш email'
        : 'SMTP не настроен — код выведен в консоль сервера'
    });
  } catch (e) {
    console.error('Email error:', e.message);
    return c.json({ error: 'Не удалось отправить письмо. Проверьте настройки SMTP.' }, 500);
  }
});

app.post('/users/password', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { code, password } = body || {};

  if (!code) return c.json({ error: 'Введите код из письма' }, 400);
  if (!password || password.length < 6) {
    return c.json({ error: 'Пароль минимум 6 символов' }, 400);
  }

  const stored = await dbGet(d1, 'SELECT code, expires_at FROM password_codes WHERE user_id = ?', [userId]);
  if (!stored || Date.now() > stored.expires_at) {
    await dbRun(d1, 'DELETE FROM password_codes WHERE user_id = ?', [userId]);
    return c.json({ error: 'Код просрочен или не запрашивался' }, 400);
  }
  if (String(stored.code) !== String(code).trim()) {
    return c.json({ error: 'Неверный код' }, 400);
  }

  const hash = bcrypt.hashSync(password, 10);
  await dbRun(d1, 'UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
  await dbRun(d1, 'DELETE FROM password_codes WHERE user_id = ?', [userId]);
  return c.json({ ok: true });
});

app.delete('/users/me', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body || {};

  const row = await dbGet(d1, 'SELECT * FROM users WHERE id = ?', [userId]);
  if (!row) return c.json({ error: 'Пользователь не найден' }, 404);

  const confirmEmail = String(email || '').trim().toLowerCase();
  if (confirmEmail !== String(row.email || '').trim().toLowerCase()) {
    return c.json({ error: 'Email не совпадает с аккаунтом' }, 400);
  }
  if (!password || !verifyPassword(row, password)) {
    return c.json({ error: 'Неверный пароль' }, 400);
  }

  await deleteAllUserSessions(d1, userId);
  const files = await dbAll(d1, 'SELECT file_name FROM file_uploads WHERE user_id = ?', [userId]);
  const r2 = c.env.UPLOADS;
  if (r2) {
    for (const f of files) { r2.delete(f.file_name).catch(() => {}); }
  }
  await dbRun(d1, 'DELETE FROM file_uploads WHERE user_id = ?', [userId]);
  await dbRun(d1, 'DELETE FROM users WHERE id = ?', [userId]);
  return c.json({ ok: true });
});

// ——— Support ———
app.get('/support/tickets', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const user = c.get('user');
  const admin = isAdminUser(c.env, user);

  const rows = admin
    ? await dbAll(
        d1,
        `SELECT t.*, u.username, u.email, u.discriminator
         FROM support_tickets t
         JOIN users u ON u.id = t.user_id
         ORDER BY t.updated_at DESC`
      )
    : await dbAll(
        d1,
        `SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC`,
        [user.id]
      );

  return c.json({
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
      author: admin
        ? {
            username: r.username,
            email: r.email,
            tag: `${r.username}#${r.discriminator}`
          }
        : undefined
    })),
    isAdmin: admin
  });
});

app.post('/support/tickets', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { category, subject, description } = body || {};
  const subj = String(subject || '').trim();
  const desc = String(description || '').trim();
  const cat = String(category || 'bug').trim();

  if (!subj || subj.length < 3) return c.json({ error: 'Тема минимум 3 символа' }, 400);
  if (!desc || desc.length < 10) return c.json({ error: 'Описание минимум 10 символов' }, 400);

  const d1 = c.env.DB;
  const id = generateId();
  const now = new Date().toISOString();
  await dbRun(
    d1,
    `INSERT INTO support_tickets (id, user_id, category, subject, description, status, admin_reply, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', '', ?, ?)`,
    [id, c.get('user').id, cat, subj, desc, now, now]
  );

  return c.json({ ok: true, id });
});

app.patch('/support/tickets/:id', authMiddleware, async (c) => {
  if (!isAdminUser(c.env, c.get('user'))) {
    return c.json({ error: 'Доступ только для администратора' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { status, adminReply } = body || {};
  const d1 = c.env.DB;
  const ticket = await dbGet(d1, 'SELECT * FROM support_tickets WHERE id = ?', [c.req.param('id')]);
  if (!ticket) return c.json({ error: 'Обращение не найдено' }, 404);

  const updates = [];
  const params = [];
  if (status !== undefined) {
    updates.push('status = ?');
    params.push(String(status));
  }
  if (adminReply !== undefined) {
    updates.push('admin_reply = ?');
    params.push(String(adminReply));
  }
  const updatedAt = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(updatedAt);

  if (updates.length > 1) {
    params.push(c.req.param('id'));
    await dbRun(d1, `UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  return c.json({ ok: true });
});

// ——— Tasks ———
app.post('/tasks', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const task = await c.req.json().catch(() => ({}));
  const id = task.id || generateId();
  const now = new Date().toISOString();

  if (task.projectId && !(await userCanAccessProject(d1, userId, task.projectId))) {
    return c.json({ error: 'Нет доступа к проекту' }, 403);
  }

  await dbRun(
    d1,
    `INSERT OR REPLACE INTO tasks (id, owner_id, project_id, title, description, status, priority, date, type, assignees_json, share_with_friends, attachments_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
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
    ]
  );

  const newAchievements = await checkAndUnlock(d1, userId);
  const row = await dbGet(d1, 'SELECT * FROM tasks WHERE id = ?', [id]);
  return c.json({ task: rowToTask(row), newAchievements });
});

app.put('/tasks/:id', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const existing = await dbGet(d1, 'SELECT * FROM tasks WHERE id = ?', [c.req.param('id')]);
  if (!existing) return c.json({ error: 'Задача не найдена' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const task = { ...rowToTask(existing), ...body };
  if (task.projectId && !(await userCanAccessProject(d1, userId, task.projectId))) {
    return c.json({ error: 'Нет доступа' }, 403);
  }

  const now = new Date().toISOString();
  await dbRun(
    d1,
    `UPDATE tasks SET title=?, description=?, status=?, priority=?, date=?, project_id=?, assignees_json=?, share_with_friends=?, attachments_json=?, updated_at=?
     WHERE id=?`,
    [
      task.title,
      task.description || '',
      task.status,
      task.priority,
      task.date,
      task.projectId,
      JSON.stringify(task.assignees || []),
      task.shareWithFriends ? 1 : 0,
      JSON.stringify(task.attachments || []),
      now,
      c.req.param('id')
    ]
  );

  const newAchievements = await checkAndUnlock(d1, userId);
  const row = await dbGet(d1, 'SELECT * FROM tasks WHERE id = ?', [c.req.param('id')]);
  return c.json({ task: rowToTask(row), newAchievements });
});

app.delete('/tasks/:id', authMiddleware, async (c) => {
  await dbRun(c.env.DB, 'DELETE FROM tasks WHERE id = ? AND owner_id = ?', [
    c.req.param('id'),
    c.get('user').id
  ]);
  return c.json({ ok: true });
});

app.post('/tasks/sync', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { tasks } = body || {};
  if (!Array.isArray(tasks)) return c.json({ error: 'Неверный формат' }, 400);

  const d1 = c.env.DB;
  const userId = c.get('user').id;
  for (const task of tasks) {
    const id = task.id || generateId();
    const now = new Date().toISOString();
    await dbRun(
      d1,
      `INSERT OR REPLACE INTO tasks (id, owner_id, project_id, title, description, status, priority, date, type, assignees_json, share_with_friends, attachments_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.ownerId || userId,
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
      ]
    );
  }
  await checkAndUnlock(d1, userId);
  return c.json({ ok: true });
});

// ——— Projects ———
app.post('/projects', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { name, description, memberIds } = body || {};
  if (!name) return c.json({ error: 'Укажите название' }, 400);

  const id = body.id || `project_${generateId()}`;
  const now = new Date().toISOString();

  await dbRun(
    d1,
    `INSERT INTO projects (id, owner_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, userId, name, description || '', now]
  );

  const friends = await filterFriendIds(d1, userId, memberIds || []);
  const members = new Set([userId, ...friends]);
  for (const uid of members) {
    await dbRun(
      d1,
      'INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)',
      [id, uid]
    );
  }

  await dbRun(
    d1,
    `INSERT OR IGNORE INTO mind_maps (project_id, nodes_json, edges_json, updated_at, updated_by)
     VALUES (?, '[]', '[]', ?, ?)`,
    [id, now, userId]
  );

  const newAchievements = await checkAndUnlock(d1, userId);
  const row = await dbGet(d1, 'SELECT * FROM projects WHERE id = ?', [id]);
  const memberList = await getProjectMembers(d1, id);
  return c.json({
    project: rowToProject(row, memberList),
    newAchievements
  });
});

app.put('/projects/:id', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const projectId = c.req.param('id');

  if (!(await userCanAccessProject(d1, userId, projectId))) {
    return c.json({ error: 'Нет доступа' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { name, description, memberIds } = body || {};

  if (name) {
    await dbRun(d1, 'UPDATE projects SET name = ?, description = ? WHERE id = ?', [
      name,
      description || '',
      projectId
    ]);
  }

  if (memberIds) {
    const project = await dbGet(d1, 'SELECT owner_id FROM projects WHERE id = ?', [projectId]);
    await dbRun(d1, 'DELETE FROM project_members WHERE project_id = ?', [projectId]);
    const friends = await filterFriendIds(d1, userId, memberIds || []);
    const members = new Set([project.owner_id, ...friends]);
    for (const uid of members) {
      await dbRun(d1, 'INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [
        projectId,
        uid
      ]);
    }
  }

  const row = await dbGet(d1, 'SELECT * FROM projects WHERE id = ?', [projectId]);
  const memberList = await getProjectMembers(d1, projectId);
  const newAchievements = await checkAndUnlock(d1, userId);
  return c.json({
    project: rowToProject(row, memberList),
    newAchievements
  });
});

// ——— Friends ———
app.post('/friends/request', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const query = (body.query || body.email || '').trim();
  if (!query) return c.json({ error: 'Введите ник#тег или ID' }, 400);

  const targetRow = await findUserByTagOrPublicId(d1, query);
  if (!targetRow) return c.json({ error: 'Пользователь не найден' }, 404);
  if (targetRow.id === userId) {
    return c.json({ error: 'Нельзя добавить себя' }, 400);
  }

  const existingFriend = await dbGet(
    d1,
    'SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?',
    [userId, targetRow.id]
  );
  if (existingFriend) {
    return c.json({ error: 'Уже в друзьях' }, 400);
  }

  const pending = await dbGet(
    d1,
    `SELECT * FROM friend_requests
     WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
     AND status = 'pending'`,
    [userId, targetRow.id, targetRow.id, userId]
  );
  if (pending) {
    return c.json({ error: 'Заявка уже отправлена' }, 400);
  }

  const id = generateId();
  const now = new Date().toISOString();
  await dbRun(
    d1,
    "DELETE FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status != 'pending'",
    [userId, targetRow.id]
  );
  await dbRun(
    d1,
    `INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`,
    [id, userId, targetRow.id, now]
  );

  const senderName = c.get('user').username;
  notifyFriendRequest(c.env, d1, targetRow.id, senderName, userId).catch(() => {});

  return c.json({ success: true, target: formatUser(targetRow) });
});

app.post('/friends/respond', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { userId: fromUserId, accept } = body;

  const request = await dbGet(
    d1,
    `SELECT * FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
    [fromUserId, userId]
  );
  if (!request) return c.json({ error: 'Заявка не найдена' }, 404);

  await dbRun(d1, 'DELETE FROM friend_requests WHERE id = ?', [request.id]);

  if (accept) {
    const now = new Date().toISOString();
    await dbRun(
      d1,
      'INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
      [userId, fromUserId, now]
    );
    await dbRun(
      d1,
      'INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
      [fromUserId, userId, now]
    );
  }

  const newAchievements = await checkAndUnlock(d1, userId);
  if (accept) await checkAndUnlock(d1, fromUserId);
  return c.json({ ok: true, newAchievements });
});

app.post('/friends/cancel', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { userId: toUserId } = body;
  await dbRun(
    c.env.DB,
    `DELETE FROM friend_requests
     WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
    [c.get('user').id, toUserId]
  );
  return c.json({ ok: true });
});

app.delete('/friends/:friendId', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const fid = c.req.param('friendId');
  await dbRun(d1, 'DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', [userId, fid]);
  await dbRun(d1, 'DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', [fid, userId]);
  return c.json({ ok: true });
});

app.get('/friends', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;

  const friendRows = await dbAll(
    d1,
    'SELECT friend_id FROM friendships WHERE user_id = ?',
    [userId]
  );
  const friendIds = friendRows.map(r => r.friend_id);

  const { incoming, outgoing } = await getFriendRequestsForUser(d1, userId);
  const users = await fetchRelatedUsers(d1, userId);

  return c.json({
    friends: friendIds,
    incoming,
    outgoing,
    users
  });
});

// ——— Messages (feed/inbox before :friendId) ———
app.get('/messages/feed', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const since = parseInt(c.req.query('since'), 10) || 0;

  const rows = await dbAll(
    d1,
    `SELECT m.*, u.username as sender_name
     FROM messages m
     JOIN users u ON u.id = m.from_user_id
     WHERE m.to_user_id = ? AND m.created_at > ?
     ORDER BY m.created_at ASC`,
    [userId, since]
  );

  const convRows = await dbAll(
    d1,
    `SELECT cm.id, cm.conversation_id, cm.from_user_id, cm.text, cm.created_at,
            u.username as sender_name, c.name as conv_name
     FROM conversation_messages cm
     JOIN conversation_members mem ON mem.conversation_id = cm.conversation_id AND mem.user_id = ?
     JOIN users u ON u.id = cm.from_user_id
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.created_at > ? AND cm.from_user_id != ?
     ORDER BY cm.created_at ASC`,
    [userId, since, userId]
  );

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

  return c.json({
    messages: [...direct, ...group].sort((a, b) => a.timestamp - b.timestamp)
  });
});

app.get('/messages/inbox', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const since = parseInt(c.req.query('since'), 10) || Date.now() - 7 * 24 * 60 * 60 * 1000;

  const rows = await dbAll(
    d1,
    `SELECT m.id, m.from_user_id, m.text, m.created_at, u.username as sender_name
     FROM messages m
     JOIN users u ON u.id = m.from_user_id
     WHERE m.to_user_id = ? AND m.created_at > ?
     ORDER BY m.created_at DESC
     LIMIT 40`,
    [userId, since]
  );

  const convRows = await dbAll(
    d1,
    `SELECT cm.id, cm.conversation_id, cm.from_user_id, cm.text, cm.created_at,
            u.username as sender_name, c.name as conv_name
     FROM conversation_messages cm
     JOIN conversation_members mem ON mem.conversation_id = cm.conversation_id AND mem.user_id = ?
     JOIN users u ON u.id = cm.from_user_id
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.created_at > ? AND cm.from_user_id != ?
     ORDER BY cm.created_at DESC
     LIMIT 40`,
    [userId, since, userId]
  );

  return c.json({
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

app.get('/messages/:friendId', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const friendId = c.req.param('friendId');

  const rows = await dbAll(
    d1,
    `SELECT * FROM messages
     WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
     ORDER BY created_at ASC`,
    [userId, friendId, friendId, userId]
  );

  return c.json(
    rows.map(r => ({
      id: r.id,
      from: r.from_user_id,
      to: r.to_user_id,
      text: r.text,
      attachments: parseJson(r.attachments_json, []),
      timestamp: r.created_at
    }))
  );
});

app.post('/messages/:friendId', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const friendId = c.req.param('friendId');
  const body = await c.req.json().catch(() => ({}));
  const { text, attachments } = body || {};

  if (!text?.trim() && !(attachments || []).length) {
    return c.json({ error: 'Пустое сообщение' }, 400);
  }

  const friend = await dbGet(
    d1,
    'SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?',
    [userId, friendId]
  );
  if (!friend) return c.json({ error: 'Не в друзьях' }, 403);

  const id = generateId();
  const now = Date.now();
  const bodyText = text?.trim() || 'Вложение';
  await dbRun(
    d1,
    `INSERT INTO messages (id, from_user_id, to_user_id, text, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, friendId, bodyText, JSON.stringify(attachments || []), now]
  );

  const senderName = c.get('user').username;
  notifyNewMessage(c.env, d1, friendId, senderName, bodyText, userId).catch(() => {});

  const newAchievements = await checkAndUnlock(d1, userId);
  return c.json({
    message: {
      id,
      from: userId,
      to: friendId,
      text: bodyText,
      attachments: attachments || [],
      timestamp: now
    },
    newAchievements
  });
});

app.delete('/messages/:id', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  const row = await dbGet(d1, 'SELECT * FROM messages WHERE id = ? AND from_user_id = ?', [msgId, userId]);
  if (!row) return c.json({ error: 'Сообщение не найдено или нет прав' }, 404);
  await dbRun(d1, 'DELETE FROM messages WHERE id = ?', [msgId]);
  return c.json({ ok: true });
});

app.delete('/conversations/:id/messages/:msgId', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const msgId = c.req.param('msgId');
  const row = await dbGet(
    d1,
    'SELECT * FROM conversation_messages WHERE id = ? AND conversation_id = ? AND from_user_id = ?',
    [msgId, convId, userId]
  );
  if (!row) return c.json({ error: 'Сообщение не найдено или нет прав' }, 404);
  await dbRun(d1, 'DELETE FROM conversation_messages WHERE id = ?', [msgId]);
  return c.json({ ok: true });
});

app.put('/messages/:id', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const text = (body.text || '').trim();
  if (!text) return c.json({ error: 'Текст не может быть пустым' }, 400);
  const row = await dbGet(d1, 'SELECT * FROM messages WHERE id = ? AND from_user_id = ?', [msgId, userId]);
  if (!row) return c.json({ error: 'Сообщение не найдено или нет прав' }, 404);
  await dbRun(d1, 'UPDATE messages SET text = ? WHERE id = ?', [text, msgId]);
  return c.json({ ok: true });
});

app.put('/conversations/:id/messages/:msgId', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const msgId = c.req.param('msgId');
  const body = await c.req.json().catch(() => ({}));
  const text = (body.text || '').trim();
  if (!text) return c.json({ error: 'Текст не может быть пустым' }, 400);
  const row = await dbGet(
    d1,
    'SELECT * FROM conversation_messages WHERE id = ? AND conversation_id = ? AND from_user_id = ?',
    [msgId, convId, userId]
  );
  if (!row) return c.json({ error: 'Сообщение не найдено или нет прав' }, 404);
  await dbRun(d1, 'UPDATE conversation_messages SET text = ? WHERE id = ?', [text, msgId]);
  return c.json({ ok: true });
});

// ——— Conversations ———
app.get('/conversations', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;

  const rows = await dbAll(
    d1,
    `SELECT c.* FROM conversations c
     JOIN conversation_members m ON m.conversation_id = c.id
     WHERE m.user_id = ?
     ORDER BY c.created_at DESC`,
    [userId]
  );

  const conversations = await Promise.all(
    rows.map(async (row) => {
      const members = await dbAll(
        d1,
        'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
        [row.id]
      );
      return {
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        memberIds: members.map(r => r.user_id),
        createdAt: row.created_at
      };
    })
  );

  return c.json({ conversations });
});

app.post('/conversations', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { name, memberIds } = body || {};
  const title = String(name || '').trim();
  if (!title) return c.json({ error: 'Укажите название беседы' }, 400);

  const friends = await filterFriendIds(d1, userId, memberIds || []);
  if (!friends.length) {
    return c.json({ error: 'Выберите хотя бы одного друга' }, 400);
  }

  const id = generateId();
  const now = Date.now();
  await dbRun(
    d1,
    'INSERT INTO conversations (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)',
    [id, title, userId, now]
  );

  const members = new Set([userId, ...friends]);
  for (const uid of members) {
    await dbRun(
      d1,
      'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)',
      [id, uid]
    );
  }

  return c.json({
    conversation: {
      id,
      name: title,
      ownerId: userId,
      memberIds: [...members],
      createdAt: now
    }
  });
});

app.get('/conversations/:id/messages', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const convId = c.req.param('id');

  const member = await dbGet(
    d1,
    'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [convId, userId]
  );
  if (!member) return c.json({ error: 'Нет доступа' }, 403);

  const rows = await dbAll(
    d1,
    `SELECT cm.*, u.username as sender_name
     FROM conversation_messages cm
     JOIN users u ON u.id = cm.from_user_id
     WHERE cm.conversation_id = ?
     ORDER BY cm.created_at ASC`,
    [convId]
  );

  return c.json({
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

app.post('/conversations/:id/messages', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { text, attachments } = body || {};

  if (!text?.trim() && !(attachments || []).length) {
    return c.json({ error: 'Пустое сообщение' }, 400);
  }

  const member = await dbGet(
    d1,
    'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [convId, userId]
  );
  if (!member) return c.json({ error: 'Нет доступа' }, 403);

  const id = generateId();
  const now = Date.now();
  const bodyText = text?.trim() || 'Вложение';
  await dbRun(
    d1,
    `INSERT INTO conversation_messages (id, conversation_id, from_user_id, text, attachments_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, convId, userId, bodyText, JSON.stringify(attachments || []), now]
  );

  const senderRow = await dbGet(d1, 'SELECT username FROM users WHERE id = ?', [userId]);
  return c.json({
    message: {
      id,
      from: userId,
      conversationId: convId,
      text: bodyText,
      attachments: attachments || [],
      timestamp: now,
      senderName: senderRow?.username || 'Участник'
    }
  });
});

app.post('/conversations/:id/leave', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const member = await dbGet(
    d1,
    'SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [convId, userId]
  );
  if (!member) return c.json({ error: 'Вы не участник беседы' }, 404);
  await dbRun(d1, 'DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, userId]);
  const remaining = await dbGet(d1, 'SELECT COUNT(*) as c FROM conversation_members WHERE conversation_id = ?', [convId]);
  if (remaining?.c === 0) {
    await dbRun(d1, 'DELETE FROM conversations WHERE id = ?', [convId]);
    await dbRun(d1, 'DELETE FROM conversation_messages WHERE conversation_id = ?', [convId]);
  }
  return c.json({ ok: true });
});

app.delete('/conversations/:id', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const conv = await dbGet(d1, 'SELECT * FROM conversations WHERE id = ? AND owner_id = ?', [convId, userId]);
  if (!conv) return c.json({ error: 'Беседа не найдена или вы не создатель' }, 404);
  await dbRun(d1, 'DELETE FROM conversation_messages WHERE conversation_id = ?', [convId]);
  await dbRun(d1, 'DELETE FROM conversation_members WHERE conversation_id = ?', [convId]);
  await dbRun(d1, 'DELETE FROM conversations WHERE id = ?', [convId]);
  return c.json({ ok: true });
});

// ——— Stats ———
app.get('/stats', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;

  const completedByDay = await dbAll(
    d1,
    `SELECT date(updated_at) as day, COUNT(*) as count FROM tasks
     WHERE status = 'completed' AND (owner_id = ? OR assignees_json LIKE ?)
     GROUP BY date(updated_at)
     ORDER BY day DESC LIMIT 30`,
    [userId, `%"${userId}"%`]
  );

  const byPriority = await dbAll(
    d1,
    `SELECT priority, COUNT(*) as count FROM tasks
     WHERE owner_id = ? OR assignees_json LIKE ?
     GROUP BY priority`,
    [userId, `%"${userId}"%`]
  );

  const byStatus = await dbAll(
    d1,
    `SELECT status, COUNT(*) as count FROM tasks
     WHERE owner_id = ? OR assignees_json LIKE ?
     GROUP BY status`,
    [userId, `%"${userId}"%`]
  );

  const projectsProgress = await dbAll(
    d1,
    `SELECT p.id, p.name,
       SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
       COUNT(t.id) as total
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id
     LEFT JOIN tasks t ON t.project_id = p.id
     WHERE p.owner_id = ? OR pm.user_id = ?
     GROUP BY p.id`,
    [userId, userId]
  );

  return c.json({
    summary: await getStats(d1, userId),
    completedByDay,
    byPriority,
    byStatus,
    projectsProgress
  });
});

// ——— Achievements ———
app.get('/achievements', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  await checkAndUnlock(d1, userId);
  const achievements = await getUserAchievements(d1, userId);
  return c.json({ achievements });
});

// ——— Mind maps ———
app.get('/mindmaps/:projectId', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const projectId = c.req.param('projectId');

  if (!(await userCanAccessProject(d1, userId, projectId))) {
    return c.json({ error: 'Нет доступа' }, 403);
  }

  let row = await dbGet(d1, 'SELECT * FROM mind_maps WHERE project_id = ?', [projectId]);
  if (!row) {
    const now = new Date().toISOString();
    await dbRun(
      d1,
      `INSERT INTO mind_maps (project_id, nodes_json, edges_json, updated_at, updated_by)
       VALUES (?, '[]', '[]', ?, ?)`,
      [projectId, now, userId]
    );
    row = await dbGet(d1, 'SELECT * FROM mind_maps WHERE project_id = ?', [projectId]);
  }

  return c.json({
    projectId: row.project_id,
    nodes: parseJson(row.nodes_json, []),
    edges: parseJson(row.edges_json, []),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  });
});

app.put('/mindmaps/:projectId', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const projectId = c.req.param('projectId');

  if (!(await userCanAccessProject(d1, userId, projectId))) {
    return c.json({ error: 'Нет доступа' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { nodes, edges } = body || {};
  const now = new Date().toISOString();
  try {
    await dbRun(
      d1,
      `INSERT OR REPLACE INTO mind_maps (project_id, nodes_json, edges_json, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [projectId, JSON.stringify(nodes || []), JSON.stringify(edges || []), now, userId]
    );
  } catch (e) {
    return c.json({ error: 'Ошибка сохранения mind map: проект не найден или нет доступа' }, 500);
  }
  const newAchievements = await checkAndUnlock(d1, userId);
  return c.json({ ok: true, updatedAt: now, newAchievements });
});

// ——— Notes ———
app.get('/notes', authMiddleware, async (c) => {
  const rows = await dbAll(
    c.env.DB,
    'SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC',
    [c.get('user').id]
  );
  return c.json(rows.map(rowToNote));
});

app.post('/notes', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { title, content, color, tags, pinned, attachments } = body || {};
  const id = generateId();
  const now = new Date().toISOString();

  await dbRun(
    d1,
    `INSERT INTO notes (id, user_id, title, content, color, tags_json, pinned, attachments_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      (title || '').trim(),
      content || '',
      color || '#fff9c4',
      JSON.stringify(tags || []),
      pinned ? 1 : 0,
      JSON.stringify(attachments || []),
      now,
      now
    ]
  );

  const newAchievements = await checkAndUnlock(d1, userId);
  const row = await dbGet(d1, 'SELECT * FROM notes WHERE id = ?', [id]);
  return c.json({ note: rowToNote(row), newAchievements });
});

app.put('/notes/:id', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const noteId = c.req.param('id');

  const existing = await dbGet(d1, 'SELECT * FROM notes WHERE id = ? AND user_id = ?', [noteId, userId]);
  if (!existing) return c.json({ error: 'Заметка не найдена' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const { title, content, color, tags, pinned, attachments } = body || {};
  const now = new Date().toISOString();

  await dbRun(
    d1,
    `UPDATE notes SET title = ?, content = ?, color = ?, tags_json = ?, pinned = ?, attachments_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      title !== undefined ? String(title).trim() : existing.title,
      content !== undefined ? content : existing.content,
      color !== undefined ? color : existing.color,
      tags !== undefined ? JSON.stringify(tags) : existing.tags_json,
      pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
      attachments !== undefined ? JSON.stringify(attachments) : existing.attachments_json,
      now,
      noteId,
      userId
    ]
  );

  const row = await dbGet(d1, 'SELECT * FROM notes WHERE id = ?', [noteId]);
  return c.json({ note: rowToNote(row) });
});

app.delete('/notes/:id', authMiddleware, async (c) => {
  const result = await dbRun(c.env.DB, 'DELETE FROM notes WHERE id = ? AND user_id = ?', [
    c.req.param('id'),
    c.get('user').id
  ]);
  if (!result.meta?.changes) return c.json({ error: 'Заметка не найдена' }, 404);
  return c.json({ ok: true });
});

// ——— Uploads ———
app.post('/uploads', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { fileName, mimeType, contentBase64 } = body || {};

  if (!fileName || !contentBase64) return c.json({ error: 'Нет файла' }, 400);

  const size = estimateBase64Size(contentBase64);
  if (size > 5 * 1024 * 1024) return c.json({ error: 'Файл больше 5 МБ' }, 400);

  const safeName = String(fileName).replace(/[^\w.\-()а-яА-ЯёЁ ]+/g, '_').slice(0, 120);
  const fileId = generateId();
  const diskName = `${fileId}_${safeName}`;
  const now = new Date().toISOString();
  const r2 = c.env.UPLOADS;

  if (r2) {
    const bytes = base64ToBytes(contentBase64);
    await r2.put(diskName, bytes, {
      httpMetadata: { contentType: mimeType || 'application/octet-stream' },
      customMetadata: { userId, fileName: safeName }
    });
    await dbRun(
      d1,
      `INSERT INTO file_uploads (id, user_id, file_name, mime_type, content_base64, created_at)
       VALUES (?, ?, ?, ?, '', ?)`,
      [fileId, userId, diskName, mimeType || 'application/octet-stream', now]
    );
  } else {
    if (size > 700 * 1024) return c.json({ error: 'Файл больше 700 КБ. Настройте R2 bucket для загрузки больших файлов.' }, 400);
    await dbRun(
      d1,
      `INSERT INTO file_uploads (id, user_id, file_name, mime_type, content_base64, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fileId, userId, diskName, mimeType || 'application/octet-stream', contentBase64, now]
    );
  }

  return c.json({
    id: fileId,
    name: safeName,
    mimeType: mimeType || 'application/octet-stream',
    size,
    url: `/api/uploads/${userId}/${diskName}`
  });
});

app.get('/uploads/:userId/:fileName', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const authUserId = c.get('user').id;
  const ownerId = c.req.param('userId');
  const fileName = c.req.param('fileName');

  if (authUserId !== ownerId) {
    const isFriend = await dbGet(
      d1,
      'SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?',
      [authUserId, ownerId]
    );
    if (!isFriend) return c.json({ error: 'Нет доступа' }, 403);
  }

  const r2 = c.env.UPLOADS;
  if (r2) {
    const obj = await r2.get(fileName);
    if (obj) {
      const ext = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : '';
      const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.pdf': 'application/pdf', '.txt': 'text/plain',
        '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.zip': 'application/zip', '.rar': 'application/vnd.rar',
        '.json': 'application/json', '.csv': 'text/csv', '.md': 'text/markdown',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime'
      };
      return new Response(obj.body, {
        headers: { 'Content-Type': obj.httpMetadata?.contentType || mimeMap[ext] || 'application/octet-stream' }
      });
    }
  }

  const row = await dbGet(
    d1,
    'SELECT * FROM file_uploads WHERE user_id = ? AND file_name = ?',
    [ownerId, fileName]
  );
  if (!row) return c.json({ error: 'Файл не найден' }, 404);

  const bytes = base64ToBytes(row.content_base64);
  const ext = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : '';
  const mimeMap = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip', '.rar': 'application/vnd.rar',
    '.json': 'application/json', '.csv': 'text/csv', '.md': 'text/markdown',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime'
  };
  const contentType = row.mime_type || mimeMap[ext] || 'application/octet-stream';

  return new Response(bytes, {
    headers: { 'Content-Type': contentType }
  });
});

// ——— Shared tasks ———
app.get('/friends/:friendId/shared-tasks', authMiddleware, async (c) => {
  const d1 = c.env.DB;
  const userId = c.get('user').id;
  const friendId = c.req.param('friendId');

  const isFriend = await dbGet(
    d1,
    'SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?',
    [userId, friendId]
  );
  if (!isFriend) return c.json({ error: 'Не в друзьях' }, 403);

  const rows = await dbAll(
    d1,
    `SELECT * FROM tasks WHERE owner_id = ? AND share_with_friends = 1 AND status != 'completed'
     ORDER BY date ASC`,
    [friendId]
  );
  return c.json(rows.map(rowToTask));
});

// ——— Push ———
app.get('/push/vapid-key', (c) => {
  return c.json({ publicKey: getVapidPublicKey(c.env) });
});

app.post('/push/subscribe', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { subscription } = body || {};
  if (!subscription?.endpoint || !subscription?.keys) {
    return c.json({ error: 'Неверная подписка' }, 400);
  }
  await saveSubscription(c.env.DB, c.get('user').id, subscription);
  return c.json({ ok: true });
});

app.delete('/push/subscribe', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { endpoint } = body || {};
  if (!endpoint) return c.json({ error: 'Укажите endpoint' }, 400);
  await removeSubscription(c.env.DB, c.get('user').id, endpoint);
  return c.json({ ok: true });
});

// ——— Notifications ———
app.get('/notifications', authMiddleware, async (c) => {
  const rows = await dbAll(
    c.env.DB,
    'SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT 50',
    [c.get('user').id]
  );
  return c.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    body: r.body,
    tag: r.tag,
    data: parseJson(r.data_json, {}),
    read: !!r.read,
    createdAt: r.created_at
  })));
});

app.post('/notifications/read', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { ids } = body || {};
  if (Array.isArray(ids) && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    await dbRun(
      c.env.DB,
      `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`,
      [c.get('user').id, ...ids]
    );
  }
  return c.json({ ok: true });
});

// ——— Users lookup ———
app.get('/users/search', authMiddleware, async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ users: [] });
  const row = await findUserByTagOrPublicId(c.env.DB, q);
  if (!row) return c.json({ users: [] });
  return c.json({ users: [formatUser(row)] });
});

export default app;
