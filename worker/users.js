import bcrypt from 'bcryptjs';
import { dbGet, dbRun } from './sql.js';

export function generateId() {
  return crypto.randomUUID();
}

function generatePublicId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'TL-';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function generateDiscriminator() {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return String(1000 + (bytes[0] % 9000));
}

export function formatUser(row) {
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

export async function findUserByTagOrPublicId(d1, query) {
  const trimmed = (query || '').trim();

  const publicMatch = await dbGet(
    d1,
    'SELECT * FROM users WHERE public_id = ? COLLATE NOCASE',
    [trimmed.toUpperCase()]
  );
  if (publicMatch) return publicMatch;

  const tagMatch = trimmed.match(/^(.+?)#(\d{4})$/);
  if (tagMatch) {
    return dbGet(
      d1,
      'SELECT * FROM users WHERE username = ? AND discriminator = ?',
      [tagMatch[1].trim(), tagMatch[2]]
    );
  }

  if (/^\d{4}$/.test(trimmed)) {
    return null;
  }

  return dbGet(
    d1,
    'SELECT * FROM users WHERE username = ? COLLATE NOCASE',
    [trimmed]
  );
}

export async function createUser(d1, { username, email, password, personalDataConsent = false }) {
  const id = generateId();
  let discriminator;
  let attempts = 0;
  do {
    discriminator = generateDiscriminator();
    const clash = await dbGet(
      d1,
      'SELECT 1 AS ok FROM users WHERE username = ? AND discriminator = ?',
      [username, discriminator]
    );
    if (!clash) break;
    attempts++;
  } while (attempts < 20);

  let publicId;
  attempts = 0;
  do {
    publicId = generatePublicId();
    const clash = await dbGet(d1, 'SELECT 1 AS ok FROM users WHERE public_id = ?', [publicId]);
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

  await dbRun(
    d1,
    `INSERT INTO users (id, username, discriminator, email, password_hash, public_id, avatar_json, preferences_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, username, discriminator, email, passwordHash, publicId, avatarJson, prefsJson, now]
  );

  const row = await dbGet(d1, 'SELECT * FROM users WHERE id = ?', [id]);
  return formatUser(row);
}

export function verifyPassword(row, password) {
  return bcrypt.compareSync(password, row.password_hash);
}

function tokenToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(d1, userId) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = tokenToHex(bytes);
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await dbRun(d1, 'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [
    token,
    userId,
    expiresAt
  ]);
  return token;
}

export async function getUserByToken(d1, token) {
  const session = await dbGet(d1, 'SELECT * FROM sessions WHERE token = ?', [token]);
  if (!session || session.expires_at < Date.now()) return null;
  const row = await dbGet(d1, 'SELECT * FROM users WHERE id = ?', [session.user_id]);
  return formatUser(row);
}

export async function deleteSession(d1, token) {
  await dbRun(d1, 'DELETE FROM sessions WHERE token = ?', [token]);
}

export async function deleteAllUserSessions(d1, userId) {
  await dbRun(d1, 'DELETE FROM sessions WHERE user_id = ?', [userId]);
}
