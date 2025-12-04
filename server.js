const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Обслуживание статических файлов из папки frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// Маршрут для главной страницы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Маршруты для других страниц
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'register.html'));
});

// Обработка всех остальных маршрутов (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📁 Статические файлы обслуживаются из папки: ${path.join(__dirname, 'frontend')}`);
});

