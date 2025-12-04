// Управление задачами

// Глобальные переменные
let tasks = [];
let taskListEl;
let emptyStateEl;
let tasksCountEl;
let taskProjectFilterEl;
let userLookup = [];
let projectLookup = [];

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  taskListEl = document.getElementById('taskList');
  emptyStateEl = document.getElementById('emptyState');
  tasksCountEl = document.getElementById('tasksCount');
  taskProjectFilterEl = document.getElementById('projectFilter');
  
  loadTasks();
  setupFilters();
  setupEditModal();
});

// Загрузка задач из localStorage
function loadTasks() {
  tasks = getTasksForCurrentUser();
  renderTasks();
}

// Сохранение задач в localStorage
function saveTasks() {
  // Используем функцию из auth.js для сохранения задач текущего пользователя
  if (typeof saveUserTasks === 'function') {
    saveUserTasks(tasks);
  } else {
    // Fallback для случая, если auth.js не загружен
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }
}

// Отображение задач
function renderTasks() {
  if (!taskListEl || !emptyStateEl || !tasksCountEl) {
    updateProjectOverviewOnly();
    return;
  }
  
  // Загружаем актуальные задачи текущего пользователя
  tasks = getTasksForCurrentUser();
  
  // Применяем фильтры
  userLookup = typeof getUsers === 'function' ? getUsers() : [];
  projectLookup = typeof getAllProjects === 'function' ? getAllProjects() : [];
  const filteredTasks = getFilteredTasks();
  const currentProjectFilter = taskProjectFilterEl?.value || 'all';
  if (typeof renderProjectOverviewCard === 'function') {
    renderProjectOverviewCard(currentProjectFilter);
  }
  
  // Очищаем список
  // Обновляем счетчик
  updateTasksCount(filteredTasks.length);
  
  // Если задач нет, показываем пустое состояние
  if (filteredTasks.length === 0) {
    taskListEl.innerHTML = '';
    emptyStateEl.classList.remove('d-none');
    return;
  }
  
  emptyStateEl.classList.add('d-none');
  
  renderTasksTable(filteredTasks);
}

