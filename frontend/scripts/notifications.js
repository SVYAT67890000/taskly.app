
const NOTIFICATION_TIMEOUT = 4000;
const ICON_NAMES = {
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  warning: 'alert-circle-outline',
  message: 'chatbubble-outline',
  friend: 'person-add-outline',
  reminder: 'time-outline',
  bell: 'notifications-outline'
};

let notificationTimer = null;
let audioCtx = null;

function getToastIconName(type, customIcon) {
  if (customIcon && ICON_NAMES[customIcon]) return ICON_NAMES[customIcon];
  if (typeof customIcon === 'string' && customIcon.endsWith('-outline')) return customIcon;
  return ICON_NAMES[type] || ICON_NAMES.info;
}

function playNotificationSound() {
  if (typeof isNotificationEnabled === 'function' && !isNotificationEnabled('sound')) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.26);
  } catch (_) {}
}

function showNotification(message, options = {}) {
  const { type = 'info', icon, silent = false } = options;
  if (!message) return;

  const existingToast = document.querySelector('.notification-toast');
  existingToast?.remove();

  const iconName = getToastIconName(type, icon);
  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.setAttribute('data-type', type);
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-icon"><ion-icon name="${iconName}"></ion-icon></div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  if (!silent) playNotificationSound();

  if (notificationTimer) clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, options.duration || NOTIFICATION_TIMEOUT);
}

window.showNotification = showNotification;
window.playNotificationSound = playNotificationSound;
