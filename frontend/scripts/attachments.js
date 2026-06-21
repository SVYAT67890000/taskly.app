const MAX_FILE_SIZE = 5 * 1024 * 1024;
const authBlobCache = new Map();

function getAuthToken() {
  return localStorage.getItem('userToken') || sessionStorage.getItem('userToken') || '';
}

function normalizeFileUrl(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:')) return url;
  return url.startsWith('/api/') ? url : `/api${url.startsWith('/') ? '' : '/'}${url}`;
}

async function fetchAuthFileBlob(url) {
  const fullUrl = normalizeFileUrl(url);
  if (authBlobCache.has(fullUrl)) return authBlobCache.get(fullUrl);
  const token = getAuthToken();
  const res = await fetch(fullUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new Error('Не удалось загрузить файл');
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  authBlobCache.set(fullUrl, blobUrl);
  return blobUrl;
}

async function downloadAuthFile(url, name) {
  try {
    const blobUrl = await fetchAuthFileBlob(url);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name || 'file';
    a.click();
  } catch (_) {
    showNotification?.('Не удалось скачать файл', { type: 'warning' });
  }
}

function isImageAttachment(a) {
  const mime = a.mimeType || '';
  return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.name || '');
}

function renderAttachmentHtml(a, index) {
  if (isImageAttachment(a)) {
    return `
      <div class="chat-image-wrap">
        <img class="chat-inline-image" data-auth-url="${escapeAttr(a.url)}" alt="${escapeAttr(a.name || 'фото')}" loading="lazy">
      </div>`;
  }
  return `
    <button type="button" class="attachment-chip attachment-file-btn" data-auth-url="${escapeAttr(a.url)}" data-file-name="${escapeAttr(a.name || 'файл')}">
      <ion-icon name="document-outline"></ion-icon>${escapeHtml(a.name || 'файл')}
    </button>`;
}

function escapeAttr(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function pickFiles(accept = 'image/*,.pdf,.doc,.docx,.txt') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.addEventListener('change', () => resolve([...(input.files || [])]));
    input.click();
  });
}

async function uploadFiles(files) {
  const uploaded = [];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      showNotification?.(`Файл «${file.name}» больше 5 МБ`, { type: 'warning' });
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const item = await TasklyApi.uploadFile({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      contentBase64: dataUrl.split(',')[1]
    });
    uploaded.push(item);
  }
  return uploaded;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderAttachmentsList(container, attachments, onRemove) {
  if (!container) return;
  const list = attachments || [];
  if (!list.length) {
    container.innerHTML = '';
    container.classList.add('d-none');
    return;
  }
  container.classList.remove('d-none');
  container.innerHTML = list.map((a, i) => `
    <div class="attachment-chip" data-index="${i}">
      ${isImageAttachment(a)
        ? `<img class="attachment-preview-thumb" data-auth-url="${escapeAttr(a.url)}" alt="">`
        : `<ion-icon name="document-outline"></ion-icon>`}
      <button type="button" class="attachment-link-btn" data-auth-url="${escapeAttr(a.url)}" data-file-name="${escapeAttr(a.name)}">${escapeAttachmentName(a.name)}</button>
      ${onRemove ? `<button type="button" class="attachment-remove" data-index="${i}" title="Удалить"><ion-icon name="close-outline"></ion-icon></button>` : ''}
    </div>
  `).join('');
  container.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => onRemove(Number(btn.dataset.index)));
  });
  hydrateAuthMedia(container);
}

async function hydrateAuthMedia(root) {
  if (!root) return;
  const nodes = root.querySelectorAll('[data-auth-url]');
  for (const el of nodes) {
    const url = el.dataset.authUrl;
    if (!url || el.dataset.hydrated === '1') continue;
    try {
      const blobUrl = await fetchAuthFileBlob(url);
      if (el.tagName === 'IMG') {
        el.src = blobUrl;
        el.addEventListener('click', () => openImageLightbox(blobUrl, el.alt));
      }
      el.dataset.hydrated = '1';
    } catch (_) {
      if (el.tagName === 'IMG') el.alt = 'Ошибка загрузки';
    }
  }
  root.querySelectorAll('.attachment-file-btn, .attachment-link-btn').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => downloadAuthFile(btn.dataset.authUrl, btn.dataset.fileName));
  });
}

function openImageLightbox(src, alt) {
  let box = document.getElementById('imageLightbox');
  if (!box) return;
  const img = document.getElementById('imageLightboxImg');
  if (img) {
    img.src = src;
    img.alt = alt || '';
  }
  box.classList.remove('d-none');
  document.body.classList.add('lightbox-open');
}

function closeImageLightbox() {
  const box = document.getElementById('imageLightbox');
  if (box) box.classList.add('d-none');
  document.body.classList.remove('lightbox-open');
}

function escapeAttachmentName(name) {
  const d = document.createElement('div');
  d.textContent = name || 'файл';
  return d.innerHTML;
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

window.pickFiles = pickFiles;
window.uploadFiles = uploadFiles;
window.renderAttachmentsList = renderAttachmentsList;
window.hydrateAuthMedia = hydrateAuthMedia;
window.renderAttachmentHtml = renderAttachmentHtml;
window.fetchAuthFileBlob = fetchAuthFileBlob;
window.openImageLightbox = openImageLightbox;
window.closeImageLightbox = closeImageLightbox;