function renderTasksTable(tasksToRender) {
  if (!taskListEl) return;
  
  const projectFilter = taskProjectFilterEl?.value || 'all';
  const showProjectColumn = projectFilter === 'all' || projectFilter !== 'personal';
  const showAssigneesColumn = projectFilter !== 'personal';
  
  const tableHtml = `
    <div class="tasks-table-wrapper">
      <table class="tasks-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Задача</th>
            ${showProjectColumn ? '<th>Проект</th>' : ''}
            ${showAssigneesColumn ? '<th>Исполнители</th>' : ''}
            <th>Срок</th>
            <th>Приоритет</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${tasksToRender.map(task => createTaskRow(task, { showProjectColumn, showAssigneesColumn })).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  taskListEl.innerHTML = tableHtml;
}

function createTaskRow(task, { showProjectColumn, showAssigneesColumn }) {
  const projectDetails = getProjectDetails(task.projectId);
  const assigneesMarkup = renderAssigneesInline(task.assignees);
  const formattedDate = formatTaskDate(task.date);
  const statusChecked = task.status === 'completed' ? 'checked' : '';
  const statusText = task.status === 'completed' ? 'Выполнена' : 'Активна';
  
  return `
    <tr data-task-id="${task.id}">
      <td>
        <span class="task-type-badge ${task.projectId ? 'type-project' : 'type-personal'}">
          ${task.projectId ? 'Проект' : 'Личная'}
        </span>
      </td>
      <td>
        <div class="task-title-cell">
          <button class="task-title-btn" onclick="editTask('${task.id}')">${escapeHtml(task.title)}</button>
          ${task.description ? `<div class="task-title-sub">${escapeHtml(task.description)}</div>` : ''}
        </div>
      </td>
      ${showProjectColumn ? `<td>${projectDetails ? escapeHtml(projectDetails.name) : '—'}</td>` : ''}
      ${showAssigneesColumn ? `
        <td>
          <div class="assignee-chips">
            ${assigneesMarkup}
          </div>
        </td>
      ` : ''}
      <td>${formattedDate}</td>
      <td>
        <span class="priority-pill priority-${task.priority}">
          ${getPriorityText(task.priority)}
        </span>
      </td>
      <td>
        <label class="checkbox-modern checkbox-inline">
          <input type="checkbox" class="checkbox-input" ${statusChecked} onchange="toggleTaskStatus('${task.id}')">
          <span class="checkbox-label">
            <span class="checkbox-icon"></span>
            ${statusText}
          </span>
        </label>
      </td>
      <td>
        <div class="task-table-actions">
          <button class="task-card-btn" onclick="editTask('${task.id}')" title="Редактировать">✏️</button>
          <button class="task-card-btn" onclick="deleteTask('${task.id}')" title="Удалить">🗑️</button>
        </div>
      </td>
    </tr>
  `;
}

// Получение текста приоритета
function getPriorityText(priority) {
  const priorityMap = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий'
  };
  return priorityMap[priority] || 'Средний';
}

// Применение фильтров
function getFilteredTasks() {
  let filtered = [...tasks];
  
  const projectFilter = taskProjectFilterEl?.value || 'all';
  if (projectFilter === 'personal') {
    filtered = filtered.filter(task => !task.projectId);
  } else if (projectFilter !== 'all') {
    filtered = filtered.filter(task => task.projectId === projectFilter);
  }
  
  // Фильтр по статусу
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  if (statusFilter !== 'all') {
    filtered = filtered.filter(task => task.status === statusFilter);
  }
  
  // Фильтр по приоритету
  const priorityFilter = document.getElementById('priorityFilter')?.value || 'all';
  if (priorityFilter !== 'all') {
    filtered = filtered.filter(task => task.priority === priorityFilter);
  }
  
  // Сортировка
  const sortFilter = document.getElementById('sortFilter')?.value || 'dateAsc';
  filtered.sort((a, b) => {
    switch (sortFilter) {
      case 'dateDesc':
        return new Date(b.date) - new Date(a.date);
      case 'dateAsc':
        return new Date(a.date) - new Date(b.date);
      case 'priority':
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      default:
        return 0;
    }
  });
  
  return filtered;
}

// Обновление счетчика задач
function updateTasksCount(count) {
  if (!tasksCountEl) return;
  
  const word = getTaskWord(count);
  tasksCountEl.textContent = `${count} ${word}`;
}

// Правильное склонение слова "задача"
function getTaskWord(count) {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return 'задач';
  }
  if (lastDigit === 1) {
    return 'задача';
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'задачи';
  }
  return 'задач';
}

// Настройка фильтров
function setupFilters() {
  const statusFilter = document.getElementById('statusFilter');
  const priorityFilter = document.getElementById('priorityFilter');
  const sortFilter = document.getElementById('sortFilter');
  
  if (statusFilter) {
    statusFilter.addEventListener('change', renderTasks);
  }
  if (priorityFilter) {
    priorityFilter.addEventListener('change', renderTasks);
  }
  if (sortFilter) {
    sortFilter.addEventListener('change', renderTasks);
  }
}

// Переключение статуса задачи
function toggleTaskStatus(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = task.status === 'completed' ? 'pending' : 'completed';
    task.ownerId = task.ownerId || task.userId;
    persistTask(task);
    renderTasks();
    
    // Обновляем календарь, если мы на странице календаря
    if (window.location.pathname.includes('calendar.html')) {
      if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
        loadTasksForCalendar();
        renderCalendar();
      }
    }
    
    if (typeof showNotification === 'function') {
      showNotification(task.status === 'completed' ? 'Задача выполнена!' : 'Задача активирована!');
    }
  }
}

// Редактирование задачи
function editTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  
  // Заполняем форму редактирования
  document.getElementById('editTaskId').value = task.id;
  document.getElementById('editTitle').value = task.title;
  document.getElementById('editDescription').value = task.description || '';
  document.getElementById('editDate').value = task.date;
  document.getElementById('editPriority').value = task.priority;
  document.getElementById('editStatus').checked = task.status === 'completed';
  const editProjectSelect = document.getElementById('editTaskProject');
  if (editProjectSelect) {
    editProjectSelect.value = task.projectId || '';
  }
  if (typeof updateAssigneeOptions === 'function') {
    updateAssigneeOptions('editTaskAssignees', task.projectId || '', task.assignees && task.assignees.length ? task.assignees : [task.ownerId || task.userId]);
  }
  const assigneesSelect = document.getElementById('editTaskAssignees');
  if (assigneesSelect && task.assignees) {
    Array.from(assigneesSelect.options).forEach(option => {
      option.selected = task.assignees.includes(option.value);
    });
  }
  
  // Открываем модальное окно редактирования
  const modalElement = document.getElementById('editTaskModal');
  if (modalElement && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
  }
}

// Удаление задачи
function deleteTask(taskId) {
  if (confirm('Вы уверены, что хотите удалить эту задачу?')) {
    tasks = tasks.filter(t => t.id !== taskId);
    removeTask(taskId);
    renderTasks();
    
    // Обновляем календарь, если мы на странице календаря
    if (window.location.pathname.includes('calendar.html')) {
      if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
        loadTasksForCalendar();
        renderCalendar();
      }
    }
    
    if (typeof showNotification === 'function') {
      showNotification('Задача удалена!');
    }
  }
}

// Настройка модального окна редактирования
function setupEditModal() {
  const editForm = document.getElementById('editTaskForm');
  if (editForm) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const taskId = document.getElementById('editTaskId').value;
      const task = tasks.find(t => t.id === taskId);
      
      if (!task) return;
      
      // Обновляем задачу
      task.title = document.getElementById('editTitle').value.trim();
      task.description = document.getElementById('editDescription').value.trim();
      task.date = document.getElementById('editDate').value;
      task.priority = document.getElementById('editPriority').value;
      task.status = document.getElementById('editStatus').checked ? 'completed' : 'pending';
      const projectId = document.getElementById('editTaskProject')?.value || '';
      const assigneesSelect = document.getElementById('editTaskAssignees');
      task.projectId = projectId || null;
      const selectedAssignees = getSelectedValues(assigneesSelect);
      task.assignees = selectedAssignees.length > 0 ? selectedAssignees : [task.ownerId || task.userId];
      task.ownerId = task.ownerId || task.userId;
      
      persistTask(task);
      renderTasks();
      
      // Обновляем календарь, если мы на странице календаря
      if (window.location.pathname.includes('calendar.html')) {
        if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
          loadTasksForCalendar();
          renderCalendar();
        }
      }
      
      // Закрываем модальное окно
      const modalElement = document.getElementById('editTaskModal');
      if (modalElement && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        const modal = bootstrap.Modal.getInstance(modalElement);
        if (modal) {
          modal.hide();
        }
      }
      
      if (typeof showNotification === 'function') {
        showNotification('Задача обновлена!');
      }
    });
  }
}

// Экранирование HTML для безопасности
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function persistTask(task) {
  if (typeof upsertTask === 'function') {
    upsertTask(task);
  } else {
    saveTasks();
  }
}

function removeTask(taskId) {
  if (typeof deleteTaskById === 'function') {
    deleteTaskById(taskId);
  } else {
    saveTasks();
  }
}

function getSelectedValues(selectEl) {
  if (!selectEl) return [];
  return Array.from(selectEl.selectedOptions || []).map(option => option.value);
}

function updateProjectOverviewOnly() {
  const currentProjectFilter = taskProjectFilterEl?.value || 'all';
  if (typeof renderProjectOverviewCard === 'function') {
    renderProjectOverviewCard(currentProjectFilter);
  }
}

function getTasksForCurrentUser() {
  if (typeof getCurrentUser !== 'function') {
    return [];
  }
  
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return [];
  }
  
  const allTasks = getStoredTasksSnapshot();
  const projects = typeof getAllProjects === 'function' ? getAllProjects() : [];
  
  return allTasks.filter(task => {
    const ownerId = task.ownerId || task.userId;
    const assignees = Array.isArray(task.assignees) ? task.assignees : [];
    
    if (task.projectId) {
      const project = projects.find(p => p.id === task.projectId);
      if (!project) return false;
      const isMember = project.ownerId === currentUser.id || (project.memberIds || []).includes(currentUser.id);
      const isAssigned = assignees.length === 0 || assignees.includes(currentUser.id);
      return isMember && (isAssigned || project.ownerId === currentUser.id);
    }
    
    return ownerId === currentUser.id;
  });
}

function getStoredTasksSnapshot() {
  const saved = localStorage.getItem('tasks');
  if (!saved) return [];
  try {
    return JSON.parse(saved);
  } catch (error) {
    console.error('Ошибка чтения задач из localStorage:', error);
    return [];
  }
}

function getProjectDetails(projectId) {
  if (!projectId) return null;
  return projectLookup.find(project => project.id === projectId) || (typeof getProjectById === 'function' ? getProjectById(projectId) : null);
}

function formatTaskDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const taskDate = new Date(dateStr);
    return taskDate.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch (error) {
    return '—';
  }
}

function renderAssigneesInline(assignees = []) {
  if (!assignees || assignees.length === 0) {
    return '<span class="assignee-chip assignee-empty">—</span>';
  }
  
  return assignees.map(assigneeId => {
    const name = getUserDisplayName(assigneeId);
    return `<span class="assignee-chip">${escapeHtml(name)}</span>`;
  }).join('');
}

function getUserDisplayName(userId) {
  const user = userLookup.find(u => u.id === userId);
  if (!user) return 'Участник';
  return user.username || user.email || 'Участник';
}

// Экспорт функций для использования в других скриптах
window.renderTasks = renderTasks;
window.editTask = editTask;
window.deleteTask = deleteTask;
window.toggleTaskStatus = toggleTaskStatus;

