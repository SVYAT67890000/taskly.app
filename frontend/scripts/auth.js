// Управление авторизацией

const DEFAULT_AVATAR_EMOJIS = ['👤', '🙂', '🐱', '🦊', '🐼', '🐻', '🐸', '🦄', '🌟', '🚀'];

// Проверка авторизации при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupLoginForm();
  setupRegisterForm();
  setupLogout();
  setupUserMenu();
  updateUserInfo();
});

// Проверка авторизации
function checkAuth() {
  const token = localStorage.getItem('userToken');
  const currentUser = getCurrentUser();
  
  // Если пользователь не авторизован и находится на главной странице, перенаправляем на страницу входа
  if (!token || !currentUser) {
    if (window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/')) {
      window.location.href = 'login.html';
    }
    return false;
  }
  
  // Если пользователь авторизован и находится на странице входа/регистрации, перенаправляем на главную
  if (token && currentUser) {
    if (window.location.pathname.includes('login.html') || window.location.pathname.includes('register.html')) {
      window.location.href = 'index.html';
    }
  }
  
  return true;
}

// Получение текущего пользователя
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

// Сохранение пользователя
function saveUser(user) {
  const normalizedUser = normalizeUser(user);
  localStorage.setItem('currentUser', JSON.stringify(normalizedUser));
  localStorage.setItem('userToken', generateToken(user.email));
}

// Генерация токена (упрощенная версия)
function generateToken(email) {
  return btoa(email + ':' + Date.now()).replace(/[^a-zA-Z0-9]/g, '');
}

// Настройка формы входа
function setupLoginForm() {
  const loginForm = document.querySelector('#loginForm');
  if (!loginForm) return;
  
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;
    
    if (!email || !password) {
      alert('Пожалуйста, заполните все поля');
      return;
    }
    
    // Получаем зарегистрированных пользователей
    const users = getUsers();
    
    // Проверяем существование пользователя
    const user = users.find(u => u.email === email && u.password === password);
    
    if (!user) {
      alert('Неверный email или пароль');
      return;
    }
    
    // Сохраняем пользователя
    saveUser(user);
    
    // Если "Запомнить меня" не выбрано, токен будет удален при закрытии браузера
    if (!rememberMe) {
      // Используем sessionStorage для временного хранения
      sessionStorage.setItem('userToken', localStorage.getItem('userToken'));
      sessionStorage.setItem('currentUser', localStorage.getItem('currentUser'));
    }
    
    // Перенаправляем на главную страницу
    window.location.href = 'index.html';
  });
}

// Настройка формы регистрации
function setupRegisterForm() {
  const registerForm = document.querySelector('#registerForm');
  if (!registerForm) return;
  
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (!username || !email || !password || !confirmPassword) {
      alert('Пожалуйста, заполните все поля');
      return;
    }
    
    if (password !== confirmPassword) {
      alert('Пароли не совпадают');
      return;
    }
    
    if (password.length < 6) {
      alert('Пароль должен содержать минимум 6 символов');
      return;
    }
    
    // Получаем зарегистрированных пользователей
    const users = getUsers();
    
    // Проверяем, не зарегистрирован ли уже пользователь с таким email
    if (users.find(u => u.email === email)) {
      alert('Пользователь с таким email уже зарегистрирован');
      return;
    }
    
    // Создаем нового пользователя
    const newUser = {
      id: Date.now().toString(),
      username: username,
      email: email,
      password: password,
      createdAt: new Date().toISOString(),
      avatar: getDefaultAvatar(),
      status: '',
      phone: '',
      bio: '',
      preferences: {
        reminderLeadDays: 1
      },
      friends: [],
      friendRequests: {
        incoming: [],
        outgoing: []
      }
    };
    
    // Добавляем пользователя
    users.push(newUser);
    saveUsers(users);
    
    // Автоматически входим
    saveUser(newUser);
    
    // Перенаправляем на главную страницу
    window.location.href = 'index.html';
  });
}

// Получение списка пользователей
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

// Сохранение списка пользователей
function saveUsers(users) {
  localStorage.setItem('users', JSON.stringify(users));
}

// Настройка кнопки выхода
function setupLogout() {
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

// Настройка меню пользователя
function setupUserMenu() {
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userMenuContainer = document.querySelector('.user-menu-container');
  const userMenuDropdown = document.getElementById('userMenuDropdown');
  
  if (!userMenuBtn || !userMenuContainer || !userMenuDropdown) return;
  
  // Открытие/закрытие меню при клике на кнопку
  userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuContainer.classList.toggle('active');
  });
  
  // Закрытие меню при клике вне его
  document.addEventListener('click', (e) => {
    if (!userMenuContainer.contains(e.target)) {
      userMenuContainer.classList.remove('active');
    }
  });
  
  // Закрытие меню при клике на пункт меню
  const menuLinks = userMenuDropdown.querySelectorAll('.user-menu-link');
  menuLinks.forEach(link => {
    link.addEventListener('click', () => {
      userMenuContainer.classList.remove('active');
    });
  });
}

