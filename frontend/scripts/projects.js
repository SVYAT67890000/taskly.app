

let projectFilterEl;
let projectOverviewEl;
let projectMembersSelectEl;

document.addEventListener('DOMContentLoaded', () => {
  projectFilterEl = document.getElementById('projectFilter');
  projectOverviewEl = document.getElementById('projectOverview');
  projectMembersSelectEl = document.getElementById('projectMembers');

  setupProjectFilter();
  setupProjectForm();
  setupAssigneeDependants();
  refreshProjectSelectors();
  renderProjectOverview(getCurrentProjectFilterValue());
});

function setupProjectFilter() {
  if (!projectFilterEl) return;

  projectFilterEl.addEventListener('change', () => {
    renderProjectOverview(projectFilterEl.value);
    if (typeof window.renderTasks === 'function') {
      window.renderTasks();
    }
    if (typeof window.loadTasksForCalendar === 'function' && typeof window.renderCalendar === 'function') {
      window.loadTasksForCalendar();
      window.renderCalendar();
    }
  });
}

function setupProjectForm() {
  const projectForm = document.getElementById('projectForm');
  if (!projectForm) return;

  populateProjectMembersSelect();

  const projectModal = document.getElementById('projectModal');
  if (projectModal && typeof bootstrap !== 'undefined') {
    projectModal.addEventListener('show.bs.modal', populateProjectMembersSelect);
  }

  projectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('projectName').value.trim();
    const description = document.getElementById('projectDescription').value.trim();
    const selectedMembers = Array.from((projectMembersSelectEl || {}).selectedOptions || []).map(option => option.value);
    const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;

    if (!name) {
      alert('Введите название проекта');
      return;
    }

    if (!currentUser) {
      alert('Для создания проекта требуется авторизация');
      return;
    }

    const uniqueMembers = Array.from(new Set([currentUser.id, ...selectedMembers]));

    const newProject = {
      id: `project_${Date.now()}`,
      name,
      description,
      ownerId: currentUser.id,
      memberIds: uniqueMembers.filter(id => id !== currentUser.id),
      createdAt: new Date().toISOString()
    };

    if (typeof saveProject === 'function') {
      saveProject(newProject);
    } else {
      persistProjectFallback(newProject);
    }

    if (typeof showNotification === 'function') {
      showNotification('Проект создан и доступен участникам', { type: 'success', icon: '🧩' });
    }

    projectForm.reset();
    refreshProjectSelectors(newProject.id);
    if (projectFilterEl) {
      projectFilterEl.value = newProject.id;
      projectFilterEl.dispatchEvent(new Event('change'));
    }

    if (projectModal && typeof bootstrap !== 'undefined') {
      const modalInstance = bootstrap.Modal.getInstance(projectModal);
      modalInstance?.hide();
    }
  });
}

function setupAssigneeDependants() {
  const dependantSelects = document.querySelectorAll('[data-assignees-target]');
  dependantSelects.forEach(select => {
    select.addEventListener('change', () => {
      const targetId = select.getAttribute('data-assignees-target');
      updateAssigneeOptions(targetId, select.value);
    });
  });
}

function refreshProjectSelectors(preselectProjectId) {
  populateProjectFilter(preselectProjectId);
  populateTaskProjectSelects();
  renderProjectOverview(getCurrentProjectFilterValue());
}

function populateProjectFilter(preselectProjectId) {
  if (!projectFilterEl) return;

  const projects = getAvailableProjects();
  const currentValue = preselectProjectId || projectFilterEl.value || 'all';

  projectFilterEl.innerHTML = `
    <option value="all">Все задачи</option>
    <option value="personal">Личные задачи</option>
  `;

  projects.forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    projectFilterEl.appendChild(option);
  });

  if (currentValue) {
    projectFilterEl.value = projectFilterEl.querySelector(`option[value="${currentValue}"]`) ? currentValue : 'all';
  }
}

function populateTaskProjectSelects() {
  const selects = document.querySelectorAll('#taskProject, #editTaskProject');
  const projects = getAvailableProjects();

  selects.forEach(select => {
    const previousValue = select.value;
    select.innerHTML = '<option value="">Без проекта</option>';

    projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    });

    if (previousValue && select.querySelector(`option[value="${previousValue}"]`)) {
      select.value = previousValue;
    }

    const targetId = select.getAttribute('data-assignees-target');
    updateAssigneeOptions(targetId, select.value);
  });
}

function getFriendUsers() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const friendIds = user?.friends || [];
  const users = typeof getUsers === 'function' ? getUsers() : [];
  return users.filter(u => friendIds.includes(u.id));
}

function populateProjectMembersSelect() {
  if (!projectMembersSelectEl) return;

  projectMembersSelectEl.innerHTML = '';
  getFriendUsers().forEach(user => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = `${user.username || user.tag || user.email} (${user.email})`;
    projectMembersSelectEl.appendChild(option);
  });
}

function getAvailableProjects() {
  if (typeof getUserProjects === 'function') {
    return getUserProjects();
  }
  const raw = localStorage.getItem('projects');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Ошибка чтения проектов:', error);
    return [];
  }
}

function getCurrentProjectFilterValue() {
  return projectFilterEl ? projectFilterEl.value : 'all';
}

