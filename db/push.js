const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./init');

const VAPID_FILE = path.join(__dirname, '..', 'data', 'vapid.json');
const CHECK_INTERVAL_MS = 60 * 1000;

function loadOrCreateVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
  }
  if (fs.existsSync(VAPID_FILE)) {
    return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  const dir = path.dirname(VAPID_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
  console.log('Сгенерированы VAPID-ключи для push-уведомлений');
  return keys;
}

let vapidKeys = null;

function initWebPush() {
  vapidKeys = loadOrCreateVapidKeys();
  webpush.setVapidDetails(
    'mailto:support@taskly.app',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
}

function getVapidPublicKey() {
  if (!vapidKeys) initWebPush();
  return vapidKeys.publicKey;
}

function saveSubscription(userId, subscription) {
  const db = getDb();
  const id = subscription.endpoint.slice(-40);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, keys_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, subscription.endpoint, JSON.stringify(subscription.keys), now);
}

function removeSubscription(userId, endpoint) {
  getDb().prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(userId, endpoint);
}

function getUserSubscriptions(userId) {
  return getDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
}

function getUserTasksForReminders(userId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.* FROM tasks t
    LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
    WHERE t.status != 'completed'
      AND (t.owner_id = ? OR pm.user_id IS NOT NULL OR t.assignees_json LIKE ?)
  `).all(userId, userId, `%"${userId}"%`);
  return rows;
}

function getUserLeadDays(userId) {
  const row = getDb().prepare('SELECT preferences_json FROM users WHERE id = ?').get(userId);
  if (!row) return 1;
  try {
    const prefs = JSON.parse(row.preferences_json || '{}');
    return typeof prefs.reminderLeadDays === 'number' ? prefs.reminderLeadDays : 1;
  } catch {
    return 1;
  }
}

function wasReminderSent(userId, taskId, taskDate) {
  const row = getDb().prepare(
    'SELECT 1 FROM push_reminder_log WHERE user_id = ? AND task_id = ? AND task_date = ?'
  ).get(userId, taskId, taskDate);
  return !!row;
}

function markReminderSent(userId, taskId, taskDate) {
  getDb().prepare(`
    INSERT OR IGNORE INTO push_reminder_log (user_id, task_id, task_date, sent_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, taskId, taskDate, new Date().toISOString());
}

async function sendPushToUser(userId, payload) {
  if (!vapidKeys) initWebPush();
  const subs = getUserSubscriptions(userId);
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: JSON.parse(sub.keys_json)
      }, body);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        removeSubscription(userId, sub.endpoint);
      }
    }
  }
}

function buildReminderMessage(task, diffMs) {
  const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) return `«${task.title}» нужно выполнить сегодня`;
  if (daysLeft === 1) return `«${task.title}» — завтра срок`;
  return `«${task.title}» через ${daysLeft} дн.`;
}

async function checkAndSendReminders() {
  const db = getDb();
  const userIds = db.prepare(`
    SELECT DISTINCT user_id FROM push_subscriptions
  `).all().map(r => r.user_id);

  const now = new Date();

  for (const userId of userIds) {
    const prefs = getUserNotificationPrefs(userId);
    if (!prefs.reminders) continue;
    const leadDays = getUserLeadDays(userId);
    const leadMs = leadDays * 24 * 60 * 60 * 1000;
    const tasks = getUserTasksForReminders(userId);

    for (const row of tasks) {
      if (!row.date) continue;
      const dueEnd = new Date(row.date);
      dueEnd.setHours(23, 59, 59, 999);
      const diffMs = dueEnd.getTime() - now.getTime();
      if (diffMs < 0 || diffMs > leadMs) continue;
      if (wasReminderSent(userId, row.id, row.date)) continue;

      const message = buildReminderMessage({ title: row.title }, diffMs);
      await sendPushToUser(userId, {
        title: 'Таскли — напоминание',
        body: message,
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-192.png',
        tag: `task-${row.id}-${row.date}`,
        url: '/index.html',
        taskId: row.id
      });
      markReminderSent(userId, row.id, row.date);
    }
  }
}

let jobTimer = null;

function startReminderPushJob() {
  if (!vapidKeys) initWebPush();
  if (jobTimer) return;
  checkAndSendReminders().catch(err => console.warn('Push reminders:', err.message));
  jobTimer = setInterval(() => {
    checkAndSendReminders().catch(err => console.warn('Push reminders:', err.message));
  }, CHECK_INTERVAL_MS);
}

function getUserNotificationPrefs(userId) {
  const row = getDb().prepare('SELECT preferences_json FROM users WHERE id = ?').get(userId);
  try {
    const prefs = JSON.parse(row?.preferences_json || '{}');
    const n = prefs.notifications || {};
    return {
      messages: n.messages !== false,
      reminders: n.reminders !== false,
      friendRequests: n.friendRequests !== false
    };
  } catch {
    return { messages: true, reminders: true, friendRequests: true };
  }
}

async function notifyNewMessage(recipientId, senderName, text, senderId) {
  const prefs = getUserNotificationPrefs(recipientId);
  if (!prefs.messages) return;
  const preview = text.length > 140 ? `${text.slice(0, 137)}...` : text;
  await sendPushToUser(recipientId, {
    title: senderName,
    body: preview,
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    tag: `msg-${senderId}`,
    url: `/friends.html?chat=${senderId}`,
    type: 'message'
  });
}

async function notifyFriendRequest(recipientId, senderName) {
  const prefs = getUserNotificationPrefs(recipientId);
  if (!prefs.friendRequests) return;
  await sendPushToUser(recipientId, {
    title: 'Заявка в друзья',
    body: `${senderName} хочет добавить вас в друзья`,
    icon: '/assets/icons/icon-192.png',
    tag: 'friend-request',
    url: '/friends.html?panel=requests',
    type: 'friendRequest'
  });
}

module.exports = {
  initWebPush,
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  sendPushToUser,
  startReminderPushJob,
  notifyNewMessage,
  notifyFriendRequest,
  getUserNotificationPrefs
};
