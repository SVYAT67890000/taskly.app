const CACHE_VERSION = 'taskly-v14';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/calendar.html',
  '/friends.html',
  '/notes.html',
  '/profile.html',
  '/stats.html',
  '/support.html',
  '/guide.html',
  '/mindmap.html',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/styles/style.css',
  '/styles/login.css',
  '/styles/register.css',
  '/styles/legal.css',
  '/styles/pwa.css',
  '/styles/design-light.css',
  '/styles/mobile.css',
  '/assets/logo.svg',
  '/assets/icons/icon.svg',
  '/scripts/pwa.js',
  '/sw.js',
  '/scripts/theme.js',
  '/scripts/consent.js',
  '/scripts/notifications.js',
  '/scripts/api.js',
  '/scripts/auth.js',
  '/scripts/tasks.js',
  '/scripts/projects.js',
  '/scripts/notes.js',
  '/scripts/sync.js',
  '/scripts/reminders.js',
  '/scripts/push-notifications.js',
  '/scripts/notification-settings.js',
  '/scripts/message-notifications.js',
  '/scripts/unread-messages.js',
  '/scripts/notification-center.js',
  '/scripts/dashboard-tabs.js',
  '/scripts/shared-ui.js',
  '/scripts/main-tabs.js',
  '/scripts/attachments.js',
  '/scripts/achievement-icons.js',
  '/scripts/page-tabs.js',
  '/scripts/stats.js',
  '/scripts/friends.js',
  '/scripts/profile.js',
  '/scripts/calendar.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('taskly-') && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api');
}

function isHtmlPage(url) {
  return url.pathname === '/' || url.pathname.endsWith('.html');
}

function isOtherStatic(url) {
  return /\.(css|js|png|jpg|jpeg|svg|webp|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url) || isHtmlPage(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isOtherStatic(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  const networkResponse = await networkPromise;
  return cached || networkResponse || caches.match('/index.html');
}

self.addEventListener('push', (event) => {
  let data = { title: 'Таскли', body: 'Напоминание о задаче', url: '/index.html' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/assets/icons/icon-192.png',
      badge: data.badge || '/assets/icons/icon-192.png',
      tag: data.tag || 'taskly-push',
      data: { url: data.url || '/index.html', taskId: data.taskId }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