function updateAssigneeOptions(targetId, projectId, selectedValues = []) {
  if (!targetId) return;
  const select = document.getElementById(targetId);
  if (!select) return;

  const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const users = typeof getUsers === 'function' ? getUsers() : [];
  const friendIds = currentUser?.friends || [];

  let memberIds = [];

  if (projectId) {
    const project = typeof getProjectById === 'function' ? getProjectById(projectId) : null;
    if (project) {
      memberIds = Array.from(new Set([project.ownerId, ...(project.memberIds || [])]));
    }
  } else if (currentUser) {
    memberIds = [currentUser.id, ...friendIds.filter(id => id !== currentUser.id)];
  }

  select.innerHTML = '';

  memberIds.forEach(memberId => {
    const user = users.find(u => u.id === memberId);
    const option = document.createElement('option');
    option.value = memberId;
    option.textContent = user ? (user.username || user.tag || user.email) : 'Участник';
    select.appendChild(option);
  });

  const valuesToSelect = selectedValues.length > 0 ? selectedValues : (memberIds && memberIds.length ? [memberIds[0]] : []);
  valuesToSelect.forEach(value => {
    const option = select.querySelector(`option[value="${value}"]`);
    if (option) {
      option.selected = true;
    }
  });

  select.disabled = memberIds.length === 0;
}

function renderProjectOverview(projectId) {
  if (!projectOverviewEl) return;

  const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const tasks = getAllStoredTasks();

  if (projectId === 'personal') {
    const personalTasks = tasks.filter(task => {
      const ownerId = task.ownerId || task.userId;
      return !task.projectId && currentUser && ownerId === currentUser.id;
    });
    updateOverviewUI({
      title: 'Личные задачи',
      description: 'Прогресс по вашим личным задачам.',
      completed: personalTasks.filter(t => t.status === 'completed').length,
      total: personalTasks.length
    });
    return;
  }

  if (!projectId || projectId === 'all') {
    const allTasks = currentUser
      ? tasks.filter(task => {
          const ownerId = task.ownerId || task.userId;
          if (!task.projectId) {
            return ownerId === currentUser.id;
          }
          const project = (typeof getProjectById === 'function') ? getProjectById(task.projectId) : null;
          if (!project) return false;
          return typeof isProjectMember === 'function'
            ? isProjectMember(project, currentUser.id)
            : (project.ownerId === currentUser.id || (project.memberIds || []).includes(currentUser.id));
        })
      : tasks;
    updateOverviewUI({
      title: 'Все задачи',
      description: 'Общий прогресс по всем личным и проектным задачам.',
      completed: allTasks.filter(t => t.status === 'completed').length,
      total: allTasks.length
    });
    return;
  }

  const project = (typeof getProjectById === 'function') ? getProjectById(projectId) : null;
  if (!project) {
    updateOverviewUI({
      title: 'Проект не найден',
      description: 'Проект был удален или недоступен.',
      completed: 0,
      total: 0
    });
    return;
  }

  const projectTasks = tasks.filter(task => task.projectId === project.id);
  const completed = projectTasks.filter(task => task.status === 'completed').length;

  updateOverviewUI({
    title: project.name,
    description: project.description || 'Совместные задачи команды.',
    completed,
    total: projectTasks.length,
    project,
    tasks: projectTasks
  });
}

function updateOverviewUI({ title, description, completed, total, project }) {
  const titleEl = projectOverviewEl.querySelector('.project-overview-title');
  const textEl = projectOverviewEl.querySelector('.project-overview-text');
  const progressValueEl = projectOverviewEl.querySelector('.project-progress-value');
  const percentEl = projectOverviewEl.querySelector('.project-progress-percent');
  const summaryEl = projectOverviewEl.querySelector('.project-progress-summary');
  let mindmapEl = projectOverviewEl.querySelector('.project-mindmap-link');
  let membersEl = projectOverviewEl.querySelector('.project-members-list');

  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = description;
  if (progressValueEl) progressValueEl.style.width = `${percent}%`;
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (summaryEl) summaryEl.textContent = `${completed} / ${total} задач`;

  if (project?.id) {
    const memberIds = [project.ownerId, ...(project.memberIds || [])];
    const users = typeof getUsers === 'function' ? getUsers() : [];
    const names = memberIds.map(id => {
      const u = users.find(user => user.id === id);
      return u ? (u.username || u.tag || 'Участник') : 'Участник';
    });
    if (!membersEl) {
      membersEl = document.createElement('div');
      membersEl.className = 'project-members-list';
      projectOverviewEl.appendChild(membersEl);
    }
    membersEl.textContent = `Участники: ${names.join(', ')}`;
    membersEl.style.display = 'block';
    membersEl.style.marginTop = '0.5rem';
    membersEl.style.fontSize = '0.85rem';
    membersEl.style.color = 'var(--text-muted)';

    if (!mindmapEl) {
      mindmapEl = document.createElement('a');
      mindmapEl.className = 'project-mindmap-link btn-primary btn-sm';
      projectOverviewEl.appendChild(mindmapEl);
    }
    mindmapEl.href = `mindmap.html?project=${encodeURIComponent(project.id)}`;
    mindmapEl.innerHTML = '<ion-icon name="git-network-outline"></ion-icon> Открыть Mind Map';
    mindmapEl.style.display = 'inline-flex';
  } else {
    if (membersEl) membersEl.style.display = 'none';
    if (mindmapEl) mindmapEl.style.display = 'none';
  }
}

function getAllStoredTasks() {
  const raw = localStorage.getItem('tasks');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Ошибка чтения задач для проектов:', error);
    return [];
  }
}

function persistProjectFallback(project) {
  const projects = getAvailableProjects();
  projects.push(project);
  localStorage.setItem('projects', JSON.stringify(projects));
}

window.refreshProjectSelectors = refreshProjectSelectors;
window.updateAssigneeOptions = updateAssigneeOptions;
window.renderProjectOverviewCard = renderProjectOverview;


