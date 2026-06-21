function initPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.toggleBound === '1') return;
    input.dataset.toggleBound = '1';

    const host = input.closest('.inputbox') || input.closest('.form-group-modern') || input.parentElement;
    if (!host) return;

    host.classList.add('has-password-toggle');
    host.querySelector('ion-icon[name="lock-closed-outline"]')?.remove();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle-btn';
    btn.setAttribute('aria-label', 'Показать пароль');
    btn.innerHTML = '<ion-icon name="eye-outline"></ion-icon>';

    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      const icon = btn.querySelector('ion-icon');
      if (icon) icon.setAttribute('name', show ? 'eye-off-outline' : 'eye-outline');
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    });

    host.appendChild(btn);
  });
}

document.addEventListener('DOMContentLoaded', () => initPasswordToggles());
window.initPasswordToggles = initPasswordToggles;
