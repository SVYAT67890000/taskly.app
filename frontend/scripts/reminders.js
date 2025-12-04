// Напоминания о задачах

const REMINDER_DEFAULTS = {
  enabled: true,
  leadDays: 1
};

let reminderSettings = { ...REMINDER_DEFAULTS };
let reminderIntervalId = null;
let reminderToggleEl;
let reminderSelectEl;
let reminderStatusEl;

document.addEventListener('DOMContentLoaded', () => {
  reminderToggleEl = document.getElementById('reminderToggle');
  reminderSelectEl = document.getElementById('reminderLeadTime');
  reminderStatusEl = document.getElementById('reminderStatus');

  if (!reminderToggleEl || !reminderSelectEl) {
    return;
  }

  reminderSettings = loadReminderSettings();
  reminderToggleEl.checked = reminderSettings.enabled;
  reminderSelectEl.value = String(reminderSettings.leadDays);
  updateReminderStatus();

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

  restartReminderLoop();
  requestNotificationPermission();
});

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
    // учитываем весь день задачи
    const dueEnd = new Date(dueDate);
    dueEnd.setHours(23, 59, 59, 999);

    const diffMs = dueEnd.getTime() - now.getTime();
    if (diffMs < 0 || diffMs > leadMs) {
      return;
    }

    // Проверяем, не отправляли ли уже напоминание
    if (history[task.id] === task.date) {
      return;
    }

    showReminderNotification(task, diffMs);
    history[task.id] = task.date;
  });

  saveReminderHistory(history);

  // Показываем ближайшую дату в статусе
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
  const minutesLeft = Math.ceil(diffMs / (60 * 1000));
  let message = `«${task.title}» нужно выполнить сегодня`;

  if (minutesLeft > 60) {
    const hoursLeft = Math.ceil(minutesLeft / 60);
    message = `«${task.title}» запланирована через ${hoursLeft} ч.`;
  } else if (minutesLeft > 0) {
    message = `«${task.title}» запланирована через ${minutesLeft} мин.`;
  }

  if (typeof showNotification === 'function') {
    showNotification(message, { type: 'warning', icon: '⏰' });
  } else {
    alert(message);
  }
}

function loadReminderHistory() {
  try {
    const key = getReminderStorageKey('history');
    const saved = localStorage.getItem(key);
    if (saved) {
      return JSON.parse(saved) || {};
    }
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

  const leadDaysText = getLeadDaysText(reminderSettings.leadDays);
  setReminderStatusText(`Будем напоминать ${leadDaysText}`);
}

function setReminderStatusText(text) {
  if (reminderStatusEl) {
    reminderStatusEl.textContent = text;
  }
}

function getLeadDaysText(value) {
  if (value === 0) return 'в день задачи';
  if (value === 1) return 'за 1 день';
  if (value < 5) return `за ${value} дня`;
  return `за ${value} дней`;
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function persistReminderPreference(leadDays) {
  if (typeof getCurrentUser !== 'function') return;
  const currentUser = getCurrentUser();
  if (!currentUser || !currentUser.id) return;
  
  const updatedPreferences = {
    ...(currentUser.preferences || {}),
    reminderLeadDays: leadDays
  };
  
  const updatedUser = { ...currentUser, preferences: updatedPreferences };
  localStorage.setItem('currentUser', JSON.stringify(updatedUser));
  
  if (typeof getUsers === 'function') {
    const users = getUsers();
    const userIndex = users.findIndex(user => user.id === currentUser.id);
    if (userIndex >= 0) {
      users[userIndex] = { ...users[userIndex], preferences: updatedPreferences };
      localStorage.setItem('users', JSON.stringify(users));
    }
  }
}

function getStoredReminderPreference() {
  if (typeof getCurrentUser !== 'function') return null;
  const currentUser = getCurrentUser();
  if (!currentUser || !currentUser.preferences) return null;
  const value = currentUser.preferences.reminderLeadDays;
  return typeof value === 'number' ? value : null;
}


