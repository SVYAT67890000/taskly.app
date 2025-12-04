let currentUserData = null;
let friendsLookup = {};
let selectedFriendId = null;

document.addEventListener('DOMContentLoaded', () => {
  if (typeof getCurrentUser !== 'function') return;
  currentUserData = getCurrentUser();
  if (!currentUserData) {
    window.location.href = 'login.html';
    return;
  }
  
  loadFriendsData();
  bindEvents();
});

function bindEvents() {
  const sendRequestBtn = document.getElementById('sendFriendRequestBtn');
  sendRequestBtn?.addEventListener('click', handleSendRequest);
  
  const refreshBtn = document.getElementById('refreshFriendsBtn');
  refreshBtn?.addEventListener('click', loadFriendsData);
  
  const chatForm = document.getElementById('chatForm');
  chatForm?.addEventListener('submit', handleSendMessage);
  
  const removeBtn = document.getElementById('removeFriendBtn');
  removeBtn?.addEventListener('click', removeSelectedFriend);
}

function loadFriendsData() {
  currentUserData = getCurrentUser();
  if (!currentUserData) return;
  
  const friendData = getFriendData();
  friendsLookup = mapUsersById(friendData.friends);
  
  renderFriendsList(friendData.friends);
  renderRequests(friendData.incoming, friendData.outgoing);
  updateChatHeader();
}

function mapUsersById(idList) {
  const users = typeof getUsers === 'function' ? getUsers() : [];
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
    selectedFriendId = null;
    updateChatHeader();
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
      listEl.querySelectorAll('.friend-item').forEach(btn => btn.classList.remove('active'));
      item.classList.add('active');
      updateChatHeader();
      renderChatMessages();
    });
  });
}

function renderRequests(incomingIds, outgoingIds) {
  renderRequestsList('incomingRequests', incomingIds, true);
  renderRequestsList('outgoingRequests', outgoingIds, false);
}

function renderRequestsList(elementId, ids, incoming) {
  const container = document.getElementById(elementId);
  if (!container) return;
  
  if (!ids.length) {
    container.innerHTML = `<p>${incoming ? 'Нет входящих заявок.' : 'Нет исходящих заявок.'}</p>`;
    return;
  }
  
  const users = getUsers();
  container.innerHTML = ids.map(id => {
    const user = users.find(u => u.id === id);
    if (!user) return '';
    const avatar = renderAvatarHTML(user.avatar);
    return `
      <div class="request-item">
        <div class="request-user">
          <div class="request-avatar">${avatar}</div>
          <div>
            <div class="request-name">${escapeHtml(user.username || user.email)}</div>
            <div class="request-email">${escapeHtml(user.email)}</div>
          </div>
        </div>
        <div class="request-actions">
          ${incoming ? `
            <button class="btn-primary btn-sm" data-action="accept" data-id="${id}">Принять</button>
            <button class="btn-secondary btn-sm" data-action="decline" data-id="${id}">Отклонить</button>
          ` : `
            <button class="btn-secondary btn-sm" data-action="cancel" data-id="${id}">Отменить</button>
          `}
        </div>
      </div>
    `;
  }).join('');
  
  container.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const friendId = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (incoming) {
        respondFriendRequest(friendId, action === 'accept');
      } else {
        cancelFriendRequest(friendId);
      }
      loadFriendsData();
    });
  });
}

function updateChatHeader() {
  const nameEl = document.getElementById('chatUserName');
  const statusEl = document.getElementById('chatUserStatus');
  const avatarEl = document.getElementById('chatUserAvatar');
  const removeBtn = document.getElementById('removeFriendBtn');
  const sendBtn = document.getElementById('sendChatBtn');
  const chatInput = document.getElementById('chatMessageInput');
  
  if (!selectedFriendId || !friendsLookup[selectedFriendId]) {
    nameEl.textContent = 'Выберите собеседника';
    statusEl.textContent = 'Чтобы начать переписку, выберите друга слева.';
    if (avatarEl) {
      avatarEl.textContent = '🤝';
      avatarEl.classList.remove('has-image');
      avatarEl.style.backgroundImage = '';
    }
    removeBtn.disabled = true;
    sendBtn.disabled = true;
    chatInput.disabled = true;
    chatInput.value = '';
    document.getElementById('chatMessages').innerHTML = '<div class="chat-placeholder"><p>Здесь появятся сообщения.</p></div>';
    return;
  }
  
  const friend = friendsLookup[selectedFriendId];
  nameEl.textContent = friend.username || friend.email;
  statusEl.textContent = friend.status || 'Онлайн';
  if (typeof applyAvatarToElement === 'function') {
    applyAvatarToElement(avatarEl, friend.avatar);
  } else if (avatarEl) {
    avatarEl.textContent = friend.avatar?.value || '👤';
  }
  removeBtn.disabled = false;
  sendBtn.disabled = false;
  chatInput.disabled = false;
}

function renderChatMessages() {
  const messagesEl = document.getElementById('chatMessages');
  if (!messagesEl || !selectedFriendId) return;
  
  const messages = loadConversationMessages(selectedFriendId);
  if (!messages.length) {
    messagesEl.innerHTML = '<div class="chat-placeholder"><p>Пока нет сообщений.</p></div>';
    return;
  }
  
  messagesEl.innerHTML = messages.map(msg => {
    const isMine = msg.from === currentUserData.id;
    const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="chat-message ${isMine ? 'mine' : ''}">
        <div class="chat-message-text">${escapeHtml(msg.text)}</div>
        <div class="chat-message-meta">${time}</div>
      </div>
    `;
  }).join('');
  
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function handleSendRequest() {
  const input = document.getElementById('friendEmailInput');
  if (!input) return;
  const email = input.value.trim();
  if (!email) {
    showNotification?.('Введите email пользователя.', { type: 'warning' });
    return;
  }
  const result = sendFriendRequest(email);
  if (result.success) {
    input.value = '';
    showNotification?.('Заявка отправлена!');
    loadFriendsData();
  } else {
    showNotification?.(result.message || 'Не удалось отправить заявку.', { type: 'warning' });
  }
}

function handleSendMessage(event) {
  event.preventDefault();
  if (!selectedFriendId) return;
  
  const textarea = document.getElementById('chatMessageInput');
  const text = textarea.value.trim();
  if (!text) return;
  
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
  if (!confirm('Удалить пользователя из друзей?')) return;
  removeFriend(selectedFriendId);
  selectedFriendId = null;
  loadFriendsData();
}

function loadConversationMessages(friendId) {
  const chatId = getConversationKey(currentUserData.id, friendId);
  const raw = localStorage.getItem(chatId);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveConversationMessages(friendId, messages) {
  const chatId = getConversationKey(currentUserData.id, friendId);
  localStorage.setItem(chatId, JSON.stringify(messages));
}

function getConversationKey(id1, id2) {
  const sorted = [id1, id2].sort().join('_');
  return `friendChat:${sorted}`;
}

function renderAvatarHTML(avatar) {
  if (avatar?.type === 'image' && avatar.value) {
    return `<span class="avatar-chip has-image" style="background-image:url('${avatar.value}')"></span>`;
  }
  const emoji = avatar?.value || '👤';
  return `<span class="avatar-chip">${emoji}</span>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

