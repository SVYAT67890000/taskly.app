

const DEFAULT_AVATAR_EMOJIS = ['👤'];


document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupLoginForm();
  setupRegisterForm();
  setupForgotPassword();
  setupLogout();
  setupUserMenu();
  updateUserInfo();
});


function checkAuth() {
  const token = localStorage.getItem('userToken') || sessionStorage.getItem('userToken');
  const currentUser = getCurrentUser();
  
  if (!token || !currentUser) {
    const protectedPages = ['index', 'calendar', 'profile', 'friends', 'stats', 'mindmap', 'notes', 'support'];
    const path = window.location.pathname;
    if (protectedPages.some(p => path.includes(p)) || path.endsWith('/')) {
      window.location.href = 'login.html';
    }
    return false;
  }
  
  if (token && currentUser) {
    if (window.location.pathname.includes('login') || window.location.pathname.includes('register')) {
      verifySessionAndRedirect();
      return false;
    }
    bootstrapUserData();
  }
  
  return true;
}

async function verifySessionAndRedirect() {
  if (typeof TasklyApi === 'undefined') return;
  try {
    await TasklyApi.me();
    window.location.href = 'index.html';
  } catch (_) {
    clearAuthSession();
  }
}


function getCurrentUser() {
  const userStr = localStorage.getItem('currentUser');
  if (userStr) {
    try {
      return JSON.parse(userStr);
    } catch (e) {
      return null;
    }
  }
  return null;
}


function saveUser(user, token) {
  const normalizedUser = normalizeUser(user);
  localStorage.setItem('currentUser', JSON.stringify(normalizedUser));
  if (token) {
    localStorage.setItem('userToken', token);
  }
}


function generateToken(email) {
  return btoa(email + ':' + Date.now()).replace(/[^a-zA-Z0-9]/g, '');
}


function setupLoginForm() {
  const loginForm = document.querySelector('#loginForm');
  if (!loginForm) return;
  
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;
    
    if (!email || !password) {
      showAppError?.('Заполните поля', 'Введите email и пароль для входа.');
      return;
    }
    if (!validateEmail?.(email)) {
      showAppError?.('Некорректный email', 'Проверьте формат адреса электронной почты.');
      return;
    }

    try {
      const { token, user } = await TasklyApi.login({ email, password });
      await applyAuthSession(token, user, rememberMe);
      window.location.href = 'index.html';
    } catch (err) {
      showAppError?.('Ошибка входа', err.message || 'Неверный email или пароль');
    }
  });
}


