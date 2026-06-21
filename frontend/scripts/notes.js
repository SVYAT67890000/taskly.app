const NOTE_COLORS = [
  { id: 'default', value: '#fff9c4', label: 'Жёлтый' },
  { id: 'green', value: '#ccff90', label: 'Зелёный' },
  { id: 'blue', value: '#a7ffeb', label: 'Бирюзовый' },
  { id: 'pink', value: '#f8bbd0', label: 'Розовый' },
  { id: 'purple', value: '#e1bee7', label: 'Фиолетовый' },
  { id: 'gray', value: '#f5f5f5', label: 'Серый' }
];

let notes = [];
let searchQuery = '';
let saveTimers = {};
let composerAttachments = [];
let pendingDeleteNoteId = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('notesGrid')) return;
  if (typeof getCurrentUser === 'function' && !getCurrentUser()) {
    window.location.href = 'login.html';
    return;
  }
  if (typeof ensureSharedModals === 'function') ensureSharedModals();
  bindNotesUI();
  loadNotes();
});

function bindNotesUI() {
  document.getElementById('notesSearch')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderNotes();
  });
  document.getElementById('addNoteBtn')?.addEventListener('click', createNote);
  document.getElementById('composerTitle')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createNote(); }
  });
  document.getElementById('attachNoteBtn')?.addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    composerAttachments.push(...await uploadFiles(files));
    renderAttachmentsList(document.getElementById('noteComposerAttachments'), composerAttachments, i => {
      composerAttachments.splice(i, 1);
      renderAttachmentsList(document.getElementById('noteComposerAttachments'), composerAttachments, null);
    });
  });
  document.getElementById('confirmDeleteNoteBtn')?.addEventListener('click', confirmDeleteNote);
}

async function loadNotes() {
  try {
    if (typeof TasklyApi !== 'undefined') {
      notes = await TasklyApi.getNotes();
      saveNotesLocal(notes);
    } else {
      notes = loadNotesLocal();
    }
  } catch (_) {
    notes = loadNotesLocal();
  }
  renderNotes();
}

function getNotesStorageKey() {
  const user = getCurrentUser();
  return `taskly.notes.${user?.id || 'anon'}`;
}

function loadNotesLocal() {
  try {
    return JSON.parse(localStorage.getItem(getNotesStorageKey()) || '[]');
  } catch (_) {
    return [];
  }
}

function saveNotesLocal(list) {
  localStorage.setItem(getNotesStorageKey(), JSON.stringify(list));
}

function filterNotes(list) {
  if (!searchQuery) return list;
  return list.filter(n => {
    const hay = `${n.title || ''} ${n.content || ''} ${(n.tags || []).join(' ')}`.toLowerCase();
    return hay.includes(searchQuery);
  });
}

function renderNotes() {
  const grid = document.getElementById('notesGrid');
  const empty = document.getElementById('notesEmpty');
  if (!grid) return;

  const sorted = [...filterNotes(notes)].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  if (!sorted.length) {
    grid.innerHTML = '';
    empty?.classList.remove('d-none');
    return;
  }
  empty?.classList.add('d-none');

  grid.innerHTML = sorted.map(note => `
    <article class="gkeep-card ${note.pinned ? 'pinned' : ''}" data-id="${note.id}" style="--note-color:${note.color || '#fff9c4'}">
      <div class="gkeep-card-toolbar">
        <button type="button" class="gkeep-pin-btn" data-action="pin" title="Закрепить"><ion-icon name="${note.pinned ? 'pin' : 'pin-outline'}"></ion-icon></button>
        <div class="gkeep-colors">
          ${NOTE_COLORS.map(c => `
            <button type="button" class="gkeep-color-dot ${note.color === c.value ? 'active' : ''}"
              data-action="color" data-color="${c.value}" style="background:${c.value}" title="${c.label}"></button>
          `).join('')}
        </div>
        <button type="button" class="gkeep-delete-btn" data-action="delete" title="Удалить"><ion-icon name="trash-outline"></ion-icon></button>
      </div>
      <input class="gkeep-title" placeholder="Заголовок" value="${escapeAttr(note.title || '')}" data-field="title">
      <textarea class="gkeep-content" placeholder="Заметка..." data-field="content">${escapeHtml(note.content || '')}</textarea>
      ${(note.attachments || []).length ? `<div class="attachments-list">${(note.attachments || []).map(a => `<a class="attachment-chip" href="${a.url}" target="_blank"><ion-icon name="document-outline"></ion-icon>${escapeHtml(a.name)}</a>`).join('')}</div>` : ''}
      <div class="gkeep-footer"><span class="gkeep-date">${formatNoteDate(note.updatedAt)}</span></div>
    </article>
  `).join('');

  grid.querySelectorAll('.gkeep-card').forEach(card => bindNoteCard(card));
}

