function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getPushRegistration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return navigator.serviceWorker.ready;
}

async function getCurrentPushSubscription() {
  const reg = await getPushRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

async function subscribeToPushNotifications() {
  if (!('Notification' in window)) {
    throw new Error('Браузер не поддерживает уведомления');
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    throw new Error('Разрешите уведомления в настройках браузера');
  }

  const reg = await getPushRegistration();
  if (!reg) throw new Error('Service Worker не готов. Обновите страницу.');

  const { publicKey } = await TasklyApi.getVapidKey();
  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  await TasklyApi.savePushSubscription(subscription.toJSON());
  localStorage.setItem('taskly.push.enabled', '1');
  return subscription;
}

async function unsubscribeFromPushNotifications() {
  const subscription = await getCurrentPushSubscription();
  if (subscription) {
    await TasklyApi.removePushSubscription(subscription.endpoint);
    await subscription.unsubscribe();
  }
  localStorage.removeItem('taskly.push.enabled');
}

async function syncPushSubscriptionState() {
  try {
    const sub = await getCurrentPushSubscription();
    if (sub && localStorage.getItem('taskly.push.enabled')) {
      await TasklyApi.savePushSubscription(sub.toJSON());
      return 'active';
    }
    return sub ? 'local' : 'none';
  } catch (_) {
    return 'none';
  }
}

function showBrowserNotification(title, body, options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && options.skipIfVisible) return;

  try {
    new Notification(title, {
      body,
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-192.png',
      tag: options.tag || 'taskly-reminder',
      data: options.data
    });
  } catch (_) {}
}

window.subscribeToPushNotifications = subscribeToPushNotifications;
window.unsubscribeFromPushNotifications = unsubscribeFromPushNotifications;
window.syncPushSubscriptionState = syncPushSubscriptionState;
window.showBrowserNotification = showBrowserNotification;
window.getCurrentPushSubscription = getCurrentPushSubscription;
