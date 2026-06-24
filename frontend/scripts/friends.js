let currentUserData = null;
let friendsLookup = {};
let cachedUsers = [];
let selectedFriendId = null;
let selectedGroupId = null;
let cachedConversations = [];
let friendsPollTimer = null;
let activeMobilePanel = 'friends';

document.addEventListener('DOMContentLoaded', () => {
  if (typeof getCurrentUser !== 'function') return;
  currentUserData = getCurrentUser();
  if (!currentUserData) {
    window.location.href = 'login.html';
    return;
  }

  initFromUrlParams();
  loadFriendsData();
  bindEvents();
  setupMobilePanels();
  if (typeof updateUnreadBadgesUI === 'function') updateUnreadBadgesUI();
  friendsPollTimer = setInterval(() => {
    loadFriendsData();
    if (selectedFriendId || selectedGroupId) renderChatMessages();
  }, 8000);

  window.addEventListener('focus', () => {
    loadFriendsData();
    if (selectedFriendId || selectedGroupId) renderChatMessages();
  });
});

function initFromUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const chat = params.get('chat');
  const group = params.get('group');
  const panel = params.get('panel');
  if (group) {
    selectedGroupId = group;
    selectedFriendId = null;
    if (typeof clearUnread === 'function') clearUnread(`grp:${group}`);
  } else if (chat) {
    selectedFriendId = chat;
    selectedGroupId = null;
    if (typeof clearUnread === 'function') clearUnread(chat);
  }
  if (panel) activeMobilePanel = panel;
}

function bindEvents() {
  document.getElementById('sendFriendRequestBtn')?.addEventListener('click', handleSendRequest);
  document.getElementById('refreshFriendsBtn')?.addEventListener('click', loadFriendsData);
  document.getElementById('createGroupBtn')?.addEventListener('click', openCreateGroupModal);
  document.getElementById('groupForm')?.addEventListener('submit', handleCreateGroup);
  document.getElementById('chatForm')?.addEventListener('submit', handleSendMessage);
  document.getElementById('removeFriendBtn')?.addEventListener('click', removeSelectedFriend);
  document.getElementById('chatBackBtn')?.addEventListener('click', () => setMobilePanel('friends'));
  document.getElementById('chatAttachBtn')?.addEventListener('click', attachToChat);
  document.getElementById('chatMessages')?.addEventListener('click', handleChatMessageClick);
  document.getElementById('leaveGroupBtn')?.addEventListener('click', handleLeaveGroup);
  document.getElementById('deleteGroupBtn')?.addEventListener('click', handleDeleteGroup);
  document.getElementById('chatMessageInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('chatForm')?.requestSubmit();
    }
  });
}

async function handleChatMessageClick(e) {
  const delBtn = e.target.closest('.chat-message-delete');
  if (delBtn) {
    const msgId = delBtn.dataset.msgId;
    const kind = delBtn.dataset.kind;
    confirmAction('Удалить сообщение', 'Сообщение будет удалено без возможности восстановления.', async () => {
      try {
        if (kind === 'group') {
          await TasklyApi.deleteConversationMessage(selectedGroupId, msgId);
        } else {
          await TasklyApi.deleteMessage(msgId);
        }
        renderChatMessages();
      } catch (e) {
        showNotification?.(e.message || 'Ошибка удаления', { type: 'warning' });
      }
    });
    return;
  }

  const editBtn = e.target.closest('.chat-message-edit');
  if (editBtn) {
    const msgEl = editBtn.closest('.chat-message');
    const textEl = msgEl?.querySelector('.chat-message-text');
    if (!textEl) return;
    const origText = textEl.textContent;
    const input = document.createElement('textarea');
    input.className = 'chat-edit-input';
    input.value = origText;
    input.rows = 1;
    textEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const done = async () => {
      const newText = input.value.trim();
      if (!newText || newText === origText) {
        input.replaceWith(textEl);
        return;
      }
      try {
        const msgId = editBtn.dataset.msgId;
        const kind = editBtn.dataset.kind;
        if (kind === 'group') {
          await TasklyApi.editConversationMessage(selectedGroupId, msgId, newText);
        } else {
          await TasklyApi.editMessage(msgId, newText);
        }
        renderChatMessages();
      } catch (err) {
        showNotification?.(err.message || 'Ошибка редактирования', { type: 'warning' });
        input.replaceWith(textEl);
      }
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(); }
      if (ev.key === 'Escape') { input.replaceWith(textEl); }
    });
    input.addEventListener('blur', done);
    return;
  }
}