function setupForgotPassword() {
  const openBtn = document.getElementById('forgotPasswordLink');
  const modal = document.getElementById('forgotPasswordModal');
  if (!openBtn || !modal) return;

  const emailInput = document.getElementById('resetEmail');
  const codeInput = document.getElementById('resetCode');
  const passInput = document.getElementById('resetNewPassword');
  const confirmInput = document.getElementById('resetConfirmPassword');
  const sendBtn = document.getElementById('sendResetCodeBtn');
  const submitBtn = document.getElementById('submitResetBtn');

  function showModal() {
    modal.classList.remove('app-modal-hidden');
    emailInput?.focus();
  }

  function hideModal() {
    modal.classList.add('app-modal-hidden');
  }

  openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const loginEmail = document.getElementById('loginEmail')?.value.trim();
    if (loginEmail && emailInput) emailInput.value = loginEmail;
    if (typeof initPasswordToggles === 'function') initPasswordToggles(modal);
    showModal();
  });

  modal.querySelector('[data-close-forgot]')?.addEventListener('click', hideModal);
  document.getElementById('forgotPasswordCancel')?.addEventListener('click', hideModal);

  sendBtn?.addEventListener('click', async () => {
    const email = emailInput?.value.trim();
    if (!email || !validateEmail?.(email)) {
      showAppError?.('Email', 'Введите корректный email.');
      return;
    }
    sendBtn.disabled = true;
    try {
      const data = await TasklyApi.forgotPassword(email);
      showNotification?.(data.message || 'Код отправлен на email', { type: 'success' });
    } catch (e) {
      showAppError?.('Ошибка', e.message);
    } finally {
      sendBtn.disabled = false;
    }
  });

  submitBtn?.addEventListener('click', async () => {
    const email = emailInput?.value.trim();
    const code = codeInput?.value.trim();
    const password = passInput?.value;
    const confirm = confirmInput?.value;

    if (!email || !validateEmail?.(email)) {
      showAppError?.('Email', 'Введите корректный email.');
      return;
    }
    if (!code) {
      showAppError?.('Код', 'Введите код из письма.');
      return;
    }
    const pwdErr = validatePassword?.(password);
    if (pwdErr) {
      showAppError?.('Пароль', pwdErr);
      return;
    }
    if (password !== confirm) {
      showAppError?.('Пароли', 'Пароли не совпадают.');
      return;
    }

    submitBtn.disabled = true;
    try {
      await TasklyApi.resetPassword(email, code, password);
      hideModal();
      showNotification?.('Пароль обновлён. Войдите с новым паролем.', { type: 'success' });
      if (document.getElementById('loginEmail')) document.getElementById('loginEmail').value = email;
    } catch (e) {
      showAppError?.('Ошибка', e.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}


function setupRegisterForm() {
  const registerForm = document.querySelector('#registerForm');
  if (!registerForm) return;
  
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (!username || !email || !password || !confirmPassword) {
      showAppError?.('Заполните поля', 'Все поля регистрации обязательны.');
      return;
    }
    if (!validateUsername?.(username)) {
      showAppError?.('Некорректное имя', 'Имя: от 2 до 32 символов, только буквы, цифры, пробел, точка и дефис.');
      return;
    }
    if (!validateEmail?.(email)) {
      showAppError?.('Некорректный email', 'Проверьте формат адреса электронной почты.');
      return;
    }
    const pwdErr = validatePassword?.(password);
    if (pwdErr) {
      showAppError?.('Слабый пароль', pwdErr);
      return;
    }
    if (password !== confirmPassword) {
      showAppError?.('Пароли не совпадают', 'Повторите пароль так же, как в первом поле.');
      return;
    }

    const hasConsent = typeof getPersonalDataConsent === 'function' && getPersonalDataConsent()?.accepted;
    if (!hasConsent) {
      if (typeof showPersonalDataModal === 'function') {
        showPersonalDataModal({
          force: true,
          onAccept: () => document.getElementById('registerForm')?.requestSubmit()
        });
      } else {
        showAppError?.('Нужно согласие', 'Необходимо согласие на обработку персональных данных');
      }
      return;
    }

    try {
      const { token, user } = await TasklyApi.register({
        username,
        email,
        password,
        personalDataConsent: true
      });
      await applyAuthSession(token, user, true);
      window.location.href = 'index.html';
    } catch (err) {
      showAppError?.('Ошибка регистрации', err.message || 'Не удалось зарегистрироваться');
    }
  });
}

async function applyAuthSession(token, user, persist = true) {
  const normalized = normalizeUser(user);
  if (persist) {
    localStorage.setItem('userToken', token);
    localStorage.setItem('currentUser', JSON.stringify(normalized));
  } else {
    sessionStorage.setItem('userToken', token);
    sessionStorage.setItem('currentUser', JSON.stringify(normalized));
    localStorage.setItem('userToken', token);
    localStorage.setItem('currentUser', JSON.stringify(normalized));
  }
  await bootstrapUserData();
}

async function bootstrapUserData() {
  if (typeof TasklyApi === 'undefined') return;
  try {
    const data = await TasklyApi.bootstrap();
    localStorage.setItem('tasks', JSON.stringify(data.tasks || []));
    localStorage.setItem('projects', JSON.stringify(data.projects || []));
    mergeUsersCache(data.users || []);
    const current = getCurrentUser();
    if (current) {
      const merged = normalizeUser({
        ...current,
        friends: data.friends || [],
        friendRequests: data.friendRequests || { incoming: [], outgoing: [] }
      });
      localStorage.setItem('currentUser', JSON.stringify(merged));
    }
    localStorage.setItem('achievements', JSON.stringify(data.achievements || []));
    localStorage.setItem('userStats', JSON.stringify(data.stats || {}));
    if (data.notes) {
      const user = getCurrentUser();
      localStorage.setItem(`taskly.notes.${user?.id || 'anon'}`, JSON.stringify(data.notes));
    }
    if (typeof initMessageNotifications === 'function') initMessageNotifications();
    if (typeof updateUnreadBadgesUI === 'function') updateUnreadBadgesUI();
    if (typeof renderNotificationCenter === 'function') renderNotificationCenter();
  } catch (e) {
    console.warn('Bootstrap:', e.message);
    if (e.status === 401) {
      clearAuthSession();
      if (!window.location.pathname.includes('login') && !window.location.pathname.includes('register')) {
        window.location.href = 'login.html';
      }
    }
  }
}

function mergeUsersCache(incomingUsers) {
  if (!Array.isArray(incomingUsers) || !incomingUsers.length) return;
  const existing = getUsers();
  const map = new Map(existing.map(u => [u.id, u]));
  incomingUsers.forEach(u => {
    const normalized = typeof normalizeUser === 'function' ? normalizeUser(u) : u;
    map.set(normalized.id, { ...map.get(normalized.id), ...normalized });
  });
  localStorage.setItem('users', JSON.stringify([...map.values()]));
}

function updateFriendRequestsInUser(friends, incoming, outgoing) {
  const current = getCurrentUser();
  if (!current) return;
  const merged = normalizeUser({
    ...current,
    friends: friends || current.friends || [],
    friendRequests: { incoming: incoming || [], outgoing: outgoing || [] }
  });
  localStorage.setItem('currentUser', JSON.stringify(merged));
}

function isProjectMember(project, userId) {
  if (!project || !userId) return false;
  return project.ownerId === userId || (project.memberIds || []).includes(userId);
}


function getUsers() {
  const usersStr = localStorage.getItem('users');
  if (usersStr) {
    try {
      return JSON.parse(usersStr);
    } catch (e) {
      return [];
    }
  }
  return [];
}


function saveUsers(users) {
  localStorage.setItem('users', JSON.stringify(users));
}


function setupLogout() {
  if (typeof ensureSharedModals === 'function') ensureSharedModals();
  const modalElement = document.getElementById('logoutConfirmModal');
  let logoutModal = null;
  
  if (modalElement && typeof bootstrap !== 'undefined') {
    logoutModal = bootstrap.Modal.getOrCreateInstance(modalElement);
    const confirmBtn = document.getElementById('confirmLogoutBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        logoutModal.hide();
        logout();
      });
    }
  }
  
  const handleClick = (btn) => {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (logoutModal) {
        logoutModal.show();
      } else if (confirm('Вы уверены, что хотите выйти?')) {
        logout();
      }
    });
  };
  
  handleClick(document.getElementById('logoutBtn'));
  handleClick(document.getElementById('menuLogoutBtn'));
}


