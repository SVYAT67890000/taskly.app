function getUnreadStorageKey() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return `taskly.unread.${user?.id || 'anon'}`;
}

function getLastReadStorageKey() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return `taskly.lastRead.${user?.id || 'anon'}`;
}

function loadLastReadMap() {
  try {
    return JSON.parse(localStorage.getItem(getLastReadStorageKey()) || '{}');
  } catch (_) {
    return {};
  }
}

function saveLastReadMap(map) {
  localStorage.setItem(getLastReadStorageKey(), JSON.stringify(map));
}

function loadUnreadCounts() {
  try {
    return JSON.parse(localStorage.getItem(getUnreadStorageKey()) || '{}');
  } catch (_) {
    return {};
  }
}

function saveUnreadCounts(counts) {
  localStorage.setItem(getUnreadStorageKey(), JSON.stringify(counts));
}

function getTotalUnreadCount() {
  const counts = loadUnreadCounts();
  return Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

function getFriendUnreadCount(friendId) {
  return loadUnreadCounts()[friendId] || 0;
}

function incrementUnread(chatKey, amount = 1) {
  if (!chatKey) return;
  const counts = loadUnreadCounts();
  counts[chatKey] = (counts[chatKey] || 0) + amount;
  saveUnreadCounts(counts);
  updateUnreadBadgesUI();
  if (typeof renderNotificationCenter === 'function') renderNotificationCenter();
}

function clearUnread(chatKey) {
  if (!chatKey) return;
  const lastRead = loadLastReadMap();
  lastRead[chatKey] = Date.now();
  saveLastReadMap(lastRead);

  const counts = loadUnreadCounts();
  if (!counts[chatKey]) return;
  delete counts[chatKey];
  saveUnreadCounts(counts);
  updateUnreadBadgesUI();
  if (typeof renderNotificationCenter === 'function') renderNotificationCenter();
}

function syncUnreadFromInbox(messages) {
  const lastRead = loadLastReadMap();
  const counts = {};
  const currentUserId = typeof getCurrentUser === 'function' ? getCurrentUser()?.id : null;

  (messages || []).forEach(msg => {
    if (currentUserId && msg.from === currentUserId) return;
    const key = msg.kind === 'group' ? `grp:${msg.conversationId}` : msg.from;
    const lr = lastRead[key] || 0;
    if ((msg.timestamp || 0) > lr) {
      counts[key] = (counts[key] || 0) + 1;
    }
  });

  saveUnreadCounts(counts);
  updateUnreadBadgesUI();
}

function updateUnreadBadgesUI() {
  const total = getTotalUnreadCount();
  const chatBadge = document.getElementById('chatUnreadBadge');
  if (chatBadge) {
    chatBadge.textContent = total > 99 ? '99+' : String(total);
    chatBadge.classList.toggle('d-none', total <= 0);
  }

  document.querySelectorAll('.friend-item[data-id], .group-item[data-id]').forEach(item => {
    const id = item.dataset.id;
    const count = loadUnreadCounts()[id] || 0;
    let badge = item.querySelector('.friend-unread-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'friend-unread-badge';
        item.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : String(count);
    } else if (badge) {
      badge.remove();
    }
  });

  const navBadge = document.getElementById('navFriendsUnread');
  if (navBadge) {
    navBadge.textContent = total > 99 ? '99+' : String(total);
    navBadge.classList.toggle('d-none', total <= 0);
  }
}

window.loadUnreadCounts = loadUnreadCounts;
window.getTotalUnreadCount = getTotalUnreadCount;
window.incrementUnread = incrementUnread;
window.clearUnread = clearUnread;
window.updateUnreadBadgesUI = updateUnreadBadgesUI;
window.syncUnreadFromInbox = syncUnreadFromInbox;
