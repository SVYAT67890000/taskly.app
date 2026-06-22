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

async function sendViaSmtp(env, { to, subject, text, html }) {
  const host = env.SMTP_HOST;
  if (!host) return null;

  const port = Number(env.SMTP_PORT || 587);
  const from = env.SMTP_FROM || 'noreply@taskly.app';

  // Basic SMTP is not available in Workers; use MailChannels when no custom SMTP relay URL is set.
  if (env.SMTP_RELAY_URL) {
    const auth = env.SMTP_USER
      ? 'Basic ' + btoa(`${env.SMTP_USER}:${env.SMTP_PASS || ''}`)
      : undefined;
    const res = await fetch(env.SMTP_RELAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {})
      },
      body: JSON.stringify({ from, to, subject, text, html })
    });
    if (!res.ok) throw new Error(`SMTP relay error: ${res.status}`);
    return { sent: true };
  }

  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: 'Таскли' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html }
      ]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MailChannels error ${res.status}: ${body}`);
  }
  return { sent: true };
}

async function sendMail(env, { to, subject, text, html }) {
  if (!env.SMTP_HOST) {
    console.log(`[Таскли · email] Кому: ${to}\nТема: ${subject}\n${text}`);
    return { sent: false, logged: true };
  }
  return sendViaSmtp(env, { to, subject, text, html });
}

export async function sendPasswordCodeEmail(env, to, code) {
  const { subject, text, html } = passwordCodeEmailContent(code, 'change');
  return sendMail(env, { to, subject, text, html });
}

export async function sendPasswordResetEmail(env, to, code) {
  const { subject, text, html } = passwordCodeEmailContent(code, 'reset');
  return sendMail(env, { to, subject, text, html });
}