function setupUserMenu() {
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userMenuContainer = document.querySelector('.user-menu-container');
  const userMenuDropdown = document.getElementById('userMenuDropdown');
  
  if (!userMenuBtn || !userMenuContainer || !userMenuDropdown) return;
  
  
  userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuContainer.classList.toggle('active');
  });
  
  
  document.addEventListener('click', (e) => {
    if (!userMenuContainer.contains(e.target)) {
      userMenuContainer.classList.remove('active');
    }
  });
  
  
  const menuLinks = userMenuDropdown.querySelectorAll('.user-menu-link');
  menuLinks.forEach(link => {
    link.addEventListener('click', () => {
      userMenuContainer.classList.remove('active');
    });
  });
}


function updateUserInfo() {
  const currentUser = getCurrentUser();
  
  if (!currentUser) return;
  
  
  const userNameEl = document.getElementById('userName');
  const menuUserNameEl = document.getElementById('menuUserName');
  
  if (userNameEl) {
    userNameEl.textContent = currentUser.username || 'Пользователь';
  }
  
  if (menuUserNameEl) {
    menuUserNameEl.textContent = currentUser.username || 'Пользователь';
  }
  
  
  const menuUserEmailEl = document.getElementById('menuUserEmail');
  if (menuUserEmailEl) {
    menuUserEmailEl.textContent = currentUser.tag || currentUser.email || '';
  }
  
  const userAvatarEl = document.getElementById('userAvatar');
  const menuUserAvatarEl = document.getElementById('menuUserAvatar');
  applyAvatarToElement(userAvatarEl, currentUser.avatar);
  applyAvatarToElement(menuUserAvatarEl, currentUser.avatar);
}


