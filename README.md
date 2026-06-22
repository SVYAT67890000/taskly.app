# Таскли — Органайзер задач и заметок

Веб-приложение для управления задачами, проектами, друзьями и совместной работой.

## Установка

```bash
npm install
```

## Запуск

```bash
npm start
```

Сайт: http://localhost:3000  
API: http://localhost:3000/api

## Возможности

- **Аккаунт** — при регистрации выдаётся тег `имя#1234` и личный ID `TL-XXXXXX`
- **Друзья** — заявки по тегу или личному ID, чат
- **Проекты** — совместные задачи с участниками из друзей
- **Mind Map** — общая карта идей по проекту (`mindmap.html?project=...` или кнопка в карточке проекта)
- **Статистика** — графики задач и проектов (`stats.html`)
- **Достижения** — за задачи, проекты, друзей, сообщения и mind map (в профиле)

## Структура

```
taskly.app/
├── data/              # SQLite
├── db/                # Схема и логика БД
├── server/api.js      # REST API
├── frontend/          # Клиент
└── server.js
```

## Технологии

- Node.js, Express, better-sqlite3, bcryptjs
- HTML/CSS/JavaScript, Chart.js

## PWA

Taskly поддерживает установку как Progressive Web App:

1. Откройте сайт в Chrome или Edge (нужен HTTPS или `localhost`)
2. Нажмите «Установить» в баннере или через меню браузера → «Установить Taskly»
3. На телефоне: «Добавить на главный экран» в меню браузера

Файлы PWA: `manifest.json`, `sw.js` (офлайн-кэш статики, API всегда через сеть).

## Деплой на Cloudflare Pages + D1

На Cloudflare **не работает** локальный SQLite (`better-sqlite3`) и Node.js сервер (`server.js`).  
API развёрнут как **Pages Functions** + база **Cloudflare D1**.

### Первый деплой

```bash
npm install
npm run db:migrate:remote    # создать таблицы в D1
npm run deploy               # деплой frontend + functions
```

### Локальная проверка (как на Cloudflare)

```bash
npm run db:migrate:local
npm run dev:pages
```

### Переменные в Cloudflare Dashboard

Pages → **tasklyapp** → Settings → Environment variables:

| Переменная | Назначение |
|------------|------------|
| `ADMIN_EMAILS` | Email админов через запятую (поддержка) |
| `VAPID_PUBLIC_KEY` | Push-уведомления (опционально) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Письма с кодами (опционально) |

D1 binding `DB` → `taskly-db` задаётся в `wrangler.toml`.

### Структура (Cloudflare)

```
taskly.app/
├── frontend/           # статика (HTML, JS, CSS)
├── functions/api/      # Pages Functions → /api/*
├── worker/             # Hono API + D1
├── migrations/         # SQL-схема D1
└── wrangler.toml
```

Локально по-прежнему: `npm start` (Express + SQLite в `data/taskly.db`).


```bash
PORT=8080 npm start
```
