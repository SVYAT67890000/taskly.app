function updateThemeIcon(theme) {
  const iconName = theme === 'dark' ? 'sunny-outline' : 'moon-outline';
  document.querySelectorAll('.theme-icon-header, .theme-icon').forEach(el => {
    el.innerHTML = `<ion-icon name="${iconName}"></ion-icon>`;
  });
  const themeText = document.querySelector('.theme-text');
  if (themeText) themeText.textContent = theme === 'dark' ? 'Светлая' : 'Тёмная';
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupThemeToggle();
});

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeIcon(theme);
  window.dispatchEvent(new CustomEvent('taskly-theme-change', { detail: { theme } }));
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  showThemeNotification(document.documentElement.getAttribute('data-theme'));
}

function setupThemeToggle() {
  document.getElementById('themeToggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleTheme();
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) setTheme(e.matches ? 'dark' : 'light');
  });
}

function showThemeNotification(theme) {
  const iconName = theme === 'dark' ? 'moon-outline' : 'sunny-outline';
  const themeName = theme === 'dark' ? 'Тёмная' : 'Светлая';
  const notification = document.createElement('div');
  notification.className = 'theme-notification';
  notification.innerHTML = `
    <div class="theme-notification-content">
      <span class="theme-notification-icon"><ion-icon name="${iconName}"></ion-icon></span>
      <span class="theme-notification-text">${themeName} тема</span>
    </div>
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.classList.add('show'), 10);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

window.toggleTheme = toggleTheme;
window.setTheme = setTheme;