function clearAuthSession() {
  localStorage.removeItem('userToken');
  localStorage.removeItem('currentUser');
  sessionStorage.removeItem('userToken');
  sessionStorage.removeItem('currentUser');
}

async function logout() {
  try {
    if (typeof TasklyApi !== 'undefined') {
      await TasklyApi.logout();
    }
  } catch (_) {
    /* выход локально даже если сервер недоступен */
  } finally {
    clearAuthSession();
    window.location.href = 'login.html';
  }
}


function getUserTasks() {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];
  
  const allTasks = getAllTasks();
  const projects = getAllProjects();
  
  return allTasks.filter(task => {
    const ownerId = task.ownerId || task.userId;
    const assignees = Array.isArray(task.assignees) ? task.assignees : [];
    
    if (task.projectId) {
      const project = projects.find(p => p.id === task.projectId);
      if (!project) return false;
      const isMember = project.ownerId === currentUser.id || (project.memberIds || []).includes(currentUser.id);
      return isMember;
    }
    
    return ownerId === currentUser.id;
  });
}


function saveUserTasks(tasks) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  
  const allTasks = getAllTasks();
  const otherTasks = allTasks.filter(task => (task.ownerId || task.userId) !== currentUser.id || task.projectId);
  const personalTasks = tasks
    .filter(task => !task.projectId)
    .map(task => ({
      ...task,
      ownerId: currentUser.id,
      userId: currentUser.id
    }));
  
  saveAllTasks([...otherTasks, ...personalTasks]);
}


function getAllTasks() {
  const tasksStr = localStorage.getItem('tasks');
  if (tasksStr) {
    try {
      return JSON.parse(tasksStr);
    } catch (e) {
      return [];
    }
  }
  return [];
}


function saveAllTasks(tasks) {
  localStorage.setItem('tasks', JSON.stringify(tasks));
  if (typeof TasklyApi !== 'undefined') {
    TasklyApi.syncTasks(tasks).catch(err => console.warn('Sync tasks:', err.message));
  }
}