// Обновление информации о пользователе в меню
function updateUserInfo() {
  const currentUser = getCurrentUser();
  
  if (!currentUser) return;
  
  // Обновляем имя пользователя
  const userNameEl = document.getElementById('userName');
  const menuUserNameEl = document.getElementById('menuUserName');
  
  if (userNameEl) {
    userNameEl.textContent = currentUser.username || 'Пользователь';
  }
  
  if (menuUserNameEl) {
    menuUserNameEl.textContent = currentUser.username || 'Пользователь';
  }
  
  // Обновляем email
  const menuUserEmailEl = document.getElementById('menuUserEmail');
  if (menuUserEmailEl) {
    menuUserEmailEl.textContent = currentUser.email || '';
  }
  
  const userAvatarEl = document.getElementById('userAvatar');
  const menuUserAvatarEl = document.getElementById('menuUserAvatar');
  applyAvatarToElement(userAvatarEl, currentUser.avatar);
  applyAvatarToElement(menuUserAvatarEl, currentUser.avatar);
}

// Выход из системы
function logout() {
  localStorage.removeItem('userToken');
  localStorage.removeItem('currentUser');
  sessionStorage.removeItem('userToken');
  sessionStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

// Получение задач пользователя (личных и проектных)
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

// Сохранение задач пользователя (для обратной совместимости)
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

// Получение всех задач (для всех пользователей)
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

// Сохранение всех задач
function saveAllTasks(tasks) {
  localStorage.setItem('tasks', JSON.stringify(tasks));
}

// Работа с проектами
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
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  saveAllProjects(projects);
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
}

function deleteTaskById(taskId) {
  const allTasks = getAllTasks();
  const filtered = allTasks.filter(task => task.id !== taskId);
  saveAllTasks(filtered);
}

// Экспорт функций
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
  return {
    ...user,
    avatar: normalizeAvatar(user.avatar),
    status: user.status || '',
    phone: user.phone || '',
    bio: user.bio || '',
    preferences: {
      ...(user.preferences || {}),
      reminderLeadDays: user.preferences?.reminderLeadDays ?? 1
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

function updateCurrentUserData(updates = {}) {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;
  
  const updatedData = { ...updates };
  if (updates.avatar) {
    updatedData.avatar = normalizeAvatar(updates.avatar);
  }
  
  const mergedUser = normalizeUser({ ...currentUser, ...updatedData });
  localStorage.setItem('currentUser', JSON.stringify(mergedUser));
  
  const users = getUsers();
  const index = users.findIndex(user => user.id === mergedUser.id);
  if (index >= 0) {
    users[index] = { ...users[index], ...updatedData };
    users[index] = normalizeUser(users[index]);
    saveUsers(users);
  }
  
  updateUserInfo();
  return mergedUser;
}

function updateUserPassword(newPassword) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  
  const updatedUser = { ...currentUser, password: newPassword };
  localStorage.setItem('currentUser', JSON.stringify(updatedUser));
  
  const users = getUsers();
  const index = users.findIndex(user => user.id === currentUser.id);
  if (index >= 0) {
    users[index].password = newPassword;
    saveUsers(users);
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

function sendFriendRequest(email) {
  const currentUser = getCurrentUser();
  if (!currentUser) return { success: false, message: 'Не авторизованы' };
  
  const users = getUsers();
  const target = users.find(user => user.email === email);
  if (!target) return { success: false, message: 'Пользователь не найден' };
  if (target.id === currentUser.id) return { success: false, message: 'Нельзя добавить себя' };
  
  const currentData = normalizeUser(currentUser);
  if (currentData.friends.includes(target.id)) {
    return { success: false, message: 'Пользователь уже в друзьях' };
  }
  
  if (!currentData.friendRequests.outgoing.includes(target.id)) {
    currentData.friendRequests.outgoing.push(target.id);
  }
  
  const targetData = normalizeUser(target);
  if (!targetData.friendRequests.incoming.includes(currentUser.id)) {
    targetData.friendRequests.incoming.push(currentUser.id);
  }
  
  persistUserData(currentData);
  persistUserData(targetData);
  return { success: true };
}

function cancelFriendRequest(targetUserId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  
  const users = getUsers();
  const target = users.find(user => user.id === targetUserId);
  if (!target) return false;
  
  const currentData = normalizeUser(currentUser);
  currentData.friendRequests.outgoing = currentData.friendRequests.outgoing.filter(id => id !== targetUserId);
  persistUserData(currentData);
  
  const targetData = normalizeUser(target);
  targetData.friendRequests.incoming = targetData.friendRequests.incoming.filter(id => id !== currentUser.id);
  persistUserData(targetData);
  return true;
}

function respondFriendRequest(requestUserId, accept) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  
  const users = getUsers();
  const requester = users.find(user => user.id === requestUserId);
  if (!requester) return false;
  
  const currentData = normalizeUser(currentUser);
  currentData.friendRequests.incoming = currentData.friendRequests.incoming.filter(id => id !== requestUserId);
  if (accept) {
    if (!currentData.friends.includes(requestUserId)) {
      currentData.friends.push(requestUserId);
    }
  }
  persistUserData(currentData);
  
  const requesterData = normalizeUser(requester);
  requesterData.friendRequests.outgoing = requesterData.friendRequests.outgoing.filter(id => id !== currentUser.id);
  if (accept) {
    if (!requesterData.friends.includes(currentUser.id)) {
      requesterData.friends.push(currentUser.id);
    }
  }
  persistUserData(requesterData);
  return true;
}

function removeFriend(friendId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  const users = getUsers();
  const friend = users.find(user => user.id === friendId);
  if (!friend) return false;
  
  const currentData = normalizeUser(currentUser);
  currentData.friends = currentData.friends.filter(id => id !== friendId);
  persistUserData(currentData);
  
  const friendData = normalizeUser(friend);
  friendData.friends = friendData.friends.filter(id => id !== currentUser.id);
  persistUserData(friendData);
  return true;
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
