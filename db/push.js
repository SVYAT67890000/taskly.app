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

async function saveSubscription(userId, subscription) {
  const db = getDb();
  const id = subscription.endpoint.slice(-40);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, keys_json, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET endpoint = ?, keys_json = ?
  `).run(id, userId, subscription.endpoint, JSON.stringify(subscription.keys), now);
}

async function removeSubscription(userId, endpoint) {
  await getDb().prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(userId, endpoint);
}

async function getUserSubscriptions(userId) {
  return await getDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
}

async function getUserTasksForReminders(userId) {
  const db = getDb();
  return await db.prepare(`
    SELECT t.* FROM tasks t
    LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
    WHERE t.status != 'completed'
      AND (t.owner_id = ? OR pm.user_id IS NOT NULL OR t.assignees_json LIKE ?)
  `).all(userId, userId, `%"${userId}"%`);
}

async function getUserLeadDays(userId) {
  const row = await getDb().prepare('SELECT preferences_json FROM users WHERE id = ?').get(userId);
  if (!row) return 1;
  try {
    const prefs = JSON.parse(row.preferences_json || '{}');
    return typeof prefs.reminderLeadDays === 'number' ? prefs.reminderLeadDays : 1;
  } catch {
    return 1;
  }
}

async function wasReminderSent(userId, taskId, taskDate) {
  const row = await getDb().prepare(
    'SELECT 1 FROM push_reminder_log WHERE user_id = ? AND task_id = ? AND task_date = ?'
  ).get(userId, taskId, taskDate);
  return !!row;
}

async function markReminderSent(userId, taskId, taskDate) {
  await getDb().prepare(`
    INSERT INTO push_reminder_log (user_id, task_id, task_date, sent_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, task_id, task_date) DO NOTHING
  `).run(userId, taskId, taskDate, new Date().toISOString());
}

async function sendPushToUser(userId, payload) {
  if (!vapidKeys) initWebPush();
  const subs = await getUserSubscriptions(userId);
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: JSON.parse(sub.keys_json)
      }, body);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await removeSubscription(userId, sub.endpoint);
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
  const userIds = (await db.prepare(`
    SELECT DISTINCT user_id FROM push_subscriptions
  `).all()).map(r => r.user_id);

  const now = new Date();

  for (const userId of userIds) {
    const prefs = await getUserNotificationPrefs(userId);
    if (!prefs.reminders) continue;
    const leadDays = await getUserLeadDays(userId);
    const leadMs = leadDays * 24 * 60 * 60 * 1000;
    const tasks = await getUserTasksForReminders(userId);

    for (const row of tasks) {
      if (!row.date) continue;
      const dueEnd = new Date(row.date);
      dueEnd.setHours(23, 59, 59, 999);
      const diffMs = dueEnd.getTime() - now.getTime();
      if (diffMs < 0 || diffMs > leadMs) continue;
      if (await wasReminderSent(userId, row.id, row.date)) continue;

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
      await markReminderSent(userId, row.id, row.date);
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

async function getUserNotificationPrefs(userId) {
  const row = await getDb().prepare('SELECT preferences_json FROM users WHERE id = ?').get(userId);
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
  const prefs = await getUserNotificationPrefs(recipientId);
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
  const prefs = await getUserNotificationPrefs(recipientId);
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
