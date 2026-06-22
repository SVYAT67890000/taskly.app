import { parseJson, dbGet, dbAll } from './sql.js';
import { formatUser, getUserByToken } from './users.js';

export { parseJson };

export function rowToTask(row) {
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

export function rowToProject(row, memberIds) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    ownerId: row.owner_id,
    memberIds: memberIds.filter(id => id !== row.owner_id),
    createdAt: row.created_at
  };
}

export function rowToNote(row) {
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

export async function getProjectMembers(d1, projectId) {
  const rows = await dbAll(
    d1,
    'SELECT user_id FROM project_members WHERE project_id = ?',
    [projectId]
  );
  return rows.map(r => r.user_id);
}

export async function userCanAccessProject(d1, userId, projectId) {
  const project = await dbGet(d1, 'SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) return false;
  if (project.owner_id === userId) return true;
  const member = await dbGet(
    d1,
    'SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, userId]
  );
  return !!member;
}

export async function areFriends(d1, userId, friendId) {
  const row = await dbGet(
    d1,
    'SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?',
    [userId, friendId]
  );
  return !!row;
}

export async function filterFriendIds(d1, userId, ids) {
  const unique = Array.from(new Set((ids || []).filter(id => id !== userId)));
  const result = [];
  for (const id of unique) {
    if (await areFriends(d1, userId, id)) result.push(id);
  }
  return result;
}

export async function fetchRelatedUsers(d1, userId) {
  const ids = new Set([userId]);

  const friends = await dbAll(
    d1,
    'SELECT friend_id AS id FROM friendships WHERE user_id = ?',
    [userId]
  );
  friends.forEach(r => ids.add(r.id));

  const incomingReq = await dbAll(
    d1,
    'SELECT from_user_id AS id FROM friend_requests WHERE to_user_id = ? AND status = ?',
    [userId, 'pending']
  );
  incomingReq.forEach(r => ids.add(r.id));

  const outgoingReq = await dbAll(
    d1,
    'SELECT to_user_id AS id FROM friend_requests WHERE from_user_id = ? AND status = ?',
    [userId, 'pending']
  );
  outgoingReq.forEach(r => ids.add(r.id));

  const projectPeers = await dbAll(
    d1,
    `SELECT DISTINCT pm2.user_id AS id FROM project_members pm1
     JOIN project_members pm2 ON pm2.project_id = pm1.project_id
     WHERE pm1.user_id = ?`,
    [userId]
  );
  projectPeers.forEach(r => ids.add(r.id));

  const projectOwners = await dbAll(
    d1,
    `SELECT DISTINCT p.owner_id AS id FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE pm.user_id = ?`,
    [userId]
  );
  projectOwners.forEach(r => ids.add(r.id));

  const idList = [...ids];
  if (!idList.length) return [];

  const placeholders = idList.map(() => '?').join(',');
  const rows = await dbAll(d1, `SELECT * FROM users WHERE id IN (${placeholders})`, idList);
  return rows.map(formatUser);
}

export async function getFriendRequestsForUser(d1, userId) {
  const incomingRows = await dbAll(
    d1,
    `SELECT from_user_id FROM friend_requests WHERE to_user_id = ? AND status = 'pending'`,
    [userId]
  );
  const outgoingRows = await dbAll(
    d1,
    `SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending'`,
    [userId]
  );

  return {
    incoming: incomingRows.map(r => r.from_user_id),
    outgoing: outgoingRows.map(r => r.to_user_id)
  };
}

export function isAdminUser(env, user) {
  const admins = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(String(user?.email || '').toLowerCase());
}

export function getTokenFromRequest(c) {
  const header = c.req.header('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (c.req.method === 'GET' && c.req.query('token')) return String(c.req.query('token'));
  return null;
}

export async function authMiddleware(c, next) {
  const token = getTokenFromRequest(c);
  if (!token) {
    return c.json({ error: 'Требуется авторизация' }, 401);
  }
  const user = await getUserByToken(c.env.DB, token);
  if (!user) {
    return c.json({ error: 'Сессия истекла' }, 401);
  }
  c.set('user', user);
  c.set('token', token);
  await next();
}
