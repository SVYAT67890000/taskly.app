const NOTE_DEFAULTS = { w: 200, h: 120, color: '#fef08a' };
const NOTE_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff', '#fed7aa'];
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;

let currentProjectId = null;
let nodes = [];
let edges = [];
let selectedNodeId = null;
let connectSourceId = null;
let activeTool = 'select';
let viewport = { panX: 0, panY: 0, zoom: 1 };
let dragState = null;
let panState = null;
let spaceHeld = false;
let saveTimer = null;
let pollTimer = null;
let lastRemoteUpdate = null;
let historyPast = [];
let historyFuture = [];
let snapToGrid = false;
const GRID_SIZE = 20;
const HISTORY_MAX = 40;

function cloneMindmapState() {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges))
  };
}

function pushHistory() {
  historyPast.push(cloneMindmapState());
  if (historyPast.length > HISTORY_MAX) historyPast.shift();
  historyFuture = [];
}

function applyMindmapState(state) {
  nodes = (state.nodes || []).map(normalizeNode);
  edges = state.edges || [];
  selectedNodeId = null;
  connectSourceId = null;
  render();
  updatePanel();
  scheduleSave();
}

function undoMindmap() {
  if (!historyPast.length) return;
  historyFuture.push(cloneMindmapState());
  applyMindmapState(historyPast.pop());
  setStatus('Отменено');
}

function redoMindmap() {
  if (!historyFuture.length) return;
  historyPast.push(cloneMindmapState());
  applyMindmapState(historyFuture.pop());
  setStatus('Повторено');
}

function snapCoord(val) {
  if (!snapToGrid) return val;
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

function duplicateSelectedNode() {
  if (!selectedNodeId) return;
  pushHistory();
  const src = nodes.find(n => n.id === selectedNodeId);
  if (!src) return;
  const id = 'n_' + Date.now();
  nodes.push(normalizeNode({
    ...src,
    id,
    x: src.x + 28,
    y: src.y + 28,
    text: `${src.text} (копия)`
  }));
  selectedNodeId = id;
  render();
  updatePanel();
  scheduleSave();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!getCurrentUser()) {
    window.location.href = 'login.html';
    return;
  }
  const params = new URLSearchParams(window.location.search);
  currentProjectId = params.get('project');
  initProjectSelect();
  bindUI();
  bindViewport();
  bindKeyboard();
  if (currentProjectId) loadMindMap();
  pollTimer = setInterval(syncRemote, 10000);
});

