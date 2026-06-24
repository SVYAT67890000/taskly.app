let tasks = [];
let taskListEl;
let emptyStateEl;
let tasksCountEl;
let taskProjectFilterEl;
let userLookup = [];
let projectLookup = [];
let draftTaskAttachments = [];
let editTaskAttachmentsList = [];
let taskListViewMode = 'active';


document.addEventListener('DOMContentLoaded', () => {
  taskListEl = document.getElementById('taskList');
  emptyStateEl = document.getElementById('emptyState');
  tasksCountEl = document.getElementById('tasksCount');
  taskProjectFilterEl = document.getElementById('projectFilter');
  
  loadTasks();
  setupFilters();
  setupEditModal();
  setupTaskForm();
  setupModalButtons();
  setupTaskAttachments();
  setupTaskViewTabs();
  const modal = document.getElementById('addTaskModal');
  if (modal) {
    modal.addEventListener('show.bs.modal', () => setDefaultTaskDate());
  }
});


function loadTasks() {
  tasks = getTasksForCurrentUser();
  renderTasks();
}


function saveTasks() {
  
  if (typeof saveUserTasks === 'function') {
    saveUserTasks(tasks);
  } else {
    
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }
}


function renderTasks() {
  if (!taskListEl || !emptyStateEl || !tasksCountEl) {
    updateProjectOverviewOnly();
    return;
  }
  
  
  tasks = getTasksForCurrentUser();
  
  
  userLookup = typeof getUsers === 'function' ? getUsers() : [];
  projectLookup = typeof getAllProjects === 'function' ? getAllProjects() : [];
  const filteredTasks = getFilteredTasks();
  const currentProjectFilter = taskProjectFilterEl?.value || 'all';
  if (typeof renderProjectOverviewCard === 'function') {
    renderProjectOverviewCard(currentProjectFilter);
  }
  
  
  
  updateTasksCount(filteredTasks.length);
  
  
  if (filteredTasks.length === 0) {
    taskListEl.innerHTML = '';
    emptyStateEl.classList.remove('d-none');
    const emptyTitle = emptyStateEl.querySelector('.empty-title');
    const emptyText = emptyStateEl.querySelector('.empty-text');
    if (taskListViewMode === 'archive') {
      if (emptyTitle) emptyTitle.textContent = 'Архив пуст';
      if (emptyText) emptyText.textContent = 'Выполненные задачи будут появляться здесь.';
    } else {
      if (emptyTitle) emptyTitle.textContent = 'Пока нет задач';
      if (emptyText) emptyText.textContent = 'Создайте свою первую задачу и начните планировать день!';
    }
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
      <td data-label="Тип">
        <span class="task-type-badge ${task.projectId ? 'type-project' : 'type-personal'}">
          ${task.projectId ? 'Проект' : 'Личная'}
        </span>
      </td>
      <td data-label="Задача">
        <div class="task-title-cell">
          <button class="task-title-btn" onclick="editTask('${task.id}')">${escapeHtml(task.title)}</button>
          ${task.description ? `<div class="task-title-sub">${escapeHtml(task.description)}</div>` : ''}
        </div>
      </td>
      ${showProjectColumn ? `<td data-label="Проект">${projectDetails ? escapeHtml(projectDetails.name) : '—'}</td>` : ''}
      ${showAssigneesColumn ? `
        <td data-label="Исполнители">
          <div class="assignee-chips">
            ${assigneesMarkup}
          </div>
        </td>
      ` : ''}
      <td data-label="Срок">${formattedDate}</td>
      <td data-label="Приоритет">
        <span class="priority-pill priority-${task.priority}">
          ${getPriorityText(task.priority)}
        </span>
      </td>
      <td data-label="Статус">
        <label class="checkbox-modern checkbox-inline">
          <input type="checkbox" class="checkbox-input" ${statusChecked} onchange="toggleTaskStatus('${task.id}')">
          <span class="checkbox-label">
            <span class="checkbox-icon"></span>
            ${statusText}
          </span>
        </label>
      </td>
      <td data-label="">
        <div class="task-table-actions">
          <button class="task-card-btn" onclick="editTask('${task.id}')" title="Редактировать"><ion-icon name="create-outline"></ion-icon></button>
          <button class="task-card-btn" onclick="deleteTask('${task.id}')" title="Удалить"><ion-icon name="trash-outline"></ion-icon></button>
        </div>
      </td>
    </tr>
  `;
}


function getPriorityText(priority) {
  const priorityMap = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий'
  };
  return priorityMap[priority] || 'Средний';
}


function setupTaskViewTabs() {
  document.querySelectorAll('[data-task-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      taskListViewMode = btn.dataset.taskView || 'active';
      document.querySelectorAll('[data-task-view]').forEach(b => {
        b.classList.toggle('active', b.dataset.taskView === taskListViewMode);
      });
      renderTasks();
    });
  });
}

function getFilteredTasks() {
  let filtered = [...tasks];

  if (taskListViewMode === 'active') {
    filtered = filtered.filter(task => task.status !== 'completed');
  } else if (taskListViewMode === 'archive') {
    filtered = filtered.filter(task => task.status === 'completed');
  }
  
  const projectFilter = taskProjectFilterEl?.value || 'all';
  if (projectFilter === 'personal') {
    filtered = filtered.filter(task => !task.projectId);
  } else if (projectFilter !== 'all') {
    filtered = filtered.filter(task => task.projectId === projectFilter);
  }
  
  
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  if (statusFilter !== 'all') {
    filtered = filtered.filter(task => task.status === statusFilter);
  }
  
  
  const priorityFilter = document.getElementById('priorityFilter')?.value || 'all';
  if (priorityFilter !== 'all') {
    filtered = filtered.filter(task => task.priority === priorityFilter);
  }
  
  
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


function updateTasksCount(count) {
  if (!tasksCountEl) return;
  
  const word = getTaskWord(count);
  tasksCountEl.textContent = `${count} ${word}`;
}


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


function toggleTaskStatus(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = task.status === 'completed' ? 'pending' : 'completed';
    task.ownerId = task.ownerId || task.userId;
    persistTask(task);
    renderTasks();
    
    
    if (window.location.pathname.includes('calendar')) {
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


function findTaskById(taskId) {
  return getTasksForCurrentUser().find(t => t.id === taskId)
    || getStoredTasksSnapshot().find(t => t.id === taskId);
}

function editTask(taskId) {
  const task = findTaskById(taskId);
  if (!task) return;
  
  
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
  const shareEl = document.getElementById('editShareWithFriends');
  if (shareEl) shareEl.checked = !!task.shareWithFriends;
  editTaskAttachmentsList = [...(task.attachments || [])];
  renderAttachmentsList(document.getElementById('editTaskAttachments'), editTaskAttachmentsList, i => {
    editTaskAttachmentsList.splice(i, 1);
    renderAttachmentsList(document.getElementById('editTaskAttachments'), editTaskAttachmentsList, null);
  });
  const modalElement = document.getElementById('editTaskModal');
  if (modalElement && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
  }
}


function deleteTask(taskId) {
  const task = findTaskById(taskId);
  if (typeof confirmDeleteTask === 'function') {
    confirmDeleteTask(taskId, task?.title);
    return;
  }
  if (confirm('Вы уверены, что хотите удалить эту задачу?')) {
    deleteTaskById(taskId);
    tasks = tasks.filter(t => t.id !== taskId);
    renderTasks();
    refreshCalendarIfNeeded();
    showNotification?.('Задача удалена!');
  }
}

function refreshCalendarIfNeeded() {
  if (window.location.pathname.includes('calendar.html')) {
    if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
      loadTasksForCalendar();
      renderCalendar();
    }
  }
}


function setupEditModal() {
  const editForm = document.getElementById('editTaskForm');
  if (editForm) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const taskId = document.getElementById('editTaskId').value;
      const task = tasks.find(t => t.id === taskId);
      
      if (!task) return;
      
      
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
      task.shareWithFriends = document.getElementById('editShareWithFriends')?.checked || false;
      task.attachments = [...editTaskAttachmentsList];
      
      persistTask(task);
      renderTasks();
      
      
      if (window.location.pathname.includes('calendar')) {
        if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
          loadTasksForCalendar();
          renderCalendar();
        }
      }
      
      
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
    
    if (task.projectId) {
      const project = projects.find(p => p.id === task.projectId);
      if (!project) return false;
      return typeof isProjectMember === 'function'
        ? isProjectMember(project, currentUser.id)
        : (project.ownerId === currentUser.id || (project.memberIds || []).includes(currentUser.id));
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

function setupModalButtons() {
  if (typeof bootstrap === 'undefined') return;
  const modalElement = document.getElementById('addTaskModal');
  if (!modalElement) return;

  document.querySelectorAll('.btn-add-task[data-bs-toggle="modal"], .btn-empty-action[data-bs-toggle="modal"]')
    .forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bootstrap.Modal.getOrCreateInstance(modalElement).show();
      });
    });
}

function setDefaultTaskDate() {
  const taskDateEl = document.getElementById('taskDate');
  if (taskDateEl && !taskDateEl.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    taskDateEl.value = tomorrow.toISOString().split('T')[0];
  }
}

function getSelectedValuesFromSelect(selectEl) {
  if (!selectEl) return [];
  return Array.from(selectEl.selectedOptions || []).map(option => option.value);
}

function setupTaskForm() {
  const taskForm = document.getElementById('taskForm');
  if (!taskForm) return;

  taskForm.addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const date = document.getElementById('taskDate').value;
    const priority = document.getElementById('taskPriority').value;
    const projectId = document.getElementById('taskProject')?.value || '';
    const assignees = getSelectedValuesFromSelect(document.getElementById('taskAssignees'));
    const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    const ownerId = currentUser?.id || null;
    const normalizedAssignees = assignees.length > 0 ? assignees : (ownerId ? [ownerId] : []);

    if (!title) { alert('Пожалуйста, введите заголовок задачи'); return; }
    if (!date) { alert('Пожалуйста, выберите дату выполнения'); return; }

    const newTask = {
      id: Date.now().toString(),
      title,
      description: description || '',
      date,
      priority,
      status: 'pending',
      createdAt: new Date().toISOString(),
      projectId: projectId || null,
      assignees: normalizedAssignees,
      ownerId,
      userId: ownerId,
      shareWithFriends: document.getElementById('taskShareWithFriends')?.checked || false,
      attachments: [...draftTaskAttachments]
    };

    if (typeof upsertTask === 'function') {
      upsertTask(newTask);
    } else {
      let list = typeof getUserTasks === 'function' ? getUserTasks() : JSON.parse(localStorage.getItem('tasks') || '[]');
      list.push(newTask);
      if (typeof saveUserTasks === 'function') saveUserTasks(list);
      else localStorage.setItem('tasks', JSON.stringify(list));
    }

    taskForm.reset();
    draftTaskAttachments = [];
    renderAttachmentsList(document.getElementById('taskAttachments'), draftTaskAttachments, null);
    setDefaultTaskDate();
    const projectSelect = document.getElementById('taskProject');
    if (projectSelect) projectSelect.value = '';
    if (typeof updateAssigneeOptions === 'function') updateAssigneeOptions('taskAssignees', '');

    const modalElement = document.getElementById('addTaskModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
      bootstrap.Modal.getInstance(modalElement)?.hide();
    }

    showNotification?.('Задача создана!');
    if (typeof renderTasks === 'function') renderTasks();

    if (window.location.pathname.includes('calendar')) {
      loadTasksForCalendar?.();
      renderCalendar?.();
      return;
    }
    setTimeout(() => window.location.reload(), 300);
  });
}


function setupTaskAttachments() {
  document.getElementById('taskAttachBtn')?.addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    const uploaded = await uploadFiles(files);
    draftTaskAttachments.push(...uploaded);
    renderAttachmentsList(document.getElementById('taskAttachments'), draftTaskAttachments, i => {
      draftTaskAttachments.splice(i, 1);
      renderAttachmentsList(document.getElementById('taskAttachments'), draftTaskAttachments, null);
    });
  });
  document.getElementById('editTaskAttachBtn')?.addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    const uploaded = await uploadFiles(files);
    editTaskAttachmentsList.push(...uploaded);
    renderAttachmentsList(document.getElementById('editTaskAttachments'), editTaskAttachmentsList, i => {
      editTaskAttachmentsList.splice(i, 1);
      renderAttachmentsList(document.getElementById('editTaskAttachments'), editTaskAttachmentsList, null);
    });
  });
}


window.renderTasks = renderTasks;
window.editTask = editTask;
window.deleteTask = deleteTask;
window.findTaskById = findTaskById;
window.toggleTaskStatus = toggleTaskStatus;

