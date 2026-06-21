const STATUS_LABELS = {
  open: 'Открыто',
  in_progress: 'В работе',
  resolved: 'Решено',
  closed: 'Закрыто'
};

const CATEGORY_LABELS = {
  bug: 'Сбой',
  feature: 'Предложение',
  account: 'Аккаунт',
  other: 'Другое'
};

let supportIsAdmin = false;

document.addEventListener('DOMContentLoaded', () => {
  if (!getCurrentUser?.()) return;
  setupSupportForm();
  loadTickets();
});

function setupSupportForm() {
  const form = document.getElementById('supportForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = document.getElementById('supportCategory')?.value || 'bug';
    const subject = document.getElementById('supportSubject')?.value.trim();
    const description = document.getElementById('supportDescription')?.value.trim();

    if (!subject || subject.length < 3) {
      showAppError?.('Тема', 'Тема минимум 3 символа.');
      return;
    }
    if (!description || description.length < 10) {
      showAppError?.('Описание', 'Описание минимум 10 символов.');
      return;
    }

    try {
      await TasklyApi.createSupportTicket({ category, subject, description });
      form.reset();
      showNotification?.('Обращение отправлено', { type: 'success' });
      loadTickets();
    } catch (err) {
      showAppError?.('Ошибка', err.message);
    }
  });
}

async function loadTickets() {
  try {
    const data = await TasklyApi.getSupportTickets();
    supportIsAdmin = !!data.isAdmin;
    const myId = getCurrentUser().id;
    renderTicketsList('supportTicketsList', data.tickets.filter(t => t.userId === myId));

    const adminSection = document.getElementById('adminSupportSection');
    if (supportIsAdmin && adminSection) {
      adminSection.classList.remove('d-none');
      renderAdminTickets('adminTicketsList', data.tickets);
    }
  } catch (e) {
    document.getElementById('supportTicketsList').innerHTML =
      `<p class="support-empty">Не удалось загрузить обращения: ${escapeHtml(e.message)}</p>`;
  }
}

function renderTicketsList(containerId, tickets) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!tickets.length) {
    el.innerHTML = '<p class="support-empty">Обращений пока нет</p>';
    return;
  }

  el.innerHTML = tickets.map(t => ticketCardHtml(t, false)).join('');
}

function renderAdminTickets(containerId, tickets) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = tickets.map(t => {
    const card = ticketCardHtml(t, true);
    return card.replace('</article>', `
      <div class="support-admin-actions">
        <select class="form-input-modern support-status-select" data-id="${t.id}">
          ${Object.entries(STATUS_LABELS).map(([k, v]) =>
            `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`
          ).join('')}
        </select>
        <textarea class="form-input-modern support-reply-input" data-id="${t.id}" rows="2" placeholder="Ответ пользователю">${escapeHtml(t.adminReply || '')}</textarea>
        <button type="button" class="btn-secondary btn-sm support-save-admin" data-id="${t.id}">Сохранить</button>
      </div>
    </article>`);
  }).join('');

  el.querySelectorAll('.support-save-admin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const status = el.querySelector(`.support-status-select[data-id="${id}"]`)?.value;
      const adminReply = el.querySelector(`.support-reply-input[data-id="${id}"]`)?.value || '';
      btn.disabled = true;
      try {
        await TasklyApi.updateSupportTicket(id, { status, adminReply });
        showNotification?.('Обращение обновлено', { type: 'success' });
        loadTickets();
      } catch (err) {
        showAppError?.('Ошибка', err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function ticketCardHtml(t, showAuthor) {
  const date = new Date(t.createdAt).toLocaleString('ru-RU');
  const author = showAuthor && t.author
    ? `<span class="support-ticket-author">${escapeHtml(t.author.tag || t.author.username)} · ${escapeHtml(t.author.email)}</span>`
    : '';

  return `
    <article class="support-ticket support-ticket--${t.status}">
      <div class="support-ticket-head">
        <strong>${escapeHtml(t.subject)}</strong>
        <span class="support-ticket-meta">${CATEGORY_LABELS[t.category] || t.category} · ${STATUS_LABELS[t.status] || t.status}</span>
      </div>
      ${author}
      <p class="support-ticket-body">${escapeHtml(t.description)}</p>
      ${t.adminReply ? `<div class="support-ticket-reply"><strong>Ответ поддержки:</strong> ${escapeHtml(t.adminReply)}</div>` : ''}
      <time class="support-ticket-date">${date}</time>
    </article>
  `;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
