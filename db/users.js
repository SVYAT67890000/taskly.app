const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./init');

function generateId() {
  return crypto.randomUUID();
}

function generatePublicId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'TL-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateDiscriminator() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function formatUser(row) {
  if (!row) return null;
  let avatar = { type: 'emoji', value: '👤' };
  let preferences = { reminderLeadDays: 1 };
  try {
    avatar = JSON.parse(row.avatar_json || '{}');
  } catch (_) {}
  try {
    preferences = JSON.parse(row.preferences_json || '{}');
  } catch (_) {}

  return {
    id: row.id,
    username: row.username,
    discriminator: row.discriminator,
    tag: `${row.username}#${row.discriminator}`,
    publicId: row.public_id,
    email: row.email,
    avatar,
    status: row.status || '',
    phone: row.phone || '',
    bio: row.bio || '',
    preferences,
    createdAt: row.created_at
  };
}

async function findUserByTagOrPublicId(query) {
  const db = getDb();
  const trimmed = (query || '').trim();

  const publicMatch = await db.prepare(
    'SELECT * FROM users WHERE public_id = ?'
  ).get(trimmed.toUpperCase());
  if (publicMatch) return publicMatch;

  const tagMatch = trimmed.match(/^(.+?)#(\d{4})$/);
  if (tagMatch) {
    return await db.prepare(
      'SELECT * FROM users WHERE username = ? AND discriminator = ?'
    ).get(tagMatch[1].trim(), tagMatch[2]);
  }

  if (/^\d{4}$/.test(trimmed)) {
    return null;
  }

  return await db.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).get(trimmed);
}

async function createUser({ username, email, password, personalDataConsent = false }) {
  const db = getDb();
  const id = generateId();
  let discriminator;
  let attempts = 0;
  do {
    discriminator = generateDiscriminator();
    const clash = await db.prepare(
      'SELECT 1 FROM users WHERE username = ? AND discriminator = ?'
    ).get(username, discriminator);
    if (!clash) break;
    attempts++;
  } while (attempts < 20);

  let publicId;
  attempts = 0;
  do {
    publicId = generatePublicId();
    const clash = await db.prepare('SELECT 1 FROM users WHERE public_id = ?').get(publicId);
    if (!clash) break;
    attempts++;
  } while (attempts < 20);

  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  const avatarJson = JSON.stringify({ type: 'emoji', value: '👤' });
  const prefsJson = JSON.stringify({
    reminderLeadDays: 1,
    personalDataConsent: !!personalDataConsent,
    personalDataConsentDate: personalDataConsent ? now : null
  });

  await db.prepare(`
    INSERT INTO users (id, username, discriminator, email, password_hash, public_id, avatar_json, preferences_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, username, discriminator, email, passwordHash, publicId, avatarJson, prefsJson, now);

  return formatUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function verifyPassword(row, password) {
  return bcrypt.compareSync(password, row.password_hash);
}

async function createSession(userId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

async function getUserByToken(token) {
  const db = getDb();
  const session = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session || session.expires_at < Date.now()) return null;
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  return formatUser(row);
}

async function deleteSession(token) {
  const db = getDb();
  await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

async function deleteAllUserSessions(userId) {
  const db = getDb();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

module.exports = {
  formatUser,
  findUserByTagOrPublicId,
  createUser,
  verifyPassword,
  createSession,
  getUserByToken,
  deleteSession,
  deleteAllUserSessions,
  generateId
};
