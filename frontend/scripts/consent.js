const CONSENT_KEYS = {
  cookies: 'taskly.consent.cookies',
  personalData: 'taskly.consent.personalData'
};

function getCookieConsent() {
  try {
    return JSON.parse(localStorage.getItem(CONSENT_KEYS.cookies) || 'null');
  } catch {
    return null;
  }
}

function setCookieConsent(accepted) {
  localStorage.setItem(CONSENT_KEYS.cookies, JSON.stringify({
    accepted,
    date: new Date().toISOString()
  }));
}

function getPersonalDataConsent() {
  try {
    return JSON.parse(localStorage.getItem(CONSENT_KEYS.personalData) || 'null');
  } catch {
    return null;
  }
}

function setPersonalDataConsent(accepted) {
  localStorage.setItem(CONSENT_KEYS.personalData, JSON.stringify({
    accepted,
    date: new Date().toISOString()
  }));
}

function isRegisterPage() {
  return window.location.pathname.includes('register');
}

function closeConsentEl(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function showPersonalDataModal(options = {}) {
  if (getPersonalDataConsent()?.accepted && !options.force) return false;
  if (document.getElementById('personalDataConsentModal')) return true;

  const overlay = document.createElement('div');
  overlay.className = 'consent-overlay consent-overlay-center';
  overlay.id = 'personalDataConsentModal';
  overlay.innerHTML = `
    <div class="consent-modal consent-modal-center" role="dialog" aria-labelledby="personalDataTitle" aria-modal="true">
      <div class="consent-modal-header">
        <h2 id="personalDataTitle">Обработка персональных данных</h2>
      </div>
      <div class="consent-modal-body">
        <p>Для регистрации и работы в Таскли мы обрабатываем ваши данные: имя, email, задачи, проекты и сообщения.</p>
        <p>Нажимая «Принимаю», вы даёте согласие на обработку персональных данных в соответствии с
          <a href="privacy.html" target="_blank" rel="noopener">политикой</a>.</p>
      </div>
      <div class="consent-modal-actions">
        <button type="button" class="consent-btn consent-btn-secondary" id="personalDataDeclineBtn">Отклонить</button>
        <button type="button" class="consent-btn consent-btn-primary" id="personalDataAcceptBtn">Принимаю</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('consent-modal-open');

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && options.allowBackdropClose) {
      closePersonalDataModal();
    }
  });

  document.getElementById('personalDataAcceptBtn')?.addEventListener('click', () => {
    setPersonalDataConsent(true);
    closePersonalDataModal();
    options.onAccept?.();
  });

  document.getElementById('personalDataDeclineBtn')?.addEventListener('click', () => {
    setPersonalDataConsent(false);
    closePersonalDataModal();
    if (options.onDecline) {
      options.onDecline();
    } else if (isRegisterPage()) {
      window.location.href = 'login.html';
    }
  });

  return true;
}

function closePersonalDataModal() {
  closeConsentEl('personalDataConsentModal');
  if (!document.getElementById('cookieConsentModal')) {
    document.body.classList.remove('consent-modal-open');
  }
}

function showCookieModal() {
  if (getCookieConsent()) return;
  if (document.getElementById('cookieConsentModal')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'consent-bottom-fixed';
  wrapper.id = 'cookieConsentModal';
  wrapper.innerHTML = `
    <div class="consent-modal consent-modal-bottom" role="dialog" aria-labelledby="cookieTitle" aria-modal="true">
      <div class="consent-modal-header">
        <h2 id="cookieTitle">Мы используем cookies</h2>
      </div>
      <div class="consent-modal-body">
        <p>Таскли сохраняет технические cookies и данные в localStorage для входа, темы оформления и работы сервиса.</p>
        <p>Подробнее в <a href="cookies.html" target="_blank" rel="noopener">политике cookies</a>.</p>
      </div>
      <div class="consent-modal-actions">
        <button type="button" class="consent-btn consent-btn-secondary" id="cookieRejectBtn">Только необходимые</button>
        <button type="button" class="consent-btn consent-btn-primary" id="cookieAcceptBtn">Принять все</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  document.getElementById('cookieAcceptBtn')?.addEventListener('click', () => {
    setCookieConsent(true);
    closeCookieModal();
  });
  document.getElementById('cookieRejectBtn')?.addEventListener('click', () => {
    setCookieConsent(false);
    closeCookieModal();
  });
}

function closeCookieModal() {
  closeConsentEl('cookieConsentModal');
  if (!document.getElementById('personalDataConsentModal')) {
    document.body.classList.remove('consent-modal-open');
  }
}

function initConsents() {
  showCookieModal();
  if (isRegisterPage() && !getPersonalDataConsent()?.accepted) {
    showPersonalDataModal();
  }
}

document.addEventListener('DOMContentLoaded', initConsents);

window.getCookieConsent = getCookieConsent;
window.setCookieConsent = setCookieConsent;
window.getPersonalDataConsent = getPersonalDataConsent;
window.setPersonalDataConsent = setPersonalDataConsent;
window.showPersonalDataModal = showPersonalDataModal;
window.showCookieModal = showCookieModal;