async function handleLeaveGroup() {
  if (!selectedGroupId) return;
  confirmAction('Покинуть беседу', 'Вы перестанете видеть сообщения этой беседы.', async () => {
    try {
      await TasklyApi.leaveConversation(selectedGroupId);
      selectedGroupId = null;
      showNotification?.('Вы покинули беседу', { type: 'info' });
      await loadFriendsData();
    } catch (e) {
      showNotification?.(e.message || 'Ошибка', { type: 'warning' });
    }
  });
}

async function handleDeleteGroup() {
  if (!selectedGroupId) return;
  confirmAction('Удалить беседу', 'Беседа будет удалена навсегда. Это действие нельзя отменить.', async () => {
    try {
      await TasklyApi.deleteConversation(selectedGroupId);
      selectedGroupId = null;
      showNotification?.('Беседа удалена', { type: 'info' });
      await loadFriendsData();
    } catch (e) {
      showNotification?.(e.message || 'Ошибка', { type: 'warning' });
    }
  });
}

function setupMobilePanels() {
  document.querySelectorAll('.friends-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setMobilePanel(btn.dataset.panel));
  });
  setMobilePanel(activeMobilePanel);
}

function setMobilePanel(panel) {
  activeMobilePanel = panel;
  document.querySelectorAll('.friends-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });
  document.querySelectorAll('[data-friends-panel]').forEach(el => {
    el.classList.toggle('mobile-active', el.dataset.friendsPanel === panel);
  });
}

async function loadFriendsData() {
  currentUserData = getCurrentUser();
  if (!currentUserData) return;

  try {
    if (typeof TasklyApi !== 'undefined') {
      const data = await TasklyApi.getFriends();
      if (typeof mergeUsersCache === 'function') mergeUsersCache(data.users || []);
      if (typeof updateFriendRequestsInUser === 'function') {
        updateFriendRequestsInUser(data.friends, data.incoming, data.outgoing);
      }
      cachedUsers = data.users || getUsers();
      friendsLookup = buildUsersMap(data.friends, cachedUsers);
      renderFriendsList(data.friends);
      renderRequests(data.incoming, data.outgoing, cachedUsers);
      try {
        const convData = await TasklyApi.getConversations();
        cachedConversations = convData.conversations || [];
      } catch (_) {
        cachedConversations = [];
      }
      renderGroupChatsList();
      updateChatHeader();
      if (selectedFriendId || selectedGroupId) {
        renderChatMessages();
        if (window.innerWidth <= 768) setMobilePanel('chat');
      }
      return;
    }
  } catch (e) {
    console.warn('Friends load:', e.message);
  }

  const friendData = getFriendData();
  cachedUsers = getUsers();
  friendsLookup = buildUsersMap(friendData.friends, cachedUsers);
  renderFriendsList(friendData.friends);
  renderRequests(friendData.incoming, friendData.outgoing, cachedUsers);
  updateChatHeader();
}

function buildUsersMap(idList, users) {
  const map = {};
  idList.forEach(id => {
    const user = users.find(u => u.id === id);
    if (user) map[id] = user;
  });
  return map;
}

function renderFriendsList(friendIds) {
  const listEl = document.getElementById('friendsList');
  if (!listEl) return;

  if (!friendIds.length) {
    listEl.innerHTML = '<p>Пока нет друзей. Добавьте кого-нибудь!</p>';
    if (!selectedFriendId) updateChatHeader();
    return;
  }

  listEl.innerHTML = friendIds.map(id => {
    const user = friendsLookup[id];
    if (!user) return '';
    const active = id === selectedFriendId ? 'active' : '';
    const avatar = renderAvatarHTML(user.avatar);
    return `
      <button class="friend-item ${active}" data-id="${id}">
        <div class="friend-avatar">${avatar}</div>
        <div class="friend-details">
          <span class="friend-name">${escapeHtml(user.username || user.email)}</span>
          <span class="friend-status">${user.status ? escapeHtml(user.status) : 'Онлайн'}</span>
        </div>
      </button>
    `;
  }).join('');

  listEl.querySelectorAll('.friend-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedFriendId = item.getAttribute('data-id');
      selectedGroupId = null;
      if (typeof clearUnread === 'function') clearUnread(selectedFriendId);
      listEl.querySelectorAll('.friend-item, .group-item').forEach(btn => btn.classList.remove('active'));
      item.classList.add('active');
      updateChatHeader();
      renderChatMessages();
      if (window.innerWidth <= 768) setMobilePanel('chat');
    });
  });

  if (typeof updateUnreadBadgesUI === 'function') updateUnreadBadgesUI();
}

