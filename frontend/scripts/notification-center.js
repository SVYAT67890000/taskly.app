const NOTIF_DISMISSED_KEY = 'taskly.notifDismissed';

function getDismissedStorageKey() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return `${NOTIF_DISMISSED_KEY}.${user?.id || 'anon'}`;
}

function getDismissedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(getDismissedStorageKey()) || '[]'));
  } catch (_) {
    return new Set();
  }
}

function saveDismissedIds(set) {
  localStorage.setItem(getDismissedStorageKey(), JSON.stringify([...set].slice(-100)));
}

function dismissNotification(id) {
  const set = getDismissedIds();
  set.add(id);
  saveDismissedIds(set);
  renderNotificationCenter();
}

function buildDeadlineNotifications() {
  const items = [];
  if (typeof getUserTasks !== 'function') return items;
  const tasks = getUserTasks().filter(t => t.status !== 'completed' && t.date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  tasks.forEach(task => {
    const due = new Date(task.date);
    if (Number.isNaN(due.getTime())) return;
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays = Math.round((dueDay - today) / 86400000);
    if (diffDays < 0 || diffDays > 3) return;

    const id = `deadline-${task.id}-${task.date}`;
    if (getDismissedIds().has(id)) return;

    let label = 'Сегодня';
    if (diffDays === 1) label = 'Завтра';
    else if (diffDays > 1) label = `Через ${diffDays} дн.`;
    else if (diffDays < 0) label = 'Просрочено';

    items.push({
      id,
      type: 'deadline',
      title: diffDays < 0 ? 'Просроченная задача' : 'Дедлайн задачи',
      body: `${task.title} — ${label}`,
      href: 'index.html',
      time: due.getTime(),
      icon: 'calendar'
    });
  });

  return items;
}

function unreadKeyMeta(key, users) {
  if (String(key).startsWith('grp:')) {
    const convId = key.slice(4);
    return {
      id: `msg-unread-${key}`,
      title: 'Беседа',
      bodyPrefix: 'Новые сообщения',
      href: `friends.html?group=${convId}`,
      icon: 'people'
    };
  }
  const user = (users || []).find(u => u.id === key);
  return {
    id: `msg-unread-${key}`,
    title: 'Непрочитанные сообщения',
    bodyPrefix: user?.username || 'Друг',
    href: `friends.html?chat=${key}`,
    icon: 'chatbubble'
  };
}

function buildUnreadMessageNotifications() {
  const items = [];
  if (typeof loadUnreadCounts !== 'function') return items;
  const counts = loadUnreadCounts();
  const users = typeof getUsers === 'function' ? getUsers() : [];
  const dismissed = getDismissedIds();

  Object.entries(counts).forEach(([key, count]) => {
    if (!count) return;
    const meta = unreadKeyMeta(key, users);
    if (dismissed.has(meta.id)) return;
    items.push({
      id: meta.id,
      type: 'message',
      title: meta.title,
      body: `${meta.bodyPrefix}: ${count} нов.`,
      href: meta.href,
      time: Date.now(),
      icon: meta.icon
    });
  });

  return items;
}

async function syncInboxUnread() {
  if (typeof TasklyApi === 'undefined') return;
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    const inbox = await TasklyApi.getMessageInbox(since);
    if (typeof syncUnreadFromInbox === 'function') {
      syncUnreadFromInbox(inbox.messages || []);
    }
  } catch (_) {}
}

function buildFriendRequestNotifications(incoming, users) {
  const items = [];
  (incoming || []).forEach(userId => {
    const id = `friend-req-${userId}`;
    if (getDismissedIds().has(id)) return;
    const user = (users || []).find(u => u.id === userId);
    items.push({
      id,
      type: 'friend',
      title: 'Заявка в друзья',
      body: `${user?.username || 'Пользователь'} хочет добавить вас`,
      href: 'friends.html?panel=requests',
      time: Date.now(),
      icon: 'person-add'
    });
  });
  return items;
}

