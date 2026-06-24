const LOGOUT_MODAL_HTML = `
<div class="modal fade" id="logoutConfirmModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-modern">
    <div class="modal-content-modern">
      <div class="modal-header-modern">
        <div class="modal-header-content">
          <h5 class="modal-title-modern">Подтвердите выход</h5>
          <button type="button" class="btn-close-modern" data-bs-dismiss="modal" aria-label="Close"><span>&times;</span></button>
        </div>
      </div>
      <div class="modal-body-modern"><p>Вы действительно хотите выйти из аккаунта?</p></div>
      <div class="modal-actions">
        <button type="button" class="btn-cancel" data-bs-dismiss="modal">Отмена</button>
        <button type="button" class="btn-submit" id="confirmLogoutBtn"><span>Выйти</span></button>
      </div>
    </div>
  </div>
</div>`;

const DELETE_NOTE_MODAL_HTML = `
<div class="modal fade" id="deleteNoteModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-modern">
    <div class="modal-content-modern">
      <div class="modal-header-modern">
        <div class="modal-header-content">
          <h5 class="modal-title-modern">Удалить заметку?</h5>
          <button type="button" class="btn-close-modern" data-bs-dismiss="modal" aria-label="Close"><span>&times;</span></button>
        </div>
      </div>
      <div class="modal-body-modern"><p id="deleteNoteModalText">Заметка будет удалена без возможности восстановления.</p></div>
      <div class="modal-actions">
        <button type="button" class="btn-cancel" data-bs-dismiss="modal">Отмена</button>
        <button type="button" class="btn-submit btn-danger-solid" id="confirmDeleteNoteBtn">Удалить</button>
      </div>
    </div>
  </div>
</div>`;

const IMAGE_LIGHTBOX_HTML = `
<div id="imageLightbox" class="image-lightbox d-none" role="dialog" aria-modal="true">
  <button type="button" class="image-lightbox-close" id="imageLightboxClose" aria-label="Закрыть">&times;</button>
  <img id="imageLightboxImg" alt="">
</div>`;

const APP_ERROR_MODAL_HTML = `
<div id="appErrorModal" class="app-modal app-modal-hidden" role="alertdialog" aria-modal="true" aria-labelledby="appErrorTitle">
  <div class="app-modal-backdrop" data-close-error></div>
  <div class="app-modal-dialog">
    <div class="app-modal-header">
      <span class="app-modal-icon" aria-hidden="true">!</span>
      <h5 id="appErrorTitle">Ошибка</h5>
    </div>
    <div id="appErrorMessage" class="app-modal-text"></div>
    <div class="app-modal-actions">
      <button type="button" class="btn-primary" id="appErrorOkBtn">Понятно</button>
    </div>
  </div>
</div>`;

let lastErrorShownAt = 0;
let errorModalBound = false;

function hideAppError() {
  document.getElementById('appErrorModal')?.classList.add('app-modal-hidden');
}

function ensureErrorModal() {
  if (document.getElementById('appErrorModal')) return;
  document.body.insertAdjacentHTML('beforeend', APP_ERROR_MODAL_HTML);
  if (errorModalBound) return;
  errorModalBound = true;
  const modal = document.getElementById('appErrorModal');
  document.getElementById('appErrorOkBtn')?.addEventListener('click', hideAppError);
  modal?.querySelector('[data-close-error]')?.addEventListener('click', hideAppError);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('app-modal-hidden')) hideAppError();
  });
}

function showAppError(title, message) {
  const now = Date.now();
  if (now - lastErrorShownAt < 800) return;
  lastErrorShownAt = now;

  ensureErrorModal();
  const titleEl = document.getElementById('appErrorTitle');
  const msgEl = document.getElementById('appErrorMessage');
  const text = String(message ?? '').trim() || 'Что-то пошло не так. Попробуйте ещё раз.';
  if (titleEl) titleEl.textContent = String(title || 'Ошибка').trim() || 'Ошибка';
  if (msgEl) msgEl.textContent = text;
  document.getElementById('appErrorModal')?.classList.remove('app-modal-hidden');
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(email || '').trim());
}

