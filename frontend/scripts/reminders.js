
const REMINDER_DEFAULTS = {
  enabled: true,
  leadDays: 1,
  pushEnabled: false
};

let reminderSettings = { ...REMINDER_DEFAULTS };
let reminderIntervalId = null;
let reminderToggleEl;
let reminderSelectEl;
let reminderStatusEl;
let pushToggleEl;
let pushStatusEl;

document.addEventListener('DOMContentLoaded', () => {
  reminderToggleEl = document.getElementById('reminderToggle');
  reminderSelectEl = document.getElementById('reminderLeadTime');
  reminderStatusEl = document.getElementById('reminderStatus');
  pushToggleEl = document.getElementById('pushToggle');
  pushStatusEl = document.getElementById('pushStatus');

  if (!reminderToggleEl || !reminderSelectEl) {
    return;
  }

  reminderSettings = loadReminderSettings();
  reminderToggleEl.checked = reminderSettings.enabled;
  reminderSelectEl.value = String(reminderSettings.leadDays);
  if (pushToggleEl) pushToggleEl.checked = reminderSettings.pushEnabled;
  updateReminderStatus();
  updatePushStatus();

  reminderToggleEl.addEventListener('change', () => {
    reminderSettings.enabled = reminderToggleEl.checked;
    saveReminderSettings(reminderSettings);
    updateReminderStatus();
    restartReminderLoop();
    if (reminderSettings.enabled) {
      requestNotificationPermission();
    }
  });

  reminderSelectEl.addEventListener('change', () => {
    reminderSettings.leadDays = parseInt(reminderSelectEl.value, 10) || REMINDER_DEFAULTS.leadDays;
    saveReminderSettings(reminderSettings);
    updateReminderStatus();
    restartReminderLoop();
  });

  pushToggleEl?.addEventListener('change', async () => {
    try {
      if (pushToggleEl.checked) {
        await subscribeToPushNotifications();
        reminderSettings.pushEnabled = true;
        saveNotificationSettings({ pushEnabled: true });
        showNotification?.('Push-уведомления включены', { type: 'success', icon: 'bell' });
      } else {
        await unsubscribeFromPushNotifications();
        reminderSettings.pushEnabled = false;
        saveNotificationSettings({ pushEnabled: false });
        showNotification?.('Push-уведомления отключены', { type: 'info' });
      }
      saveReminderSettings(reminderSettings);
      updatePushStatus();
    } catch (err) {
      pushToggleEl.checked = false;
      reminderSettings.pushEnabled = false;
      saveReminderSettings(reminderSettings);
      showNotification?.(err.message || 'Не удалось включить push', { type: 'warning' });
      updatePushStatus();
    }
  });

  restartReminderLoop();
  initPushState();
  initNotificationPrefsUI();
});

function initNotificationPrefsUI() {
  if (typeof getNotificationSettings !== 'function') return;
  const s = getNotificationSettings();
  const msgEl = document.getElementById('notifMessages');
  const frEl = document.getElementById('notifFriendRequests');
  const remEl = document.getElementById('notifReminders');
  const soundEl = document.getElementById('notifSound');
  if (msgEl) msgEl.checked = s.messages !== false;
  if (frEl) frEl.checked = s.friendRequests !== false;
  if (remEl) remEl.checked = s.reminders !== false;
  if (soundEl) soundEl.checked = s.sound !== false;

  const bind = (el, key) => {
    el?.addEventListener('change', () => {
      saveNotificationSettings({ [key]: el.checked });
    });
  };
  bind(msgEl, 'messages');
  bind(frEl, 'friendRequests');
  bind(remEl, 'reminders');
  bind(soundEl, 'sound');
}

async function initPushState() {
  if (typeof syncPushSubscriptionState !== 'function') return;
  const state = await syncPushSubscriptionState();
  if (state === 'active') {
    reminderSettings.pushEnabled = true;
    if (pushToggleEl) pushToggleEl.checked = true;
    saveReminderSettings(reminderSettings);
  }
  updatePushStatus();
}

function loadReminderSettings() {
  try {
    const key = getReminderStorageKey('settings');
    const saved = localStorage.getItem(key);
    if (saved) {
      return { ...REMINDER_DEFAULTS, ...JSON.parse(saved) };
    }
    const preferredLeadDays = getStoredReminderPreference();
    if (typeof preferredLeadDays === 'number') {
      return { ...REMINDER_DEFAULTS, leadDays: preferredLeadDays };
    }
  } catch (error) {
    console.error('Ошибка загрузки настроек напоминаний:', error);
  }
  return { ...REMINDER_DEFAULTS };
}

function saveReminderSettings(settings) {
  try {
    const key = getReminderStorageKey('settings');
    localStorage.setItem(key, JSON.stringify(settings));
    persistReminderPreference(settings.leadDays);
  } catch (error) {
    console.error('Ошибка сохранения настроек напоминаний:', error);
  }
}

function getReminderStorageKey(suffix) {
  const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const userId = currentUser?.id || 'anonymous';
  return `taskly.reminders.${userId}.${suffix}`;
}

function restartReminderLoop() {
  if (reminderIntervalId) {
    clearInterval(reminderIntervalId);
  }

  if (!reminderSettings.enabled) {
    return;
  }

  checkUpcomingTasks();
  reminderIntervalId = setInterval(checkUpcomingTasks, 60 * 1000);
}

