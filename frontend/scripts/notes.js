// Управление задачами (ранее notes.js, переименован для работы с задачами)

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  setupTaskForm();
  setupModalButtons();
  
  // Устанавливаем дату по умолчанию при открытии модального окна
  const modal = document.getElementById('addTaskModal');
  if (modal) {
    modal.addEventListener('show.bs.modal', () => {
      setDefaultTaskDate();
    });
  }
});

// Настройка кнопок для открытия модального окна
function setupModalButtons() {
  // Ждем, пока Bootstrap загрузится
  if (typeof bootstrap === 'undefined') {
    console.warn('Bootstrap не загружен, модальное окно может не работать');
    return;
  }
  
  const modalElement = document.getElementById('addTaskModal');
  if (!modalElement) {
    console.warn('Модальное окно не найдено');
    return;
  }
  
  // Кнопка "Создать задачу" в сайдбаре
  const addTaskBtn = document.querySelector('.btn-add-task[data-bs-toggle="modal"]');
  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
        modal.show();
      } catch (error) {
        console.error('Ошибка при открытии модального окна:', error);
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
      }
    });
  }
  
  // Кнопка "Создать задачу" в пустом состоянии
  const emptyActionBtn = document.querySelector('.btn-empty-action[data-bs-toggle="modal"]');
  if (emptyActionBtn) {
    emptyActionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
        modal.show();
      } catch (error) {
        console.error('Ошибка при открытии модального окна:', error);
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
      }
    });
  }
}

// Установка даты по умолчанию для задачи
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

// Настройка формы создания задачи
function setupTaskForm() {
  const taskForm = document.getElementById('taskForm');
  
  if (taskForm) {
    taskForm.addEventListener('submit', e => {
      e.preventDefault();
      
      // Получаем данные из формы
      const title = document.getElementById('taskTitle').value.trim();
      const description = document.getElementById('taskDescription').value.trim();
      const date = document.getElementById('taskDate').value;
      const priority = document.getElementById('taskPriority').value;
      const projectId = document.getElementById('taskProject')?.value || '';
      const assigneesSelect = document.getElementById('taskAssignees');
      const assignees = getSelectedValuesFromSelect(assigneesSelect);
      const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
      const ownerId = currentUser?.id || null;
      const normalizedAssignees = assignees.length > 0 ? assignees : (ownerId ? [ownerId] : []);
      
      // Валидация
      if (!title) {
        alert('Пожалуйста, введите заголовок задачи');
        return;
      }
      
      if (!date) {
        alert('Пожалуйста, выберите дату выполнения');
        return;
      }
      
      // Создаем объект задачи
      const newTask = {
        id: Date.now().toString(),
        title: title,
        description: description || '',
        date: date,
        priority: priority,
        status: 'pending',
        createdAt: new Date().toISOString(),
        projectId: projectId || null,
        assignees: normalizedAssignees,
        ownerId: ownerId,
        userId: ownerId
      };
      
      if (typeof upsertTask === 'function') {
        upsertTask(newTask);
      } else {
        let tasks = [];
        if (typeof getUserTasks === 'function') {
          tasks = getUserTasks();
        } else {
          const savedTasks = localStorage.getItem('tasks');
          if (savedTasks) {
            try {
              tasks = JSON.parse(savedTasks);
            } catch (e) {
              console.error('Ошибка при загрузке задач:', e);
              tasks = [];
            }
          }
        }
        tasks.push(newTask);
        if (typeof saveUserTasks === 'function') {
          saveUserTasks(tasks);
        } else {
          localStorage.setItem('tasks', JSON.stringify(tasks));
        }
      }
      
      // Очищаем форму
      taskForm.reset();
      
      // Устанавливаем дату по умолчанию снова
      setDefaultTaskDate();
      const projectSelect = document.getElementById('taskProject');
      if (projectSelect) {
        projectSelect.value = '';
      }
      if (typeof updateAssigneeOptions === 'function') {
        updateAssigneeOptions('taskAssignees', '');
      }
      
      // Закрываем модальное окно
      const modalElement = document.getElementById('addTaskModal');
      if (modalElement) {
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
          const modal = bootstrap.Modal.getInstance(modalElement);
          if (modal) {
            modal.hide();
          } else {
            const newModal = new bootstrap.Modal(modalElement);
            newModal.hide();
          }
        } else {
          const closeBtn = modalElement.querySelector('[data-bs-dismiss="modal"]');
          if (closeBtn) {
            closeBtn.click();
          }
        }
      }
      
      // Показываем уведомление
      if (typeof showNotification === 'function') {
        showNotification('Задача создана!');
      } else {
        alert('Задача создана!');
      }
      
      // Обновляем список задач
      if (typeof renderTasks === 'function') {
        renderTasks();
      }
      
      // Обновляем календарь, если мы на странице календаря
      if (window.location.pathname.includes('calendar.html')) {
        if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
          loadTasksForCalendar();
          renderCalendar();
        }
        // Не перезагружаем страницу на календаре, просто обновляем календарь
        return;
      }
      
      // Перезагружаем страницу для обновления списка задач (только на index.html)
      setTimeout(() => {
        window.location.reload();
      }, 300);
    });
  }
}
