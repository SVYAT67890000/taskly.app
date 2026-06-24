

let currentDate = new Date();
let calendarContainer;
let currentMonthYearEl;
let calendarTasks = []; 
let calendarControlsInitialized = false;


document.addEventListener('DOMContentLoaded', () => {
  
  if (!window.location.pathname.includes('calendar')) {
    return;
  }
  
  console.log('Инициализация календаря...');
  
  calendarContainer = document.getElementById('calendarContainer');
  currentMonthYearEl = document.getElementById('currentMonthYear');
  
  console.log('Элементы календаря:', {
    calendarContainer: !!calendarContainer,
    currentMonthYearEl: !!currentMonthYearEl
  });
  
  
  try {
    if (calendarContainer && currentMonthYearEl) {
      setupCalendarControls();
      loadTasksForCalendar();
      console.log('Загружено задач:', calendarTasks.length);
      renderCalendar();
    } else {
      console.error('Элементы календаря не найдены', {
        calendarContainer: !!calendarContainer,
        currentMonthYearEl: !!currentMonthYearEl
      });
      showCalendarError('Элементы календаря не найдены в DOM.');
    }
  } catch (e) {
    console.error('Ошибка инициализации календаря:', e);
    showCalendarError('Ошибка инициализации: ' + e.message);
  }
  
  
  if (typeof window.renderTasks === 'function') {
    const originalRenderTasks = window.renderTasks;
    window.renderTasks = function() {
      originalRenderTasks();
      if (calendarContainer && currentMonthYearEl) {
        loadTasksForCalendar();
        renderCalendar();
      }
    };
  }
});



function setupCalendarControls() {
  
  if (calendarControlsInitialized) return;
  
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  const todayBtn = document.getElementById('todayBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      renderCalendar();
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderCalendar();
    });
  }
  
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      currentDate = new Date();
      renderCalendar();
    });
  }
  
  calendarControlsInitialized = true;
}


function showCalendarError(msg) {
  if (!calendarContainer) return;
  calendarContainer.innerHTML = `<div class="calendar-error" style="padding:2rem;text-align:center;color:var(--text-secondary);"><p>${escapeHtml(msg)}</p></div>`;
}

function loadTasksForCalendar() {
  if (typeof getUserTasks === 'function') {
    calendarTasks = getUserTasks();
    console.log('Задачи загружены через getUserTasks:', calendarTasks.length);
  } else {
    const saved = localStorage.getItem('tasks');
    if (saved) {
      try {
        const allTasks = JSON.parse(saved);
        console.log('Все задачи из localStorage:', allTasks.length);
        
        if (typeof getCurrentUser === 'function') {
          const currentUser = getCurrentUser();
          if (currentUser) {
            calendarTasks = allTasks.filter(task => task.userId === currentUser.id);
            console.log('Задачи текущего пользователя:', calendarTasks.length, 'userId:', currentUser.id);
          } else {
            calendarTasks = allTasks;
            console.log('Пользователь не найден, используем все задачи');
          }
        } else {
          calendarTasks = allTasks;
        }
      } catch (e) {
        console.error('Ошибка при загрузке задач:', e);
        calendarTasks = [];
      }
    } else {
      calendarTasks = [];
      console.log('Задачи не найдены в localStorage');
    }
  }
  
  const projectFilter = document.getElementById('projectFilter')?.value || 'all';
  if (projectFilter === 'personal') {
    calendarTasks = calendarTasks.filter(task => !task.projectId);
  } else if (projectFilter !== 'all') {
    calendarTasks = calendarTasks.filter(task => task.projectId === projectFilter);
  }
  
  
  if (calendarTasks.length > 0) {
    console.log('Примеры задач:', calendarTasks.slice(0, 3).map(t => ({ id: t.id, title: t.title, date: t.date })));
  }
}


function renderCalendar() {
  if (!calendarContainer || !currentMonthYearEl) {
    console.error('renderCalendar: элементы не найдены');
    return;
  }
  
  console.log('Отрисовка календаря...');
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  
  const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  currentMonthYearEl.textContent = `${monthNames[month]} ${year}`;
  
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  
  const adjustedStartingDay = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;
  
  
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  
  
  let calendarHTML = '<div class="calendar-grid">';
  
  
  calendarHTML += '<div class="calendar-weekdays">';
  dayNames.forEach(day => {
    calendarHTML += `<div class="calendar-weekday">${day}</div>`;
  });
  calendarHTML += '</div>';
  
  
  calendarHTML += '<div class="calendar-days">';
  
  
  for (let i = 0; i < adjustedStartingDay; i++) {
    calendarHTML += '<div class="calendar-day empty"></div>';
  }
  
  
  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = getTasksForDate(dateStr);
    const isToday = isCurrentMonth && day === today.getDate();
    
    calendarHTML += `<div class="calendar-day ${isToday ? 'today' : ''}" data-date="${dateStr}">`;
    calendarHTML += `<div class="calendar-day-number">${day}</div>`;
    
    if (dayTasks.length > 0) {
      calendarHTML += '<div class="calendar-tasks">';
      dayTasks.slice(0, 3).forEach(task => {
        const priorityClass = `task-priority-${task.priority}`;
        const statusClass = task.status === 'completed' ? 'completed' : '';
        calendarHTML += `<div class="calendar-task ${priorityClass} ${statusClass}" title="${escapeHtml(task.title)}" data-task-id="${task.id}">`;
        calendarHTML += `<span class="calendar-task-dot"></span>`;
        calendarHTML += `<span class="calendar-task-title">${escapeHtml(task.title)}</span>`;
        calendarHTML += `</div>`;
      });
      if (dayTasks.length > 3) {
        calendarHTML += `<div class="calendar-task-more">+${dayTasks.length - 3} еще</div>`;
      }
      calendarHTML += '</div>';
    }
    
    calendarHTML += '</div>';
  }
  
  calendarHTML += '</div></div>';
  
  try {
    calendarContainer.innerHTML = calendarHTML;
    console.log('Календарь отрисован, дней в месяце:', daysInMonth, 'HTML длина:', calendarHTML.length);
  } catch (e) {
    console.error('Ошибка при отрисовке календаря:', e);
    return;
  }
  
  
  const taskElements = calendarContainer.querySelectorAll('.calendar-task');
  taskElements.forEach(taskEl => {
    taskEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = taskEl.getAttribute('data-task-id');
      if (taskId && typeof window.editTask === 'function') {
        window.editTask(taskId);
      }
    });
  });
  
  
  const dayElements = calendarContainer.querySelectorAll('.calendar-day:not(.empty)');
  dayElements.forEach(dayEl => {
    dayEl.addEventListener('click', () => {
      const date = dayEl.getAttribute('data-date');
      if (date) {
        showDayTasks(date, dayEl);
      }
    });
  });
}


