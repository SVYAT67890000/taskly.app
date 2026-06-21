const NOTIFICATION_DEFAULTS = {
  messages: true,
  reminders: true,
  friendRequests: true,
  pushEnabled: false,
  sound: true
};

function getNotificationSettings() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const stored = user?.preferences?.notifications || {};
  try {
    const local = JSON.parse(localStorage.getItem('taskly.notifications') || '{}');
    return { ...NOTIFICATION_DEFAULTS, ...local, ...stored };
  } catch (_) {
    return { ...NOTIFICATION_DEFAULTS, ...stored };
  }
}

function saveNotificationSettings(settings) {
  const merged = { ...getNotificationSettings(), ...settings };
  localStorage.setItem('taskly.notifications', JSON.stringify(merged));

  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user) return merged;

  const preferences = {
    ...(user.preferences || {}),
    notifications: merged
  };
  localStorage.setItem('currentUser', JSON.stringify({ ...user, preferences }));

  if (typeof updateCurrentUserData === 'function') {
    updateCurrentUserData({ preferences }).catch(() => {});
  }
  return merged;
}

function isNotificationEnabled(type) {
  const s = getNotificationSettings();
  return s[type] !== false;
}

window.getNotificationSettings = getNotificationSettings;
window.saveNotificationSettings = saveNotificationSettings;
window.isNotificationEnabled = isNotificationEnabled;
