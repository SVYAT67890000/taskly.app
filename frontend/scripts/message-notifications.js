let messagePollTimer = null;
let lastMessagePollAt = 0;
let seenMessageIds = new Set();
let knownIncomingRequests = new Set();

function notificationsAllowed(type) {
  if (typeof isNotificationEnabled === 'function') {
    return isNotificationEnabled(type);
  }
  return true;
}

function getMessagePollKey() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return `taskly.msgPoll.${user?.id || 'anon'}`;
}

function loadMessagePollState() {
  try {
    const raw = localStorage.getItem(getMessagePollKey());
    if (!raw) {
      lastMessagePollAt = Date.now() - 30000;
      return;
    }
    const data = JSON.parse(raw);
    lastMessagePollAt = data.since || Date.now() - 30000;
    (data.seenIds || []).forEach(id => seenMessageIds.add(id));
    (data.incoming || []).forEach(id => knownIncomingRequests.add(id));
  } catch (_) {
    lastMessagePollAt = Date.now() - 30000;
  }
}

function saveMessagePollState() {
  localStorage.setItem(getMessagePollKey(), JSON.stringify({
    since: lastMessagePollAt,
    seenIds: [...seenMessageIds].slice(-200),
    incoming: [...knownIncomingRequests]
  }));
}

function shouldSkipMessageNotification(chatKey, isGroup) {
  if (!window.location.pathname.includes('friends.html')) return false;
  if (isGroup) {
    if (typeof selectedGroupId !== 'undefined' && selectedGroupId === chatKey) return true;
    const params = new URLSearchParams(window.location.search);
    return params.get('group') === chatKey;
  }
  if (typeof selectedFriendId !== 'undefined' && selectedFriendId === chatKey) return true;
  const params = new URLSearchParams(window.location.search);
  return params.get('chat') === chatKey;
}

function getUnreadKey(msg) {
  if (msg.kind === 'group' && msg.conversationId) return `grp:${msg.conversationId}`;
  return msg.from;
}

let chatRefreshNeeded = false;

function notifyIncomingMessage(msg) {
  if (seenMessageIds.has(msg.id)) return;
  seenMessageIds.add(msg.id);

  if (typeof incrementUnread === 'function') incrementUnread(getUnreadKey(msg));
  if (typeof renderNotificationCenter === 'function') renderNotificationCenter();

  const skipKey = msg.kind === 'group' ? msg.conversationId : msg.from;
  const isViewing = shouldSkipMessageNotification(skipKey, msg.kind === 'group');
  if (isViewing) chatRefreshNeeded = true;

  if (!notificationsAllowed('messages')) return;
  if (isViewing) return;

  const preview = msg.text.length > 100 ? `${msg.text.slice(0, 97)}...` : msg.text;
  const title = msg.kind === 'group'
    ? `${msg.convName || 'Беседа'} — ${msg.senderName || 'Участник'}`
    : (msg.senderName || 'Новое сообщение');

  if (typeof showBrowserNotification === 'function') {
    showBrowserNotification(title, preview, {
      tag: `msg-${getUnreadKey(msg)}`,
      data: { url: msg.kind === 'group' ? `/friends.html?group=${msg.conversationId}` : `/friends.html?chat=${msg.from}` }
    });
  }
  if (typeof showNotification === 'function') {
    showNotification(`${title}: ${preview}`, { type: 'info', icon: 'message' });
  } else if (typeof playNotificationSound === 'function') {
    playNotificationSound();
  }
}

function notifyIncomingFriendRequest(userId, userName) {
  if (!notificationsAllowed('friendRequests')) return;
  if (knownIncomingRequests.has(userId)) return;
  knownIncomingRequests.add(userId);

  const title = 'Заявка в друзья';
  const body = `${userName || 'Пользователь'} хочет добавить вас в друзья`;

  if (typeof showBrowserNotification === 'function') {
    showBrowserNotification(title, body, {
      tag: 'friend-request',
      data: { url: '/friends.html?panel=requests' }
    });
  }
  if (typeof showNotification === 'function') {
    showNotification(body, { type: 'info', icon: 'friend' });
  }
  if (typeof renderNotificationCenter === 'function') renderNotificationCenter();
}

async function pollMessageNotifications() {
  const token = localStorage.getItem('userToken') || sessionStorage.getItem('userToken');
  if (!token || typeof TasklyApi === 'undefined') return;

  try {
    const feed = await TasklyApi.getMessageFeed(lastMessagePollAt);
    const messages = feed.messages || [];
    let maxTs = lastMessagePollAt;

    for (const msg of messages) {
      if (msg.timestamp > maxTs) maxTs = msg.timestamp;
      notifyIncomingMessage(msg);
    }
    lastMessagePollAt = Math.max(lastMessagePollAt, maxTs, Date.now() - 1000);
    saveMessagePollState();
  } catch (err) {
    console.warn('Message poll:', err.message);
  }

  if (chatRefreshNeeded) {
    chatRefreshNeeded = false;
    if (typeof window.renderChatMessages === 'function') window.renderChatMessages();
  }

  try {
    const data = await TasklyApi.getFriends();
    const users = data.users || [];
    (data.incoming || []).forEach(id => {
      const user = users.find(u => u.id === id);
      notifyIncomingFriendRequest(id, user?.username || user?.tag);
    });
    knownIncomingRequests = new Set(data.incoming || []);
    saveMessagePollState();
  } catch (_) {}
}

function startMessageNotificationPoller() {
  if (messagePollTimer) return;
  loadMessagePollState();
  pollMessageNotifications();
  messagePollTimer = setInterval(pollMessageNotifications, 4000);
  window.addEventListener('focus', () => {
    pollMessageNotifications();
  });
}

function initMessageNotifications() {
  const token = localStorage.getItem('userToken') || sessionStorage.getItem('userToken');
  if (!token) return;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  startMessageNotificationPoller();
}



document.addEventListener('DOMContentLoaded', initMessageNotifications);

window.startMessageNotificationPoller = startMessageNotificationPoller;
window.pollMessageNotifications = pollMessageNotifications;
window.initMessageNotifications = initMessageNotifications;
