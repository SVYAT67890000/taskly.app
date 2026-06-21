const nodemailer = require('nodemailer');

function getTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || ''
    } : undefined
  });
}

async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || 'noreply@taskly.local';
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[Таскли · email] Кому: ${to}\nТема: ${subject}\n${text}`);
    return { sent: false, logged: true };
  }
  await transporter.sendMail({ from, to, subject, text, html });
  return { sent: true };
}

function passwordCodeEmailContent(code, purpose) {
  const isReset = purpose === 'reset';
  const subject = isReset ? 'Таскли — восстановление пароля' : 'Таскли — код для смены пароля';
  const intro = isReset
    ? 'Код для восстановления пароля:'
    : 'Код для смены пароля:';
  const text = `${intro} ${code}\n\nКод действует 10 минут. Если вы не запрашивали это письмо, проигнорируйте его.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#6366f1;margin:0 0 16px">Таскли</h2>
      <p>${intro}</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;color:#1e293b">${code}</p>
      <p style="color:#64748b;font-size:14px">Код действует 10 минут.</p>
    </div>`;
  return { subject, text, html };
}

async function sendPasswordCodeEmail(to, code) {
  const { subject, text, html } = passwordCodeEmailContent(code, 'change');
  return sendMail({ to, subject, text, html });
}

async function sendPasswordResetEmail(to, code) {
  const { subject, text, html } = passwordCodeEmailContent(code, 'reset');
  return sendMail({ to, subject, text, html });
}

async function verifySmtpConnection() {
  const transporter = getTransporter();
  if (!transporter) return { configured: false, ok: false };
  try {
    await transporter.verify();
    return { configured: true, ok: true };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

module.exports = {
  sendMail,
  sendPasswordCodeEmail,
  sendPasswordResetEmail,
  verifySmtpConnection,
  getTransporter
};
