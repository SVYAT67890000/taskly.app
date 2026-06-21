(function registerTasklyPwa() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('Таскли PWA: service worker зарегистрирован', reg.scope);
      })
      .catch((err) => {
        console.warn('Таскли PWA: ошибка регистрации SW', err);
      });
  });

  let deferredInstallPrompt = null;
  const INSTALL_DISMISSED_KEY = 'taskly.pwa.installDismissed';

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBanner();
  });

  function showInstallBanner() {
    if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
    if (document.getElementById('pwaInstallBanner')) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const banner = document.createElement('div');
    banner.className = 'pwa-install-banner';
    banner.id = 'pwaInstallBanner';
    banner.innerHTML = `
      <div class="pwa-install-content">
        <img src="/assets/icons/icon-192.png" alt="" width="40" height="40" class="pwa-install-icon">
        <div class="pwa-install-text">
          <strong>Установить Таскли</strong>
          <span>Добавьте приложение на главный экран</span>
        </div>
        <div class="pwa-install-actions">
          <button type="button" class="consent-btn consent-btn-secondary" id="pwaInstallDismiss">Позже</button>
          <button type="button" class="consent-btn consent-btn-primary" id="pwaInstallBtn">Установить</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      banner.remove();
    });

    document.getElementById('pwaInstallDismiss')?.addEventListener('click', () => {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      banner.remove();
    });
  }

  window.installTasklyPwa = async function installTasklyPwa() {
    if (!deferredInstallPrompt) return false;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return outcome === 'accepted';
  };
})();