function getAllProjects() {
  const projectsStr = localStorage.getItem('projects');
  if (projectsStr) {
    try {
      return JSON.parse(projectsStr);
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveAllProjects(projects) {
  localStorage.setItem('projects', JSON.stringify(projects));
}

function getUserProjects() {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];
  
  const projects = getAllProjects();
  return projects.filter(project => {
    const members = project.memberIds || [];
    return project.ownerId === currentUser.id || members.includes(currentUser.id);
  });
}

function saveProject(project) {
  const projects = getAllProjects();
  const index = projects.findIndex(p => p.id === project.id);
  const exists = index >= 0;
  if (exists) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  saveAllProjects(projects);
  if (typeof TasklyApi !== 'undefined') {
    TasklyApi.saveProject({ ...project, _exists: exists }).then(saved => {
      if (saved) {
        const all = getAllProjects();
        const i = all.findIndex(p => p.id === saved.id);
        if (i >= 0) all[i] = saved;
        else all.push(saved);
        saveAllProjects(all);
        if (typeof bootstrapUserData === 'function') {
          bootstrapUserData();
        }
      }
    }).catch(err => console.warn('Save project:', err.message));
  }
}

function getProjectById(projectId) {
  if (!projectId) return null;
  const projects = getAllProjects();
  return projects.find(project => project.id === projectId) || null;
}

function upsertTask(task) {
  const allTasks = getAllTasks();
  const index = allTasks.findIndex(t => t.id === task.id);
  if (index >= 0) {
    allTasks[index] = { ...allTasks[index], ...task };
  } else {
    allTasks.push(task);
  }
  saveAllTasks(allTasks);
  if (typeof TasklyApi !== 'undefined') {
    TasklyApi.saveTask(allTasks[index >= 0 ? index : allTasks.length - 1])
      .then(saved => {
        if (saved) {
          const tasks = getAllTasks();
          const i = tasks.findIndex(t => t.id === saved.id);
          if (i >= 0) tasks[i] = saved;
          saveAllTasks(tasks);
        }
      })
      .catch(err => console.warn('Save task:', err.message));
  }
}

function deleteTaskById(taskId) {
  const allTasks = getAllTasks();
  const filtered = allTasks.filter(task => task.id !== taskId);
  saveAllTasks(filtered);
  if (typeof TasklyApi !== 'undefined') {
    TasklyApi.deleteTask(taskId).catch(err => console.warn('Delete task:', err.message));
  }
}


window.getCurrentUser = getCurrentUser;
window.getUserTasks = getUserTasks;
window.saveUserTasks = saveUserTasks;
window.logout = logout;
window.getUsers = getUsers;
window.getAllProjects = getAllProjects;
window.getUserProjects = getUserProjects;
window.saveProject = saveProject;
window.getProjectById = getProjectById;
window.upsertTask = upsertTask;
window.deleteTaskById = deleteTaskById;
window.updateCurrentUserData = updateCurrentUserData;
window.updateUserPassword = updateUserPassword;
window.requestPasswordCode = requestPasswordCode;
window.verifyPasswordCode = verifyPasswordCode;
window.getFriendData = getFriendData;
window.sendFriendRequest = sendFriendRequest;
window.cancelFriendRequest = cancelFriendRequest;
window.respondFriendRequest = respondFriendRequest;
window.removeFriend = removeFriend;
window.bootstrapUserData = bootstrapUserData;
window.mergeUsersCache = mergeUsersCache;
window.updateFriendRequestsInUser = updateFriendRequestsInUser;
window.isProjectMember = isProjectMember;

function getDefaultAvatar() {
  const emoji = DEFAULT_AVATAR_EMOJIS[Math.floor(Math.random() * DEFAULT_AVATAR_EMOJIS.length)];
  return { type: 'emoji', value: emoji };
}

function normalizeAvatar(avatar) {
  if (!avatar) return getDefaultAvatar();
  if (avatar.type === 'image' && avatar.value) {
    return { type: 'image', value: avatar.value };
  }
  if (avatar.type === 'emoji' && avatar.value) {
    return { type: 'emoji', value: avatar.value };
  }
  return getDefaultAvatar();
}

function normalizeUser(user) {
  const tag = user.tag || (user.username && user.discriminator
    ? `${user.username}#${user.discriminator}`
    : user.username || '');
  return {
    ...user,
    tag,
    publicId: user.publicId || user.public_id || '',
    discriminator: user.discriminator || '',
    avatar: normalizeAvatar(user.avatar),
    status: user.status || '',
    phone: user.phone || '',
    bio: user.bio || '',
    preferences: {
      ...(user.preferences || {}),
      reminderLeadDays: user.preferences?.reminderLeadDays ?? 1,
      notifications: {
        messages: user.preferences?.notifications?.messages !== false,
        reminders: user.preferences?.notifications?.reminders !== false,
        friendRequests: user.preferences?.notifications?.friendRequests !== false,
        pushEnabled: user.preferences?.notifications?.pushEnabled === true,
        sound: user.preferences?.notifications?.sound !== false
      }
    },
    friends: Array.isArray(user.friends) ? user.friends : [],
    friendRequests: {
      incoming: Array.isArray(user.friendRequests?.incoming) ? user.friendRequests.incoming : [],
      outgoing: Array.isArray(user.friendRequests?.outgoing) ? user.friendRequests.outgoing : []
    }
  };
}

function applyAvatarToElement(element, avatar) {
  if (!element) return;
  const normalized = normalizeAvatar(avatar);
  if (normalized.type === 'image') {
    element.classList.add('has-image');
    element.textContent = '';
    element.style.backgroundImage = `url(${normalized.value})`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
  } else {
    element.classList.remove('has-image');
    element.style.backgroundImage = '';
    element.textContent = normalized.value || '👤';
  }
}

async function updateCurrentUserData(updates = {}) {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;
  
  const updatedData = { ...updates };
  if (updates.avatar) {
    updatedData.avatar = normalizeAvatar(updates.avatar);
  }

  try {
    if (typeof TasklyApi !== 'undefined') {
      const { user } = await TasklyApi.updateProfile(updatedData);
      const mergedUser = normalizeUser(user);
      localStorage.setItem('currentUser', JSON.stringify(mergedUser));
      updateUserInfo();
      return mergedUser;
    }
  } catch (e) {
    console.warn('Update profile:', e.message);
  }
  
  const mergedUser = normalizeUser({ ...currentUser, ...updatedData });
  localStorage.setItem('currentUser', JSON.stringify(mergedUser));
  updateUserInfo();
  return mergedUser;
}

async function updateUserPassword(code, newPassword) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  try {
    if (typeof TasklyApi !== 'undefined') {
      await TasklyApi.changePassword(code, newPassword);
      return true;
    }
  } catch (e) {
    showNotification?.(e.message || 'Не удалось сменить пароль', { type: 'warning' });
    return false;
  }
  return true;
}

function getPasswordCodeStorageKey(userId) {
  return `passwordCode:${userId}`;
}

function requestPasswordCode() {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;
  
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const key = getPasswordCodeStorageKey(currentUser.id);
  const payload = {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000
  };
  localStorage.setItem(key, JSON.stringify(payload));
  return code;
}

function verifyPasswordCode(inputCode) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  
  const key = getPasswordCodeStorageKey(currentUser.id);
  const stored = localStorage.getItem(key);
  if (!stored) return false;
  
  try {
    const data = JSON.parse(stored);
    if (Date.now() > data.expiresAt) {
      localStorage.removeItem(key);
      return false;
    }
    const isValid = data.code === inputCode;
    if (isValid) {
      localStorage.removeItem(key);
    }
    return isValid;
  } catch (error) {
    console.error('Ошибка проверки кода:', error);
    return false;
  }
}