function renderGroupChatsList() {
  const listEl = document.getElementById('groupChatsList');
  if (!listEl) return;

  if (!cachedConversations.length) {
    listEl.innerHTML = '<p class="friends-hint">Создайте беседу с друзьями.</p>';
    return;
  }

  listEl.innerHTML = cachedConversations.map(conv => {
    const active = conv.id === selectedGroupId ? 'active' : '';
    const unreadKey = `grp:${conv.id}`;
    return `
      <button class="group-item friend-item ${active}" data-id="${unreadKey}" data-group-id="${conv.id}">
        <div class="friend-avatar group-avatar"><ion-icon name="people-outline"></ion-icon></div>
        <div class="friend-details">
          <span class="friend-name">${escapeHtml(conv.name)}</span>
          <span class="friend-status">${(conv.memberIds || []).length} участн.</span>
        </div>
      </button>
    `;
  }).join('');

  listEl.querySelectorAll('.group-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedGroupId = item.dataset.groupId;
      selectedFriendId = null;
      if (typeof clearUnread === 'function') clearUnread(`grp:${selectedGroupId}`);
      document.querySelectorAll('.friend-item, .group-item').forEach(btn => btn.classList.remove('active'));
      item.classList.add('active');
      updateChatHeader();
      renderChatMessages();
      if (window.innerWidth <= 768) setMobilePanel('chat');
    });
  });

  if (typeof updateUnreadBadgesUI === 'function') updateUnreadBadgesUI();
}

function openCreateGroupModal() {
  const select = document.getElementById('groupMembers');
  if (!select) return;
  const friends = Object.keys(friendsLookup);
  select.innerHTML = friends.map(id => {
    const user = friendsLookup[id];
    return `<option value="${id}">${escapeHtml(user.username || user.email)}</option>`;
  }).join('');
  if (typeof bootstrap !== 'undefined') {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('groupModal')).show();
  }
}

async function handleCreateGroup(event) {
  event.preventDefault();
  const name = document.getElementById('groupName')?.value.trim();
  const select = document.getElementById('groupMembers');
  const memberIds = Array.from(select?.selectedOptions || []).map(o => o.value);
  if (!name) {
    showNotification?.('Введите название беседы', { type: 'warning' });
    return;
  }
  if (!memberIds.length) {
    showNotification?.('Выберите хотя бы одного друга', { type: 'warning' });
    return;
  }
  try {
    const data = await TasklyApi.createConversation({ name, memberIds });
    document.getElementById('groupForm')?.reset();
    bootstrap.Modal.getInstance(document.getElementById('groupModal'))?.hide();
    selectedGroupId = data.conversation.id;
    selectedFriendId = null;
    await loadFriendsData();
    setMobilePanel('chat');
    showNotification?.('Беседа создана', { type: 'success' });
  } catch (e) {
    showNotification?.(e.message || 'Не удалось создать беседу', { type: 'warning' });
  }
}

