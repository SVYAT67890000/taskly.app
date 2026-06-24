require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

// Handle async errors in Express 4
if (process.env.DATABASE_URL) {
  require('express-async-errors');
}

const { router: apiRouter } = require('./server/api-pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json({ limit: '5mb' }));
app.use('/api', apiRouter);

app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'frontend', 'sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'frontend', 'manifest.json'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'register.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const filePath = path.join(__dirname, 'frontend', req.path);
  const fs = require('fs');
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

const server = app.listen(PORT, () => {
  const dataDir = path.join(__dirname, 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  require('./db/init').getDb();
  const { initWebPush, startReminderPushJob } = require('./db/push');
  initWebPush();
  startReminderPushJob();

  const { verifySmtpConnection } = require('./server/email');
  verifySmtpConnection().then(smtp => {
    if (!smtp.configured) {
      console.log('[email] SMTP не настроен — коды пароля выводятся в консоль');
    } else if (smtp.ok) {
      console.log('[email] SMTP подключён:', process.env.SMTP_HOST);
    } else {
      console.warn('[email] SMTP настроен, но проверка не прошла:', smtp.error);
    }
  }).catch(() => {});

  console.log(`Таскли запущен: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} уже занят. Закройте другой экземпляр сервера или запустите: PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});