function initProjectSelect() {
  const select = document.getElementById('mindmapProjectSelect');
  const projects = typeof getUserProjects === 'function' ? getUserProjects() : [];
  select.innerHTML = projects.length
    ? projects.map(p => `<option value="${p.id}" ${p.id === currentProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
    : '<option value="">Нет проектов</option>';
  select.addEventListener('change', () => {
    currentProjectId = select.value;
    const url = new URL(window.location.href);
    url.searchParams.set('project', currentProjectId);
    window.history.replaceState({}, '', url);
    loadMindMap();
  });
}

function bindUI() {
  document.getElementById('addMindmapNode')?.addEventListener('click', () => {
    setTool('note');
    addNodeAtCenter();
  });
  document.getElementById('saveMindmapBtn')?.addEventListener('click', () => saveMindMap(true));
  document.getElementById('zoomInBtn')?.addEventListener('click', () => setZoom(viewport.zoom * 1.2));
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => setZoom(viewport.zoom / 1.2));
  document.getElementById('fitViewBtn')?.addEventListener('click', fitToView);
  document.getElementById('deleteNodeBtn')?.addEventListener('click', deleteSelectedNode);
  document.getElementById('duplicateNodeBtn')?.addEventListener('click', duplicateSelectedNode);
  document.getElementById('duplicateNodeBtnPanel')?.addEventListener('click', duplicateSelectedNode);
  document.getElementById('undoMindmapBtn')?.addEventListener('click', undoMindmap);
  document.getElementById('redoMindmapBtn')?.addEventListener('click', redoMindmap);
  document.getElementById('snapGridBtn')?.addEventListener('click', () => {
    snapToGrid = !snapToGrid;
    document.getElementById('snapGridBtn')?.classList.toggle('active', snapToGrid);
    setStatus(snapToGrid ? 'Привязка к сетке включена' : 'Привязка к сетке выключена');
  });
  document.getElementById('mindmapHelpBtn')?.addEventListener('click', () => {
    document.getElementById('mindmapHelpModal')?.classList.remove('d-none');
  });
  document.getElementById('closeMindmapHelp')?.addEventListener('click', () => {
    document.getElementById('mindmapHelpModal')?.classList.add('d-none');
  });

  document.querySelectorAll('.miro-tool[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  const panelText = document.getElementById('panelText');
  panelText?.addEventListener('input', () => {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (node) {
      node.text = panelText.value;
      updateNodeElement(node);
      scheduleSave();
    }
  });

  document.querySelectorAll('#panelColors button').forEach(btn => {
    btn.addEventListener('click', () => {
      const node = nodes.find(n => n.id === selectedNodeId);
      if (!node) return;
      pushHistory();
      node.color = btn.dataset.color;
      updateNodeElement(node);
      scheduleSave();
    });
  });
}

function bindViewport() {
  const vp = document.getElementById('mindmapViewport');
  if (!vp) return;

  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAt(mx, my, viewport.zoom * factor);
  }, { passive: false });

  vp.addEventListener('mousedown', onCanvasMouseDown);
  vp.addEventListener('dblclick', onCanvasDblClick);
  vp.addEventListener('contextmenu', (e) => e.preventDefault());
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('textarea, input, [contenteditable]')) return;
    if (e.code === 'Space' && !spaceHeld) {
      spaceHeld = true;
      document.getElementById('mindmapViewport')?.classList.add('panning');
    }
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedNode();
    if (e.key === 'v' || e.key === 'V') setTool('select');
    if (e.key === 'h' || e.key === 'H') setTool('hand');
    if (e.key === 'n' || e.key === 'N') setTool('note');
    if (e.key === 'c' || e.key === 'C') setTool('connect');
    if (e.key === 'e' || e.key === 'E') setTool('erase');
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      document.getElementById('mindmapHelpModal')?.classList.toggle('d-none');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoMindmap();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redoMindmap();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      duplicateSelectedNode();
    }
    if (e.key === 'Escape') {
      connectSourceId = null;
      selectedNodeId = null;
      updatePanel();
      render();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceHeld = false;
      document.getElementById('mindmapViewport')?.classList.remove('panning');
    }
  });
}

function setTool(tool) {
  activeTool = tool;
  connectSourceId = null;
  document.querySelectorAll('.miro-tool[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  const vp = document.getElementById('mindmapViewport');
  if (vp) {
    vp.classList.toggle('tool-hand', tool === 'hand');
    vp.classList.toggle('tool-note', tool === 'note');
    vp.classList.toggle('tool-connect', tool === 'connect');
    vp.classList.toggle('tool-erase', tool === 'erase');
  }
  updateHint();
}

function updateHint() {
  const hints = {
    select: 'Перетаскивайте стикеры · Двойной клик — новый стикер',
    hand: 'Перетаскивайте фон для панорамы',
    note: 'Кликните на доску, чтобы добавить стикер',
    connect: 'Кликните два стикера, чтобы соединить',
    erase: 'Кликните стикер или линию для удаления'
  };
  const el = document.getElementById('mindmapHint');
  if (el) el.textContent = hints[activeTool] || '';
}

function normalizeNode(n) {
  return {
    id: n.id,
    text: n.text || 'Идея',
    x: n.x ?? 0,
    y: n.y ?? 0,
    w: n.w || NOTE_DEFAULTS.w,
    h: n.h || NOTE_DEFAULTS.h,
    color: n.color || NOTE_DEFAULTS.color
  };
}

async function loadMindMap() {
  if (!currentProjectId) return;
  try {
    const data = await TasklyApi.getMindMap(currentProjectId);
    nodes = (data.nodes || []).map(normalizeNode);
    edges = data.edges || [];
    if (!nodes.length) {
      nodes = [normalizeNode({ id: 'root', text: 'Центральная идея', x: 0, y: 0 })];
    }
    lastRemoteUpdate = data.updatedAt;
    fitToView();
    setStatus('Загружено ' + new Date(data.updatedAt).toLocaleTimeString('ru-RU'));
  } catch (e) {
    showNotification?.(e.message, { type: 'warning' });
  }
}

async function syncRemote() {
  if (!currentProjectId || dragState || panState) return;
  try {
    const data = await TasklyApi.getMindMap(currentProjectId);
    if (data.updatedAt === lastRemoteUpdate) return;
    nodes = (data.nodes || []).map(normalizeNode);
    edges = data.edges || [];
    lastRemoteUpdate = data.updatedAt;
    render();
    setStatus('Синхронизировано');
  } catch (_) {}
}

function screenToWorld(sx, sy) {
  const vp = document.getElementById('mindmapViewport');
  const rect = vp.getBoundingClientRect();
  return {
    x: (sx - rect.left - viewport.panX) / viewport.zoom,
    y: (sy - rect.top - viewport.panY) / viewport.zoom
  };
}

function applyViewportTransform() {
  const world = document.getElementById('mindmapWorld');
  if (world) {
    world.style.transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
  }
  const label = document.getElementById('zoomLabel');
  if (label) label.textContent = Math.round(viewport.zoom * 100) + '%';
}

function setZoom(z) {
  const vp = document.getElementById('mindmapViewport');
  const rect = vp.getBoundingClientRect();
  zoomAt(rect.width / 2, rect.height / 2, z);
}

function zoomAt(mx, my, newZoom) {
  newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  const worldX = (mx - viewport.panX) / viewport.zoom;
  const worldY = (my - viewport.panY) / viewport.zoom;
  viewport.zoom = newZoom;
  viewport.panX = mx - worldX * newZoom;
  viewport.panY = my - worldY * newZoom;
  applyViewportTransform();
}

function fitToView() {
  if (!nodes.length) {
    viewport = { panX: 80, panY: 80, zoom: 1 };
    applyViewportTransform();
    render();
    return;
  }
  const vp = document.getElementById('mindmapViewport');
  const rect = vp.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  });
  const pad = 80;
  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  const zoom = Math.min(rect.width / bw, rect.height / bh, 1.2);
  viewport.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  viewport.panX = (rect.width - bw * viewport.zoom) / 2 - minX * viewport.zoom + pad * viewport.zoom;
  viewport.panY = (rect.height - bh * viewport.zoom) / 2 - minY * viewport.zoom + pad * viewport.zoom;
  applyViewportTransform();
  render();
}

function addNodeAt(x, y) {
  pushHistory();
  const id = 'n_' + Date.now();
  const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
  const node = normalizeNode({
    id,
    text: 'Новая идея',
    x: snapCoord(x - NOTE_DEFAULTS.w / 2),
    y: snapCoord(y - NOTE_DEFAULTS.h / 2),
    color
  });
  nodes.push(node);
  selectedNodeId = id;
  if (connectSourceId && connectSourceId !== id) {
    edges.push({ from: connectSourceId, to: id });
    connectSourceId = null;
  }
  render();
  updatePanel();
  scheduleSave();
  return node;
}

function addNodeAtCenter() {
  const vp = document.getElementById('mindmapViewport');
  const rect = vp.getBoundingClientRect();
  const w = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  addNodeAt(w.x, w.y);
}

function onCanvasDblClick(e) {
  if (e.target.closest('.miro-note')) return;
  const w = screenToWorld(e.clientX, e.clientY);
  addNodeAt(w.x, w.y);
  setTool('select');
}

function onCanvasMouseDown(e) {
  if (e.button !== 0 && e.button !== 1) return;
  const onNote = e.target.closest('.miro-note');
  const isPan = activeTool === 'hand' || spaceHeld || e.button === 1;

  if (isPan && !onNote) {
    e.preventDefault();
    panState = { startX: e.clientX, startY: e.clientY, panX: viewport.panX, panY: viewport.panY };
    const onMove = (ev) => {
      viewport.panX = panState.panX + (ev.clientX - panState.startX);
      viewport.panY = panState.panY + (ev.clientY - panState.startY);
      applyViewportTransform();
    };
    const onUp = () => {
      panState = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return;
  }

  if (activeTool === 'note' && !onNote) {
    const w = screenToWorld(e.clientX, e.clientY);
    addNodeAt(w.x, w.y);
    return;
  }

  if (!onNote) {
    selectedNodeId = null;
    connectSourceId = null;
    updatePanel();
    render();
  }
}

function handleNodeClick(e, id) {
  e.stopPropagation();
  if (activeTool === 'erase') {
    deleteNode(id);
    return;
  }
  if (activeTool === 'connect') {
    if (!connectSourceId) {
      connectSourceId = id;
      setStatus('Выберите второй стикер');
    } else if (connectSourceId !== id) {
      const exists = edges.some(ed => (ed.from === connectSourceId && ed.to === id) || (ed.from === id && ed.to === connectSourceId));
      if (!exists) {
        pushHistory();
        edges.push({ from: connectSourceId, to: id });
      }
      connectSourceId = null;
      setStatus('Связь создана');
      render();
      scheduleSave();
    }
    return;
  }
  selectedNodeId = id;
  updatePanel();
  render();
}

function startNodeDrag(e, id) {
  if (activeTool !== 'select' && !spaceHeld) return;
  if (e.target.isContentEditable) return;
  e.preventDefault();
  e.stopPropagation();
  const node = nodes.find(n => n.id === id);
  if (!node) return;
  selectedNodeId = id;
  updatePanel();
  pushHistory();
  const startWorld = screenToWorld(e.clientX, e.clientY);
  dragState = { id, offsetX: startWorld.x - node.x, offsetY: startWorld.y - node.y };
  const onMove = (ev) => {
    const w = screenToWorld(ev.clientX, ev.clientY);
    node.x = w.x - dragState.offsetX;
    node.y = w.y - dragState.offsetY;
    updateNodePosition(node);
    renderEdges();
  };
  const onUp = () => {
    dragState = null;
    node.x = snapCoord(node.x);
    node.y = snapCoord(node.y);
    updateNodePosition(node);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    scheduleSave();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function deleteSelectedNode() {
  if (!selectedNodeId) return;
  deleteNode(selectedNodeId);
}

function deleteNode(id) {
  pushHistory();
  nodes = nodes.filter(n => n.id !== id);
  edges = edges.filter(e => e.from !== id && e.to !== id);
  if (selectedNodeId === id) selectedNodeId = null;
  if (connectSourceId === id) connectSourceId = null;
  render();
  updatePanel();
  scheduleSave();
}

function updatePanel() {
  const empty = document.getElementById('panelEmpty');
  const content = document.getElementById('panelContent');
  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node) {
    empty?.classList.remove('d-none');
    content?.classList.add('d-none');
    return;
  }
  empty?.classList.add('d-none');
  content?.classList.remove('d-none');
  const panelText = document.getElementById('panelText');
  if (panelText && panelText !== document.activeElement) panelText.value = node.text;
}

function render() {
  const container = document.getElementById('mindmapNodes');
  if (!container) return;

  container.innerHTML = nodes.map(n => `
    <div class="miro-note ${n.id === selectedNodeId ? 'selected' : ''} ${n.id === connectSourceId ? 'connecting' : ''}"
         data-id="${n.id}"
         style="left:${n.x}px;top:${n.y}px;width:${n.w}px;min-height:${n.h}px;background:${n.color}">
      <div class="miro-note-handle" title="Перетащить"></div>
      <div class="miro-note-text" contenteditable="true">${escapeHtml(n.text)}</div>
    </div>
  `).join('');

  container.querySelectorAll('.miro-note').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('.miro-note-handle')?.addEventListener('mousedown', (ev) => startNodeDrag(ev, id));
    el.addEventListener('click', (ev) => handleNodeClick(ev, id));
    el.querySelector('.miro-note-text')?.addEventListener('blur', (ev) => {
      const node = nodes.find(n => n.id === id);
      if (node) {
        node.text = ev.target.textContent.trim() || 'Идея';
        scheduleSave();
      }
    });
    el.querySelector('.miro-note-text')?.addEventListener('input', () => {
      const node = nodes.find(n => n.id === id);
      if (node && id === selectedNodeId) {
        const panelText = document.getElementById('panelText');
        if (panelText) panelText.value = el.querySelector('.miro-note-text').textContent;
      }
    });
  });

  renderEdges();
  applyViewportTransform();
}

function updateNodeElement(node) {
  const el = document.querySelector(`.miro-note[data-id="${node.id}"]`);
  if (!el) return;
  el.style.background = node.color;
  const text = el.querySelector('.miro-note-text');
  if (text && text !== document.activeElement) text.textContent = node.text;
}

function updateNodePosition(node) {
  const el = document.querySelector(`.miro-note[data-id="${node.id}"]`);
  if (el) {
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
  }
}

function renderEdges() {
  const svg = document.getElementById('mindmapSvg');
  if (!svg) return;
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.w + 200), 2000);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.h + 200), 2000);
  svg.setAttribute('width', maxX);
  svg.setAttribute('height', maxY);
  svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);

  svg.innerHTML = edges.map((e, i) => {
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) return '';
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h / 2;
    const x2 = to.x + to.w / 2;
    const y2 = to.y + to.h / 2;
    const mx = (x1 + x2) / 2;
    const path = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    return `<path d="${path}" class="miro-edge" data-edge-index="${i}"/>`;
  }).join('');

  if (activeTool === 'erase') {
    svg.querySelectorAll('.miro-edge').forEach(path => {
      path.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pushHistory();
        const idx = parseInt(path.dataset.edgeIndex, 10);
        edges.splice(idx, 1);
        render();
        scheduleSave();
      });
    });
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveMindMap(false), 1500);
}

async function saveMindMap(manual) {
  if (!currentProjectId) return;
  try {
    const data = await TasklyApi.saveMindMap(currentProjectId, nodes, edges);
    lastRemoteUpdate = data.updatedAt;
    const status = document.getElementById('mindmapSyncStatus');
    if (status) status.dataset.local = data.updatedAt;
    setStatus(manual ? 'Сохранено' : 'Автосохранение');
  } catch (e) {
    showNotification?.(e.message, { type: 'warning' });
  }
}

function setStatus(text) {
  const el = document.getElementById('mindmapSyncStatus');
  if (el) el.textContent = text;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

setTool('select');
updateHint();