function checkUpcomingTasks() {
  if (typeof isNotificationEnabled === 'function' && !isNotificationEnabled('reminders')) {
    setReminderStatusText('Уведомления о задачах отключены');
    return;
  }
  let userTasks = [];

  if (typeof getUserTasks === 'function') {
    userTasks = getUserTasks();
  } else {
    const saved = localStorage.getItem('tasks');
    if (saved) {
      try {
        userTasks = JSON.parse(saved);
      } catch (error) {
        console.error('Ошибка чтения задач для напоминаний:', error);
      }
    }
  }

  if (!Array.isArray(userTasks) || userTasks.length === 0) {
    return;
  }

  const pendingTasks = userTasks.filter(task => task.status !== 'completed');
  if (pendingTasks.length === 0) {
    setReminderStatusText('Ближайших задач нет');
    return;
  }

  const now = new Date();
  const leadMs = reminderSettings.leadDays * 24 * 60 * 60 * 1000;
  const history = loadReminderHistory();
  let nearestTask = null;
  let nearestDiff = Infinity;

  pendingTasks.forEach(task => {
    if (!task.date) return;

    const dueDate = new Date(task.date);
    const dueEnd = new Date(dueDate);
    dueEnd.setHours(23, 59, 59, 999);

    const diffMs = dueEnd.getTime() - now.getTime();
    if (diffMs < 0 || diffMs > leadMs) {
      return;
    }

    if (history[task.id] === task.date) {
      return;
    }

    showReminderNotification(task, diffMs);
    history[task.id] = task.date;
  });

  saveReminderHistory(history);

  pendingTasks.forEach(task => {
    if (!task.date) return;
    const dueDate = new Date(task.date);
    const diff = dueDate.getTime() - now.getTime();
    if (diff >= 0 && diff < nearestDiff) {
      nearestDiff = diff;
      nearestTask = task;
    }
  });

  if (nearestTask) {
    const daysLeft = Math.max(0, Math.ceil(nearestDiff / (24 * 60 * 60 * 1000)));
    setReminderStatusText(
      daysLeft === 0
        ? `Ближайшая задача «${nearestTask.title}» сегодня`
        : `Ближайшая задача «${nearestTask.title}» через ${daysLeft} дн.`
    );
  } else {
    setReminderStatusText('Ближайших задач нет');
  }
}

function showReminderNotification(task, diffMs) {
  const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  let message = `«${task.title}» нужно выполнить сегодня`;
  if (daysLeft > 1) message = `«${task.title}» через ${daysLeft} дн.`;
  else if (daysLeft === 1) message = `«${task.title}» — завтра срок`;

  if (typeof showBrowserNotification === 'function' && !reminderSettings.pushEnabled) {
    showBrowserNotification('Таскли — напоминание', message, {
      tag: `task-${task.id}-${task.date}`,
      skipIfVisible: false
    });
  }

  if (typeof showNotification === 'function') {
    showNotification(message, { type: 'warning', icon: 'reminder' });
  }
}

function loadReminderHistory() {
  try {
    const key = getReminderStorageKey('history');
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved) || {};
  } catch (error) {
    console.error('Ошибка чтения истории напоминаний:', error);
  }
  return {};
}

function saveReminderHistory(history) {
  try {
    const key = getReminderStorageKey('history');
    localStorage.setItem(key, JSON.stringify(history));
  } catch (error) {
    console.error('Ошибка сохранения истории напоминаний:', error);
  }
}

function updateReminderStatus() {
  if (!reminderStatusEl) return;
  if (!reminderSettings.enabled) {
    setReminderStatusText('Напоминания отключены');
    return;
  }
  setReminderStatusText(`Будем напоминать ${getLeadDaysText(reminderSettings.leadDays)}`);
}

function updatePushStatus() {
  if (!pushStatusEl) return;
  if (!('PushManager' in window)) {
    pushStatusEl.textContent = 'Push не поддерживается браузером';
    if (pushToggleEl) pushToggleEl.disabled = true;
    return;
  }
  if (reminderSettings.pushEnabled) {
    pushStatusEl.textContent = 'Push включён — уведомления придут даже при закрытой вкладке';
  } else {
    pushStatusEl.textContent = 'Включите push для уведомлений в фоне';
  }
}

function setReminderStatusText(text) {
  if (reminderStatusEl) reminderStatusEl.textContent = text;
}

function getLeadDaysText(value) {
  if (value === 0) return 'в день задачи';
  if (value === 1) return 'за 1 день';
  if (value < 5) return `за ${value} дня`;
  return `за ${value} дней`;
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function persistReminderPreference(leadDays) {
  if (typeof getCurrentUser !== 'function') return;
  const currentUser = getCurrentUser();
  if (!currentUser?.id) return;

  const updatedPreferences = {
    ...(currentUser.preferences || {}),
    reminderLeadDays: leadDays
  };

  localStorage.setItem('currentUser', JSON.stringify({ ...currentUser, preferences: updatedPreferences }));

  if (typeof updateCurrentUserData === 'function') {
    updateCurrentUserData({ preferences: updatedPreferences }).catch(() => {});
  }
}

function getStoredReminderPreference() {
  if (typeof getCurrentUser !== 'function') return null;
  const currentUser = getCurrentUser();
  if (!currentUser?.preferences) return null;
  const value = currentUser.preferences.reminderLeadDays;
  return typeof value === 'number' ? value : null;
}