function renderRequests(incomingIds, outgoingIds, users) {
  renderRequestsList('incomingRequests', incomingIds, true, users);
  renderRequestsList('outgoingRequests', outgoingIds, false, users);
}

function renderRequestsList(elementId, ids, incoming, users) {
  const container = document.getElementById(elementId);
  if (!container) return;

  if (!ids.length) {
    container.innerHTML = `<p>${incoming ? 'Нет входящих заявок.' : 'Нет исходящих заявок.'}</p>`;
    return;
  }

  const userList = users || getUsers();
  container.innerHTML = ids.map(id => {
    const user = userList.find(u => u.id === id);
    const name = user ? (user.username || user.email) : 'Пользователь';
    const tag = user ? (user.tag || user.email) : id.slice(0, 8);
    const avatar = user ? renderAvatarHTML(user.avatar) : '<span class="avatar-chip">👤</span>';
    return `
      <div class="request-item">
        <div class="request-user">
          <div class="request-avatar">${avatar}</div>
          <div class="request-user-info">
            <div class="request-name">${escapeHtml(name)}</div>
            <div class="request-email">${escapeHtml(tag)}</div>
          </div>
        </div>
        <div class="request-actions">
          ${incoming ? `
            <button class="btn-primary btn-sm request-btn" data-action="accept" data-id="${id}">Принять</button>
            <button class="btn-secondary btn-sm request-btn" data-action="decline" data-id="${id}">Отклонить</button>
          ` : `
            <button class="btn-secondary btn-sm request-btn" data-action="cancel" data-id="${id}">Отменить</button>
          `}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const friendId = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (incoming) await respondFriendRequest(friendId, action === 'accept');
      else await cancelFriendRequest(friendId);
      loadFriendsData();
    });
  });
}

let chatDraftAttachments = [];

async function attachToChat() {
  const files = await pickFiles();
  if (!files.length) return;
  chatDraftAttachments.push(...await uploadFiles(files));
  showNotification?.(`Прикреплено файлов: ${chatDraftAttachments.length}`, { type: 'info', silent: true });
}

function updateChatHeader() {
  const nameEl = document.getElementById('chatUserName');
  const statusEl = document.getElementById('chatUserStatus');
  const removeBtn = document.getElementById('removeFriendBtn');
  const sendBtn = document.getElementById('sendChatBtn');
  const chatInput = document.getElementById('chatMessageInput');
  const sharedBox = document.getElementById('friendSharedTasks');

  if (selectedGroupId) {
    const conv = cachedConversations.find(c => c.id === selectedGroupId);
    nameEl.textContent = conv?.name || 'Беседа';
    statusEl.textContent = conv ? `${(conv.memberIds || []).length} участников` : 'Групповой чат';
    removeBtn.disabled = true;
    removeBtn.style.display = '';
    const leaveBtn = document.getElementById('leaveGroupBtn');
    const deleteBtn = document.getElementById('deleteGroupBtn');
    if (leaveBtn) leaveBtn.style.display = '';
    if (deleteBtn) deleteBtn.style.display = conv && conv.ownerId === currentUserData.id ? '' : 'none';
    sendBtn.disabled = !conv;
    chatInput.disabled = !conv;
    if (sharedBox) {
      sharedBox.classList.add('d-none');
      sharedBox.innerHTML = '';
    }
    if (!conv) {
      document.getElementById('chatMessages').innerHTML = '<div class="chat-placeholder"><p>Беседа не найдена.</p></div>';
    }
    return;
  }

  const leaveBtn = document.getElementById('leaveGroupBtn');
  if (leaveBtn) leaveBtn.style.display = 'none';
  const deleteBtn = document.getElementById('deleteGroupBtn');
  if (deleteBtn) deleteBtn.style.display = 'none';

  if (!selectedFriendId || !friendsLookup[selectedFriendId]) {
    nameEl.textContent = 'Выберите собеседника';
    statusEl.textContent = 'Чтобы начать переписку, выберите друга.';
    removeBtn.disabled = true;
    removeBtn.style.display = '';
    sendBtn.disabled = true;
    chatInput.disabled = true;
    chatInput.value = '';
    document.getElementById('chatMessages').innerHTML = '<div class="chat-placeholder"><p>Здесь появятся сообщения.</p></div>';
    return;
  }

  const friend = friendsLookup[selectedFriendId];
  nameEl.textContent = friend.username || friend.email;
  statusEl.textContent = friend.status || 'Онлайн';
  removeBtn.disabled = false;
  removeBtn.style.display = '';
  sendBtn.disabled = false;
  chatInput.disabled = false;
  loadFriendSharedTasks(selectedFriendId);
}

async function loadFriendSharedTasks(friendId) {
  const box = document.getElementById('friendSharedTasks');
  if (!box) return;
  try {
    const tasks = await TasklyApi.getFriendSharedTasks(friendId);
    if (!tasks.length) {
      box.classList.add('d-none');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('d-none');
    box.innerHTML = `<h4>Общие задачи друга</h4>${tasks.map(t => `
      <div class="shared-task-item"><strong>${escapeHtml(t.title)}</strong> — ${t.date || 'без срока'}</div>
    `).join('')}`;
  } catch (_) {
    box.classList.add('d-none');
  }
}

async function renderChatMessages() {
  const messagesEl = document.getElementById('chatMessages');
  if (!messagesEl) return;

  if (selectedGroupId) {
    let messages = [];
    try {
      const data = await TasklyApi.getConversationMessages(selectedGroupId);
      messages = data.messages || [];
    } catch (_) {
      messages = [];
    }
    if (!messages.length) {
      messagesEl.innerHTML = '<div class="chat-placeholder"><p>Пока нет сообщений.</p></div>';
      return;
    }
    messagesEl.innerHTML = messages.map(msg => {
      const isMine = msg.from === currentUserData.id;
      const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const sender = msg.senderName && !isMine ? `<div class="chat-message-sender">${escapeHtml(msg.senderName)}</div>` : '';
      return `
        <div class="chat-message ${isMine ? 'mine' : ''}">
          ${sender}
          ${msg.text ? `<div class="chat-message-text">${escapeHtml(msg.text)}</div>` : ''}
          <div class="chat-message-meta">${time}
            ${isMine ? `<button class="chat-message-edit" data-msg-id="${escapeAttr(msg.id)}" data-kind="group" title="Редактировать"><ion-icon name="pencil-outline"></ion-icon></button><button class="chat-message-delete" data-msg-id="${escapeAttr(msg.id)}" data-kind="group" title="Удалить"><ion-icon name="trash-outline"></ion-icon></button>` : ''}
          </div>
        </div>
      `;
    }).join('');
    if (messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 60) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    return;
  }

  if (!selectedFriendId) return;

  let messages = [];
  try {
    if (typeof TasklyApi !== 'undefined') {
      messages = await TasklyApi.getMessages(selectedFriendId);
      saveConversationMessages(selectedFriendId, messages);
    } else {
      messages = loadConversationMessages(selectedFriendId);
    }
  } catch (_) {
    messages = loadConversationMessages(selectedFriendId);
  }

  if (!messages.length) {
    messagesEl.innerHTML = '<div class="chat-placeholder"><p>Пока нет сообщений.</p></div>';
    return;
  }

    messagesEl.innerHTML = messages.map(msg => {
    const isMine = msg.from === currentUserData.id;
    const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const files = (msg.attachments || []).map(a => renderAttachmentHtml(a)).join('');
    return `
      <div class="chat-message ${isMine ? 'mine' : ''}">
        ${msg.text ? `<div class="chat-message-text">${escapeHtml(msg.text)}</div>` : ''}
        ${files ? `<div class="chat-attachments">${files}</div>` : ''}
        <div class="chat-message-meta">${time}
          ${isMine ? `<button class="chat-message-edit" data-msg-id="${escapeAttr(msg.id)}" data-kind="dm" title="Редактировать"><ion-icon name="pencil-outline"></ion-icon></button><button class="chat-message-delete" data-msg-id="${escapeAttr(msg.id)}" data-kind="dm" title="Удалить"><ion-icon name="trash-outline"></ion-icon></button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  await hydrateAuthMedia(messagesEl);

  if (messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 60) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

async function handleSendRequest() {
  const input = document.getElementById('friendQueryInput');
  if (!input) return;
  const query = input.value.trim();
  if (!query) {
    showNotification?.('Введите ник#тег или личный ID.', { type: 'warning' });
    return;
  }
  const result = await sendFriendRequest(query);
  if (result.success) {
    input.value = '';
    showNotification?.('Заявка отправлена!');
    loadFriendsData();
  } else {
    showNotification?.(result.message || 'Не удалось отправить заявку.', { type: 'warning' });
  }
}

async function handleSendMessage(event) {
  event.preventDefault();
  if (!selectedFriendId && !selectedGroupId) return;

  const textarea = document.getElementById('chatMessageInput');
  const text = textarea.value.trim();
  if (!text && !chatDraftAttachments.length) return;

  try {
    if (typeof TasklyApi !== 'undefined') {
      if (selectedGroupId) {
        await TasklyApi.sendConversationMessage(selectedGroupId, { text, attachments: chatDraftAttachments });
      } else {
        await TasklyApi.sendMessage(selectedFriendId, text, chatDraftAttachments);
      }
      chatDraftAttachments = [];
      textarea.value = '';
      await renderChatMessages();
      return;
    }
  } catch (e) {
    showNotification?.(e.message, { type: 'warning' });
    return;
  }

  if (!selectedFriendId) return;

  const messages = loadConversationMessages(selectedFriendId);
  messages.push({
    id: crypto.randomUUID(),
    from: currentUserData.id,
    to: selectedFriendId,
    text,
    timestamp: Date.now()
  });
  saveConversationMessages(selectedFriendId, messages);
  textarea.value = '';
  renderChatMessages();
}

function removeSelectedFriend() {
  if (!selectedFriendId) return;
  const friend = friendsLookup[selectedFriendId];
  const name = friend ? (friend.username || friend.email) : 'пользователя';
  confirmAction('Удалить из друзей', `Вы уверены, что хотите удалить ${name} из друзей?`, async () => {
    await removeFriend(selectedFriendId);
    selectedFriendId = null;
    loadFriendsData();
    setMobilePanel('friends');
  });
}

function loadConversationMessages(friendId) {
  const raw = localStorage.getItem(getConversationKey(currentUserData.id, friendId));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (_) { return []; }
}

function saveConversationMessages(friendId, messages) {
  localStorage.setItem(getConversationKey(currentUserData.id, friendId), JSON.stringify(messages));
}

function getConversationKey(id1, id2) {
  return `friendChat:${[id1, id2].sort().join('_')}`;
}

function renderAvatarHTML(avatar) {
  if (avatar?.type === 'image' && avatar.value) {
    return `<span class="avatar-chip has-image" style="background-image:url('${avatar.value}')"></span>`;
  }
  return `<span class="avatar-chip avatar-fallback"><ion-icon name="person-outline"></ion-icon></span>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

Object.defineProperty(window, 'selectedFriendId', {
  get() { return selectedFriendId; },
  set(v) { selectedFriendId = v; }
});

Object.defineProperty(window, 'selectedGroupId', {
  get() { return selectedGroupId; },
  set(v) { selectedGroupId = v; }
});

window.renderChatMessages = renderChatMessages;
