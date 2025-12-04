// Универсальные всплывающие уведомления

const NOTIFICATION_TIMEOUT = 4000;

let notificationTimer = null;

/**
 * Показывает toast-уведомление в правом нижнем углу
 * @param {string} message - текст уведомления
 * @param {Object} options - дополнительные настройки
 * @param {'info'|'success'|'warning'} [options.type='info'] - тип уведомления
 * @param {string} [options.icon] - кастомная иконка
 */
function showNotification(message, options = {}) {
  const { type = 'info', icon } = options;

  if (!message) {
    return;
  }

  // Удаляем предыдущее уведомление, чтобы не накапливались
  const existingToast = document.querySelector('.notification-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const iconsMap = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️'
  };

  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.setAttribute('data-type', type);
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-icon">${icon || iconsMap[type] || 'ℹ️'}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  document.body.appendChild(toast);

  // Анимация появления
  requestAnimationFrame(() => toast.classList.add('show'));

  if (notificationTimer) {
    clearTimeout(notificationTimer);
  }

  notificationTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, NOTIFICATION_TIMEOUT);
}

window.showNotification = showNotification;


