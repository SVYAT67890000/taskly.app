const API_BASE = '';

function getToken() {
  return localStorage.getItem('userToken') || sessionStorage.getItem('userToken');
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ошибка сервера');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showNewAchievements(list) {
  if (!list?.length || typeof showNotification !== 'function') return;
  list.forEach(a => {
    showNotification(`Достижение: ${a.title}`, { type: 'success', icon: a.icon, duration: 5000 });
  });
}

const TasklyApi = {
  async register(payload) {
    return apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
  },
  async login(payload) {
    return apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
  },
  async forgotPassword(email) {
    return apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async resetPassword(email, code, password) {
    return apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, password }) });
  },
  async logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (_) {}
  },
  async me() {
    return apiFetch('/auth/me');
  },
  async bootstrap() {
    return apiFetch('/bootstrap');
  },
  async updateProfile(updates) {
    const data = await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify(updates) });
    showNewAchievements(data.newAchievements);
    return data;
  },
  async changePassword(code, password) {
    return apiFetch('/users/password', { method: 'POST', body: JSON.stringify({ code, password }) });
  },
  async requestPasswordCode() {
    return apiFetch('/users/password/request-code', { method: 'POST' });
  },
  async deleteAccount(email, password) {
    return apiFetch('/users/me', { method: 'DELETE', body: JSON.stringify({ email, password }) });
  },
  async getSupportTickets() {
    return apiFetch('/support/tickets');
  },
  async createSupportTicket(payload) {
    return apiFetch('/support/tickets', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateSupportTicket(id, payload) {
    return apiFetch(`/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async saveTask(task) {
    const hasId = task.id && !String(task.id).startsWith('temp_');
    const data = hasId
      ? await apiFetch(`/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(task) })
      : await apiFetch('/tasks', { method: 'POST', body: JSON.stringify(task) });
    showNewAchievements(data.newAchievements);
    return data.task;
  },
  async deleteTask(id) {
    return apiFetch(`/tasks/${id}`, { method: 'DELETE' });
  },
  async syncTasks(tasks) {
    return apiFetch('/tasks/sync', { method: 'POST', body: JSON.stringify({ tasks }) });
  },
  async saveProject(project) {
    const data = project.id && project._exists
      ? await apiFetch(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) })
      : await apiFetch('/projects', { method: 'POST', body: JSON.stringify(project) });
    showNewAchievements(data.newAchievements);
    return data.project;
  },
  async sendFriendRequest(query) {
    return apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ query }) });
  },
  async respondFriendRequest(userId, accept) {
    const data = await apiFetch('/friends/respond', {
      method: 'POST',
      body: JSON.stringify({ userId, accept })
    });
    showNewAchievements(data.newAchievements);
    return data;
  },
  async cancelFriendRequest(userId) {
    return apiFetch('/friends/cancel', { method: 'POST', body: JSON.stringify({ userId }) });
  },
  async removeFriend(friendId) {
    return apiFetch(`/friends/${friendId}`, { method: 'DELETE' });
  },
  async getFriends() {
    return apiFetch('/friends');
  },
  async getMessages(friendId) {
    return apiFetch(`/messages/${friendId}`);
  },
  async sendMessage(friendId, text, attachments = []) {
    const data = await apiFetch(`/messages/${friendId}`, {
      method: 'POST',
      body: JSON.stringify({ text, attachments })
    });
    showNewAchievements(data.newAchievements);
    return data.message;
  },
  async getStats() {
    return apiFetch('/stats');
  },
  async getAchievements() {
    return apiFetch('/achievements');
  },
  async getMindMap(projectId) {
    return apiFetch(`/mindmaps/${projectId}`);
  },
  async saveMindMap(projectId, nodes, edges) {
    const data = await apiFetch(`/mindmaps/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ nodes, edges })
    });
    showNewAchievements(data.newAchievements);
    return data;
  },
  async searchUser(q) {
    return apiFetch(`/users/search?q=${encodeURIComponent(q)}`);
  },
  async getVapidKey() {
    return apiFetch('/push/vapid-key');
  },
  async savePushSubscription(subscription) {
    return apiFetch('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  },
  async removePushSubscription(endpoint) {
    return apiFetch('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
  },
  async getMessageFeed(since) {
    return apiFetch(`/messages/feed?since=${since || 0}`);
  },
  async getMessageInbox(since) {
    return apiFetch(`/messages/inbox?since=${since || 0}`);
  },
  async getConversations() {
    return apiFetch('/conversations');
  },
  async createConversation(payload) {
    return apiFetch('/conversations', { method: 'POST', body: JSON.stringify(payload) });
  },
  async getConversationMessages(id) {
    return apiFetch(`/conversations/${id}/messages`);
  },
  async sendConversationMessage(id, payload) {
    return apiFetch(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify(payload) });
  },
  async getNotes() {
    return apiFetch('/notes');
  },
  async createNote(note) {
    const data = await apiFetch('/notes', { method: 'POST', body: JSON.stringify(note) });
    showNewAchievements(data.newAchievements);
    return data;
  },
  async updateNote(id, note) {
    return apiFetch(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(note) });
  },
  async deleteNote(id) {
    return apiFetch(`/notes/${id}`, { method: 'DELETE' });
  },
  async uploadFile(payload) {
    return apiFetch('/uploads', { method: 'POST', body: JSON.stringify(payload) });
  },
  async deleteMessage(id) {
    return apiFetch(`/messages/${id}`, { method: 'DELETE' });
  },
  async deleteConversationMessage(convId, msgId) {
    return apiFetch(`/conversations/${convId}/messages/${msgId}`, { method: 'DELETE' });
  },
  async leaveConversation(convId) {
    return apiFetch(`/conversations/${convId}/leave`, { method: 'POST' });
  },
  async deleteConversation(convId) {
    return apiFetch(`/conversations/${convId}`, { method: 'DELETE' });
  },
  async editMessage(id, text) {
    return apiFetch(`/messages/${id}`, { method: 'PUT', body: JSON.stringify({ text }) });
  },
  async editConversationMessage(convId, msgId, text) {
    return apiFetch(`/conversations/${convId}/messages/${msgId}`, { method: 'PUT', body: JSON.stringify({ text }) });
  },
  async getFriendSharedTasks(friendId) {
    return apiFetch(`/friends/${friendId}/shared-tasks`);
  },
  async getDailyQuote() {
    try {
      const res = await fetch('https://api.quotable.io/random?maxLength=120');
      if (!res.ok) throw new Error('quote fail');
      return res.json();
    } catch (_) {
      return { content: 'Маленькие шаги каждый день приводят к большим результатам.', author: 'Таскли' };
    }
  }
};

window.TasklyApi = TasklyApi;
window.apiFetch = apiFetch;
window.showNewAchievements = showNewAchievements;
