// Проверка интернета и синхронизация
window.addEventListener('load', checkOnlineStatus);
window.addEventListener('online', () => syncWithServer());
window.addEventListener('offline', () => {
  const offlineAlert = document.getElementById('offlineAlert');
  if (offlineAlert) {
    offlineAlert.classList.remove('d-none');
  }
});

function checkOnlineStatus() {
  const offlineAlert = document.getElementById('offlineAlert');
  if (!offlineAlert) return; // Элемент не найден на этой странице
  
  if (navigator.onLine) {
    offlineAlert.classList.add('d-none');
    syncWithServer(); // попробуем синхронизировать при старте
  } else {
    offlineAlert.classList.remove('d-none');
  }
}

async function syncWithServer() {
  const token = localStorage.getItem('userToken');
  if (!token) return; // не авторизован

  try {
    const response = await fetch('https://your-organizer-api.onrender.com/api/tasks', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      const serverTasks = await response.json();
      // Слияние данных: сервер всегда прав
      localStorage.setItem('tasks', JSON.stringify(serverTasks));
      
      // Обновляем интерфейс, если функции доступны
      if (typeof renderTasks === 'function') {
        renderTasks();
      }
      if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
        loadTasksForCalendar();
        renderCalendar();
      }
      console.log('✅ Синхронизация с сервером завершена');
    }
  } catch (error) {
    // Игнорируем ошибки CORS и сетевые ошибки - работаем в оффлайн режиме
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      // Это нормально, если сервер недоступен или CORS не настроен
      console.log('ℹ️ Сервер недоступен, работаем в оффлайн режиме');
    } else {
      console.error('❌ Ошибка синхронизации:', error);
    }
  }
}