function validateUsername(name) {
  const v = String(name || '').trim();
  return v.length >= 2 && v.length <= 32 && /^[\wа-яА-ЯёЁ.\- ]+$/u.test(v);
}

function validatePassword(password) {
  const v = String(password || '');
  if (v.length < 6) return 'Пароль должен содержать минимум 6 символов';
  if (v.length > 128) return 'Пароль слишком длинный';
  return null;
}

const DELETE_TASK_MODAL_HTML = `
<div class="modal fade" id="deleteTaskModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-modern">
    <div class="modal-content-modern">
      <div class="modal-header-modern">
        <div class="modal-header-content">
          <h5 class="modal-title-modern">Удалить задачу?</h5>
          <button type="button" class="btn-close-modern" data-bs-dismiss="modal" aria-label="Close"><span>&times;</span></button>
        </div>
      </div>
      <div class="modal-body-modern"><p id="deleteTaskModalText">Задача будет удалена без возможности восстановления.</p></div>
      <div class="modal-actions">
        <button type="button" class="btn-cancel" data-bs-dismiss="modal">Отмена</button>
        <button type="button" class="btn-submit btn-danger-solid" id="confirmDeleteTaskBtn">Удалить</button>
      </div>
    </div>
  </div>
</div>`;

const SITE_FOOTER_HTML = `
<footer class="site-footer">
  <div class="site-footer-inner">
    <span class="site-footer-copy">© ${new Date().getFullYear()} Таскли. Все права защищены.</span>
    <nav class="site-footer-links">
      <a href="guide.html">Руководство</a>
      <a href="privacy.html" target="_blank" rel="noopener">Конфиденциальность</a>
      <a href="cookies.html" target="_blank" rel="noopener">Cookies</a>
    </nav>
  </div>
</footer>`;

let pendingDeleteTaskId = null;

function ensureDeleteTaskModal() {
  if (document.getElementById('deleteTaskModal')) return;
  document.body.insertAdjacentHTML('beforeend', DELETE_TASK_MODAL_HTML);
  document.getElementById('confirmDeleteTaskBtn')?.addEventListener('click', () => {
    const id = pendingDeleteTaskId;
    pendingDeleteTaskId = null;
    if (id && typeof deleteTaskById === 'function') {
      deleteTaskById(id);
      if (typeof renderTasks === 'function') renderTasks();
      if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
        loadTasksForCalendar();
        renderCalendar();
      }
    }
    if (typeof bootstrap !== 'undefined') {
      bootstrap.Modal.getInstance(document.getElementById('deleteTaskModal'))?.hide();
    }
    if (typeof showNotification === 'function') showNotification('Задача удалена');
  });
}

function confirmDeleteTask(taskId, taskTitle) {
  ensureDeleteTaskModal();
  pendingDeleteTaskId = taskId;
  const textEl = document.getElementById('deleteTaskModalText');
  if (textEl) {
    textEl.textContent = taskTitle
      ? `Удалить задачу «${taskTitle}»? Это действие необратимо.`
      : 'Задача будет удалена без возможности восстановления.';
  }
  if (typeof bootstrap !== 'undefined') {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteTaskModal')).show();
  } else if (confirm('Удалить задачу?')) {
    deleteTaskById?.(taskId);
  }
}

function ensureSiteFooter() {
  if (document.querySelector('.site-footer')) return;
  if (document.body.classList.contains('mindmap-body')) return;
  if (window.location.pathname.includes('login') || window.location.pathname.includes('register')) return;
  document.body.insertAdjacentHTML('beforeend', SITE_FOOTER_HTML);
}