function getFriendData() {
  const currentUser = getCurrentUser();
  if (!currentUser) return { friends: [], incoming: [], outgoing: [] };
  const normalized = normalizeUser(currentUser);
  return {
    friends: normalized.friends,
    incoming: normalized.friendRequests.incoming,
    outgoing: normalized.friendRequests.outgoing
  };
}

async function sendFriendRequest(query) {
  const currentUser = getCurrentUser();
  if (!currentUser) return { success: false, message: 'Не авторизованы' };

  try {
    await TasklyApi.sendFriendRequest(query);
    await bootstrapUserData();
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message || 'Не удалось отправить заявку' };
  }
}

async function cancelFriendRequest(targetUserId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  try {
    await TasklyApi.cancelFriendRequest(targetUserId);
    await bootstrapUserData();
    return true;
  } catch (_) {
    return false;
  }
}

async function respondFriendRequest(requestUserId, accept) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  try {
    await TasklyApi.respondFriendRequest(requestUserId, accept);
    await bootstrapUserData();
    return true;
  } catch (_) {
    return false;
  }
}

async function removeFriend(friendId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  try {
    await TasklyApi.removeFriend(friendId);
    await bootstrapUserData();
    return true;
  } catch (_) {
    return false;
  }
}

function persistUserData(userData) {
  const normalized = normalizeUser(userData);
  const currentUser = getCurrentUser();
  if (currentUser && currentUser.id === normalized.id) {
    localStorage.setItem('currentUser', JSON.stringify(normalized));
  }
  const users = getUsers();
  const index = users.findIndex(user => user.id === normalized.id);
  if (index >= 0) {
    users[index] = normalized;
    saveUsers(users);
  }
}
