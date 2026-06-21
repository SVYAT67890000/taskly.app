
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
  if (!offlineAlert) return; 
  
  if (navigator.onLine) {
    offlineAlert.classList.add('d-none');
    syncWithServer();
  } else {
    offlineAlert.classList.remove('d-none');
  }
}

async function syncWithServer() {
  const token = localStorage.getItem('userToken') || sessionStorage.getItem('userToken');
  if (!token || typeof bootstrapUserData !== 'function') return;

  try {
    await bootstrapUserData();
    if (typeof renderTasks === 'function') renderTasks();
    if (typeof loadTasksForCalendar === 'function' && typeof renderCalendar === 'function') {
      loadTasksForCalendar();
      renderCalendar();
    }
    if (window.location.pathname.includes('notes.html') && typeof loadNotes === 'function') {
      loadNotes();
    }
    if (typeof pollMessageNotifications === 'function') pollMessageNotifications();
    console.log('Синхронизация с сервером завершена');
  } catch (error) {
    console.warn('Ошибка синхронизации:', error.message);
  }
}