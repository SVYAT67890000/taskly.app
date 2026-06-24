const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'taskly.db');

let db;

function getDb() {
  if (process.env.DATABASE_URL) {
    if (!db) {
      const pg = require('./pg');
      db = pg.prepare;
      db.prepare = pg.prepare;
      db._pool = pg.getPool();
      db._exec = pg.exec;
      initPgSchema().catch(err => { console.error('PG schema init failed:', err); process.exit(1); });
    }
    return db;
  }

  if (!db) {
    const Database = require('better-sqlite3');
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

async function initPgSchema() {
  const pg = require('./pg');
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      discriminator TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      avatar_json TEXT DEFAULT '{"type":"emoji","value":"👤"}',
      status TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      preferences_json TEXT DEFAULT '{"reminderLeadDays":1}',
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tag ON users(username, discriminator);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      date TEXT,
      type TEXT DEFAULT 'task',
      assignees_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      UNIQUE(from_user_id, to_user_id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      category TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS mind_maps (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      nodes_json TEXT NOT NULL DEFAULT '[]',
      edges_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      tags_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      keys_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_reminder_log (
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (user_id, task_id, task_date)
    );

    CREATE TABLE IF NOT EXISTS password_codes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'bug',
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_reply TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      attachments_json TEXT DEFAULT '[]',
      created_at BIGINT NOT NULL
    );
  `);

  await migratePgSchema();
  await seedPgAchievements();
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      discriminator TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      avatar_json TEXT DEFAULT '{"type":"emoji","value":"👤"}',
      status TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      preferences_json TEXT DEFAULT '{"reminderLeadDays":1}',
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tag ON users(username, discriminator);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      date TEXT,
      type TEXT DEFAULT 'task',
      assignees_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      UNIQUE(from_user_id, to_user_id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      category TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS mind_maps (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      nodes_json TEXT NOT NULL DEFAULT '[]',
      edges_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      tags_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      keys_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_reminder_log (
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (user_id, task_id, task_date)
    );

    CREATE TABLE IF NOT EXISTS password_codes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'bug',
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_reply TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      attachments_json TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
  `);

  migrateSchema(database);
  seedAchievements(database);
}

function migrateSchema(database) {
  const alters = [
    'ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN share_with_friends INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN attachments_json TEXT DEFAULT \'[]\'',
    'ALTER TABLE notes ADD COLUMN attachments_json TEXT DEFAULT \'[]\'',
    'ALTER TABLE messages ADD COLUMN attachments_json TEXT DEFAULT \'[]\''
  ];
  alters.forEach(sql => {
    try { database.exec(sql); } catch (_) {}
  });
}

async function migratePgSchema() {
  const pg = require('./pg');
  const alters = [
    'ALTER TABLE notes ADD COLUMN IF NOT EXISTS pinned INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS share_with_friends INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachments_json TEXT DEFAULT \'[]\'',
    'ALTER TABLE notes ADD COLUMN IF NOT EXISTS attachments_json TEXT DEFAULT \'[]\'',
    'ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments_json TEXT DEFAULT \'[]\''
  ];
  for (const sql of alters) {
    try { await pg.exec(sql); } catch (_) {}
  }
}

const ACHIEVEMENTS_CATALOG = [
  { id: 'first_task', title: 'Первый шаг', description: 'Выполните первую задачу', icon: '✅', category: 'tasks' },
  { id: 'tasks_10', title: 'Трудяга', description: 'Выполните 10 задач', icon: '🔟', category: 'tasks' },
  { id: 'tasks_50', title: 'Машина продуктивности', description: 'Выполните 50 задач', icon: '🏆', category: 'tasks' },
  { id: 'first_project', title: 'Организатор', description: 'Создайте первый проект', icon: '📁', category: 'projects' },
  { id: 'collab_project', title: 'Команда', description: 'Создайте проект с друзьями', icon: '🤝', category: 'projects' },
  { id: 'first_friend', title: 'Социальная бабочка', description: 'Добавьте первого друга', icon: '👋', category: 'social' },
  { id: 'friends_5', title: 'Популярный', description: 'Наберите 5 друзей', icon: '⭐', category: 'social' },
  { id: 'messages_10', title: 'Болтун', description: 'Отправьте 10 сообщений друзьям', icon: '💬', category: 'social' },
  { id: 'mindmap_start', title: 'Визионер', description: 'Отредактируйте mind map проекта', icon: '🧠', category: 'projects' },
  { id: 'notes_5', title: 'Мыслитель', description: 'Создайте 5 заметок', icon: '📝', category: 'notes' }
];

function seedAchievements(database) {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO achievements (id, title, description, icon, category)
    VALUES (@id, @title, @description, @icon, @category)
  `);
  const tx = database.transaction((items) => {
    for (const item of items) insert.run(item);
  });
  tx(ACHIEVEMENTS_CATALOG);
}

async function seedPgAchievements() {
  const pg = require('./pg');
  for (const a of ACHIEVEMENTS_CATALOG) {
    await pg.prepare(
      `INSERT INTO achievements (id, title, description, icon, category) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`
    ).run(a.id, a.title, a.description, a.icon, a.category);
  }
}

module.exports = { getDb, ACHIEVEMENTS_CATALOG };