function bindNoteCard(card) {
  const id = card.dataset.id;
  card.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'pin') await updateNote(id, { pinned: !notes.find(n => n.id === id)?.pinned });
      if (action === 'color') await updateNote(id, { color: btn.dataset.color });
      if (action === 'delete') openDeleteNoteModal(id);
    });
  });
  card.querySelectorAll('[data-field]').forEach(field => {
    field.addEventListener('input', () => scheduleNoteSave(id, card));
    field.addEventListener('blur', () => flushNoteSave(id, card));
  });
}

function openDeleteNoteModal(id) {
  pendingDeleteNoteId = id;
  const note = notes.find(n => n.id === id);
  const textEl = document.getElementById('deleteNoteModalText');
  if (textEl && note) textEl.textContent = `Удалить заметку «${note.title || 'Без названия'}»?`;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteNoteModal')).show();
}

async function confirmDeleteNote() {
  if (!pendingDeleteNoteId) return;
  const id = pendingDeleteNoteId;
  pendingDeleteNoteId = null;
  bootstrap.Modal.getInstance(document.getElementById('deleteNoteModal'))?.hide();
  notes = notes.filter(n => n.id !== id);
  saveNotesLocal(notes);
  renderNotes();
  try {
    if (typeof TasklyApi !== 'undefined') await TasklyApi.deleteNote(id);
  } catch (_) {}
  showNotification?.('Заметка удалена', { type: 'info' });
}

function scheduleNoteSave(id, card) {
  clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(() => flushNoteSave(id, card), 600);
}

async function flushNoteSave(id, card) {
  const title = card.querySelector('[data-field="title"]')?.value || '';
  const content = card.querySelector('[data-field="content"]')?.value || '';
  const idx = notes.findIndex(n => n.id === id);
  if (idx < 0) return;
  notes[idx] = { ...notes[idx], title, content, updatedAt: new Date().toISOString() };
  saveNotesLocal(notes);
  try {
    if (typeof TasklyApi !== 'undefined') {
      const { note } = await TasklyApi.updateNote(id, { title, content });
      notes[idx] = note;
      saveNotesLocal(notes);
    }
  } catch (_) {}
}

async function createNote() {
  const title = document.getElementById('composerTitle')?.value.trim() || '';
  const content = document.getElementById('composerContent')?.value.trim() || '';
  if (!title && !content && !composerAttachments.length) {
    showNotification?.('Введите текст или прикрепите файл', { type: 'warning' });
    return;
  }
  const draft = { title, content, color: '#fff9c4', pinned: false, tags: [], attachments: [...composerAttachments] };
  try {
    if (typeof TasklyApi !== 'undefined') {
      const { note } = await TasklyApi.createNote(draft);
      notes.unshift(note);
    } else {
      notes.unshift({ ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    saveNotesLocal(notes);
    document.getElementById('composerTitle').value = '';
    document.getElementById('composerContent').value = '';
    composerAttachments = [];
    renderAttachmentsList(document.getElementById('noteComposerAttachments'), [], null);
    renderNotes();
    showNotification?.('Заметка создана', { type: 'success', icon: 'success' });
  } catch (e) {
    showNotification?.(e.message || 'Не удалось создать заметку', { type: 'warning' });
  }
}

async function updateNote(id, patch) {
  const idx = notes.findIndex(n => n.id === id);
  if (idx < 0) return;
  notes[idx] = { ...notes[idx], ...patch, updatedAt: new Date().toISOString() };
  saveNotesLocal(notes);
  renderNotes();
  try {
    if (typeof TasklyApi !== 'undefined') {
      const { note } = await TasklyApi.updateNote(id, patch);
      notes[idx] = note;
      saveNotesLocal(notes);
      renderNotes();
    }
  } catch (_) {}
}

function formatNoteDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text).replace(/"/g, '&quot;');
}

window.loadNotes = loadNotes;