function buildSupportReplyNotifications(tickets) {
  const items = [];
  (tickets || []).forEach(t => {
    if (!t.adminReply || t.status === 'closed') return;
    const id = `support-${t.id}-${t.updatedAt}`;
    if (getDismissedIds().has(id)) return;
    items.push({
      id,
      type: 'support',
      title: 'Ответ поддержки',
      body: t.subject,
      href: 'support.html',
      time: new Date(t.updatedAt).getTime(),
      icon: 'help-circle'
    });
  });
  return items;
}

function dedupeNotifications(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.type}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectNotifications() {
  await syncInboxUnread();
  const items = dedupeNotifications([
    ...buildDeadlineNotifications(),
    ...buildUnreadMessageNotifications()
  ]);

  try {
    if (typeof TasklyApi !== 'undefined') {
      const friendsData = await TasklyApi.getFriends();
      items.push(...buildFriendRequestNotifications(friendsData.incoming, friendsData.users));

      const supportData = await TasklyApi.getSupportTickets();
      items.push(...buildSupportReplyNotifications(supportData.tickets));
    }
  } catch (_) {}

  items.sort((a, b) => b.time - a.time);
  return dedupeNotifications(items).slice(0, 30);
}

function updateBellBadge(count) {
  const badge = document.getElementById('notificationBellBadge');
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('d-none', count <= 0);
}

async function renderNotificationCenter() {
  const dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) return;

  const items = await collectNotifications();
  updateBellBadge(items.length);

  if (!items.length) {
    dropdown.innerHTML = '<div class="notification-empty">Нет новых уведомлений</div>';
    return;
  }

  dropdown.innerHTML = items.map(item => `
    <div class="notification-item" data-id="${item.id}">
      <a class="notification-item-link" href="${item.href}">
        <span class="notification-item-icon"><ion-icon name="${item.icon}-outline"></ion-icon></span>
        <span class="notification-item-body">
          <strong>${escapeNotifHtml(item.title)}</strong>
          <span>${escapeNotifHtml(item.body)}</span>
        </span>
      </a>
      <button type="button" class="notification-dismiss" data-dismiss="${item.id}" aria-label="Скрыть">&times;</button>
    </div>
  `).join('');

  dropdown.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissNotification(btn.dataset.dismiss);
    });
  });
}

function escapeNotifHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toggleNotificationDropdown(force) {
  const dropdown = document.getElementById('notificationDropdown');
  const btn = document.getElementById('notificationBellBtn');
  if (!dropdown || !btn) return;

  const open = force !== undefined ? force : dropdown.classList.contains('d-none');
  dropdown.classList.toggle('d-none', !open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) renderNotificationCenter();
}

function bindNotificationBell() {
  const btn = document.getElementById('notificationBellBtn');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNotificationDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notification-bell-wrap')) {
      toggleNotificationDropdown(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleNotificationDropdown(false);
  });
}

function ensureNotificationBell() {
  const navbarRight = document.querySelector('.navbar-right');
  if (!navbarRight || document.getElementById('notificationBellBtn')) return;

  const token = localStorage.getItem('userToken') || sessionStorage.getItem('userToken');
  if (!token) return;

  const wrap = document.createElement('div');
  wrap.className = 'notification-bell-wrap';
  wrap.innerHTML = `
    <button type="button" class="notification-bell-btn btn-icon-only" id="notificationBellBtn" title="Уведомления" aria-expanded="false">
      <ion-icon name="notifications-outline"></ion-icon>
      <span class="notification-bell-badge d-none" id="notificationBellBadge">0</span>
    </button>
    <div class="notification-dropdown d-none" id="notificationDropdown"></div>
  `;

  const themeBtn = navbarRight.querySelector('#themeToggle');
  if (themeBtn) {
    navbarRight.insertBefore(wrap, themeBtn);
  } else {
    navbarRight.prepend(wrap);
  }

  bindNotificationBell();
  renderNotificationCenter();
}

function startNotificationCenterPoller() {
  ensureNotificationBell();
  renderNotificationCenter();
  setInterval(renderNotificationCenter, 12000);
}

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('userToken') || sessionStorage.getItem('userToken');
  if (!token) return;
  startNotificationCenterPoller();
});

window.ensureNotificationBell = ensureNotificationBell;
window.renderNotificationCenter = renderNotificationCenter;
window.updateBellBadge = updateBellBadge;
