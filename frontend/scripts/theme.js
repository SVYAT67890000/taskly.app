// Управление темой приложения

// Инициализация темы при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupThemeToggle();
});

// Инициализация темы из localStorage или системных настроек
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Если есть сохраненная тема, используем её, иначе используем системную
  const theme = savedTheme || (prefersDark ? 'dark' : 'light');
  setTheme(theme);
}

// Установка темы
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeIcon(theme);
}

// Переключение темы
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  
  // Анимация переключения
  document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease';
  
  // Показываем уведомление
  showThemeNotification(newTheme);
}

// Обновление иконки темы
function updateThemeIcon(theme) {
  const themeIconHeader = document.querySelector('.theme-icon-header');
  const themeIcon = document.querySelector('.theme-icon');
  const themeText = document.querySelector('.theme-text');
  
  if (themeIconHeader) {
    themeIconHeader.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
  
  if (themeIcon) {
    themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
  
  if (themeText) {
    themeText.textContent = theme === 'dark' ? 'Светлая' : 'Темная';
  }
}

// Настройка кнопки переключения темы
function setupThemeToggle() {
  const themeToggleBtn = document.getElementById('themeToggle');
  
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTheme();
    });
  }
  
  // Слушаем изменения системной темы (только если пользователь не выбрал тему вручную)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const savedTheme = localStorage.getItem('theme');
    // Обновляем только если пользователь не выбрал тему вручную
    if (!savedTheme) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
}

// Показ уведомления о смене темы
function showThemeNotification(theme) {
  const themeName = theme === 'dark' ? 'темная' : 'светлая';
  const notification = document.createElement('div');
  notification.className = 'theme-notification';
  notification.innerHTML = `
    <div class="theme-notification-content">
      <span class="theme-notification-icon">${theme === 'dark' ? '🌙' : '☀️'}</span>
      <span class="theme-notification-text">${themeName.charAt(0).toUpperCase() + themeName.slice(1)} тема активирована</span>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Анимация появления
  setTimeout(() => notification.classList.add('show'), 10);
  
  // Удаление через 2 секунды
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Экспорт функции для использования в других скриптах
window.toggleTheme = toggleTheme;
window.setTheme = setTheme;