function ensureSharedModals() {
  ensureDeleteTaskModal();
  const hasLogoutTrigger = document.getElementById('menuLogoutBtn') || document.getElementById('logoutBtn');
  if (hasLogoutTrigger && !document.getElementById('logoutConfirmModal')) {
    document.body.insertAdjacentHTML('beforeend', LOGOUT_MODAL_HTML);
  }
  if (!document.getElementById('deleteNoteModal') && document.getElementById('notesGrid')) {
    document.body.insertAdjacentHTML('beforeend', DELETE_NOTE_MODAL_HTML);
  }
  if (!document.getElementById('imageLightbox')) {
    document.body.insertAdjacentHTML('beforeend', IMAGE_LIGHTBOX_HTML);
    document.getElementById('imageLightboxClose')?.addEventListener('click', () => {
      if (typeof closeImageLightbox === 'function') closeImageLightbox();
    });
    document.getElementById('imageLightbox')?.addEventListener('click', (e) => {
      if (e.target.id === 'imageLightbox' && typeof closeImageLightbox === 'function') closeImageLightbox();
    });
  }
}

function normalizeBrandText() {
  document.querySelectorAll('.brand-text').forEach(el => {
    if (el.textContent.trim() === 'Taskly') el.textContent = 'Таскли';
  });
  if (document.title.includes('Taskly')) {
    document.title = document.title.replace(/Taskly/g, 'Таскли');
  }
}

function ensureBrandLogo() {
  document.querySelectorAll('.navbar-brand-modern').forEach(link => {
    if (link.querySelector('.brand-logo')) return;
    const text = link.querySelector('.brand-text');
    if (!text) return;
    const img = document.createElement('img');
    img.src = '/assets/logo.svg';
    img.alt = '';
    img.className = 'brand-logo';
    img.width = 28;
    img.height = 28;
    link.insertBefore(img, text);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  ensureSharedModals();
  ensureErrorModal();
  hideAppError();
  normalizeBrandText();
  ensureBrandLogo();
  ensureSiteFooter();
});

const CONFIRM_ACTION_MODAL_HTML = `
<div class="modal fade" id="confirmActionModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-modern">
    <div class="modal-content-modern">
      <div class="modal-header-modern">
        <div class="modal-header-content">
          <h5 class="modal-title-modern" id="confirmActionTitle">Подтвердите действие</h5>
          <button type="button" class="btn-close-modern" data-bs-dismiss="modal" aria-label="Close"><span>&times;</span></button>
        </div>
      </div>
      <div class="modal-body-modern"><p id="confirmActionText">Вы уверены?</p></div>
      <div class="modal-actions">
        <button type="button" class="btn-cancel" data-bs-dismiss="modal">Отмена</button>
        <button type="button" class="btn-submit btn-danger-solid" id="confirmActionBtn">Подтвердить</button>
      </div>
    </div>
  </div>
</div>`;

let pendingConfirmAction = null;

function ensureConfirmActionModal() {
  if (document.getElementById('confirmActionModal')) return;
  document.body.insertAdjacentHTML('beforeend', CONFIRM_ACTION_MODAL_HTML);
  document.getElementById('confirmActionBtn')?.addEventListener('click', () => {
    const cb = pendingConfirmAction;
    pendingConfirmAction = null;
    if (typeof bootstrap !== 'undefined') {
      bootstrap.Modal.getInstance(document.getElementById('confirmActionModal'))?.hide();
    }
    if (typeof cb === 'function') cb();
  });
}

function confirmAction(title, text, callback) {
  ensureConfirmActionModal();
  document.getElementById('confirmActionTitle').textContent = title;
  document.getElementById('confirmActionText').textContent = text;
  pendingConfirmAction = callback;
  if (typeof bootstrap !== 'undefined') {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('confirmActionModal')).show();
  }
}

window.ensureSharedModals = ensureSharedModals;
window.confirmAction = confirmAction;
window.showAppError = showAppError;
window.hideAppError = hideAppError;
window.validateEmail = validateEmail;
window.validateUsername = validateUsername;
window.validatePassword = validatePassword;
window.confirmDeleteTask = confirmDeleteTask;