function getTasksForDate(dateStr) {
  const matchingTasks = calendarTasks.filter(task => {
    if (!task.date) return false;
    
    
    const taskDate = new Date(task.date);
    const compareDate = new Date(dateStr);
    
    
    return taskDate.getFullYear() === compareDate.getFullYear() &&
           taskDate.getMonth() === compareDate.getMonth() &&
           taskDate.getDate() === compareDate.getDate();
  });
  
  return matchingTasks;
}


function showDayTasks(dateStr, dayElement) {
  const dayTasks = getTasksForDate(dateStr);
  
  
  const existingModal = document.getElementById('dayTasksModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  if (dayTasks.length === 0) {
    
    const addTaskModal = document.getElementById('addTaskModal');
    if (addTaskModal && typeof bootstrap !== 'undefined') {
      const dateInput = document.getElementById('taskDate');
      if (dateInput) {
        dateInput.value = dateStr;
      }
      const modal = new bootstrap.Modal(addTaskModal);
      modal.show();
    }
    return;
  }
  
  
  const modalHTML = `
    <div class="modal fade" id="dayTasksModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-modern">
        <div class="modal-content-modern">
          <div class="modal-header-modern">
            <div class="modal-header-content">
              <h5 class="modal-title-modern">
                <span>Задачи на ${formatDate(dateStr)}</span>
              </h5>
              <button type="button" class="btn-close-modern" data-bs-dismiss="modal" aria-label="Close">
                <span>&times;</span>
              </button>
            </div>
          </div>
          <div class="modal-body-modern">
            <div class="day-tasks-list">
              ${dayTasks.map(task => createDayTaskItem(task)).join('')}
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-cancel" data-bs-dismiss="modal">Закрыть</button>
              <button type="button" class="btn-submit" data-bs-toggle="modal" data-bs-target="#addTaskModal" data-bs-dismiss="modal">
                <span>Добавить задачу</span>
                <span class="btn-arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  
  bindDayTaskModalActions();
  
  
  const addTaskBtn = document.querySelector('#dayTasksModal .btn-submit');
  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', () => {
      const dateInput = document.getElementById('taskDate');
      if (dateInput) {
        dateInput.value = dateStr;
      }
    });
  }
  
  
  const modalElement = document.getElementById('dayTasksModal');
  if (modalElement && typeof bootstrap !== 'undefined') {
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
    
    
    modalElement.addEventListener('hidden.bs.modal', () => {
      modalElement.remove();
    });
  }
}


function bindDayTaskModalActions() {
  const modal = document.getElementById('dayTasksModal');
  if (!modal) return;

  modal.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.taskId;
      if (typeof window.editTask === 'function') window.editTask(taskId);
      if (typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getInstance(modal)?.hide();
      }
    });
  });

  modal.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.taskId;
      const task = typeof findTaskById === 'function' ? findTaskById(taskId) : null;
      if (typeof confirmDeleteTask === 'function') {
        confirmDeleteTask(taskId, task?.title);
      } else if (typeof window.deleteTask === 'function') {
        window.deleteTask(taskId);
      }
      if (typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getInstance(modal)?.hide();
      }
    });
  });
}


function createDayTaskItem(task) {
  const priorityClass = {
    low: 'priority-dot-low',
    medium: 'priority-dot-medium',
    high: 'priority-dot-high'
  };
  
  const statusText = task.status === 'completed' ? 'Выполнена' : 'Активна';
  const statusClass = task.status === 'completed' ? 'completed' : '';
  
  return `
    <div class="day-task-item ${statusClass}" data-task-id="${task.id}">
      <div class="day-task-header">
        <h4 class="day-task-title ${statusClass}">${escapeHtml(task.title)}</h4>
        <div class="day-task-priority">
          <span class="priority-dot ${priorityClass[task.priority] || 'priority-dot-medium'}"></span>
        </div>
      </div>
      ${task.description ? `<p class="day-task-description ${statusClass}">${escapeHtml(task.description)}</p>` : ''}
      <div class="day-task-footer">
        <span class="day-task-status">${statusText}</span>
        <div class="day-task-actions">
          <button type="button" class="day-task-btn" data-action="edit" data-task-id="${task.id}" title="Редактировать">
            <ion-icon name="create-outline"></ion-icon>
          </button>
          <button type="button" class="day-task-btn" data-action="delete" data-task-id="${task.id}" title="Удалить">
            <ion-icon name="trash-outline"></ion-icon>
          </button>
        </div>
      </div>
    </div>
  `;
}


function formatDate(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const monthNames = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}


function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


window.loadTasksForCalendar = loadTasksForCalendar;
window.renderCalendar = renderCalendar;

