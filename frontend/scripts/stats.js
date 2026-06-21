let charts = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (!getCurrentUser()) {
    window.location.href = 'login.html';
    return;
  }
  await loadStats();
  await loadQuote();
  window.addEventListener('taskly-theme-change', () => {
    if (window.__statsData) renderCharts(window.__statsData);
  });
  window.addEventListener('taskly-page-tab', () => {
    if (window.__statsData) {
      requestAnimationFrame(() => renderCharts(window.__statsData));
    }
  });
});

async function loadStats() {
  try {
    const data = await TasklyApi.getStats();
    window.__statsData = data;
    renderSummary(data.summary);
    renderInsights(data);
    renderCharts(data);
  } catch (e) {
    showAppError?.('Статистика', e.message || 'Не удалось загрузить данные');
  }
}

async function loadQuote() {
  const el = document.getElementById('statsQuote');
  if (!el || typeof TasklyApi.getDailyQuote !== 'function') return;
  try {
    const q = await TasklyApi.getDailyQuote();
    el.innerHTML = `<blockquote>«${escapeHtml(q.content)}»</blockquote><cite>— ${escapeHtml(q.author || 'Неизвестно')}</cite>`;
  } catch (_) {}
}

function renderInsights(data) {
  const el = document.getElementById('statsInsights');
  if (!el) return;
  const completed = (data.byStatus || []).find(r => r.status === 'completed')?.count || 0;
  const pending = (data.byStatus || []).find(r => r.status === 'pending')?.count || 0;
  const total = completed + pending;
  const rate = total ? Math.round((completed / total) * 100) : 0;
  const streak = calcStreak(data.completedByDay || []);
  const topPriority = [...(data.byPriority || [])].sort((a, b) => b.count - a.count)[0];
  const priorityNames = { low: 'низкий', medium: 'средний', high: 'высокий' };
  el.innerHTML = `
    <div class="insight-card"><strong>${rate}%</strong><span>задач выполнено</span></div>
    <div class="insight-card"><strong>${streak}</strong><span>дней подряд с активностью</span></div>
    <div class="insight-card"><strong>${topPriority ? priorityNames[topPriority.priority] || '—' : '—'}</strong><span>частый приоритет</span></div>
  `;
}

function calcStreak(rows) {
  const days = new Set((rows || []).filter(r => r.count > 0).map(r => r.day));
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else if (i === 0) {
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

function renderSummary(s) {
  const el = document.getElementById('statsSummary');
  if (!el || !s) return;
  el.innerHTML = `
    <div class="stat-chip"><span class="stat-value">${s.completedTasks}</span><span class="stat-label">Выполнено задач</span></div>
    <div class="stat-chip"><span class="stat-value">${s.projectsOwned}</span><span class="stat-label">Проектов</span></div>
    <div class="stat-chip"><span class="stat-value">${s.friendsCount}</span><span class="stat-label">Друзей</span></div>
    <div class="stat-chip"><span class="stat-value">${s.messagesSent}</span><span class="stat-label">Сообщений</span></div>
  `;
}

function destroyCharts() {
  charts.forEach(c => c.destroy());
  charts = [];
}

function renderCharts(data) {
  destroyCharts();
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1a1a1a';
  const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#6c757d';
  const gridColor = document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'rgba(148,163,184,0.15)' : 'rgba(15,23,42,0.08)';

  const dayLabels = (data.completedByDay || []).reverse().map(r => r.day?.slice(5) || '');
  const dayValues = (data.completedByDay || []).reverse().map(r => r.count);

  const elDay = document.getElementById('chartCompletedByDay');
  if (elDay?.offsetParent !== null) {
    charts.push(new Chart(elDay, {
      type: 'line',
      data: {
        labels: dayLabels.length ? dayLabels : ['—'],
        datasets: [{ label: 'Выполнено', data: dayValues.length ? dayValues : [0], borderColor: '#6366f1', tension: 0.3, fill: true, backgroundColor: 'rgba(99,102,241,0.15)' }]
      },
      options: chartOptions(textColor, mutedColor, gridColor)
    }));
  }

  const statusLabels = { pending: 'Активные', completed: 'Выполнены' };
  const elStatus = document.getElementById('chartByStatus');
  if (elStatus?.offsetParent !== null) {
    charts.push(new Chart(elStatus, {
      type: 'doughnut',
      data: {
        labels: (data.byStatus || []).map(r => statusLabels[r.status] || r.status),
        datasets: [{ data: (data.byStatus || []).map(r => r.count), backgroundColor: ['#f59e0b', '#22c55e'] }]
      },
      options: { responsive: true, plugins: { legend: { labels: { color: textColor, font: { size: 13 } } } } }
    }));
  }

  const priorityLabels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
  const elPriority = document.getElementById('chartByPriority');
  if (elPriority?.offsetParent !== null) {
    charts.push(new Chart(elPriority, {
      type: 'bar',
      data: {
        labels: (data.byPriority || []).map(r => priorityLabels[r.priority] || r.priority),
        datasets: [{ label: 'Задач', data: (data.byPriority || []).map(r => r.count), backgroundColor: '#6366f1' }]
      },
      options: chartOptions(textColor, mutedColor, gridColor)
    }));
  }

  const projects = data.projectsProgress || [];
  const elProjects = document.getElementById('chartProjects');
  if (elProjects?.offsetParent !== null) {
    charts.push(new Chart(elProjects, {
      type: 'bar',
      data: {
        labels: projects.map(p => p.name),
        datasets: [
          { label: 'Выполнено', data: projects.map(p => p.completed || 0), backgroundColor: '#22c55e' },
          { label: 'Всего', data: projects.map(p => p.total || 0), backgroundColor: '#64748b' }
        ]
      },
      options: { ...chartOptions(textColor, mutedColor, gridColor), indexAxis: projects.length > 5 ? 'y' : 'x' }
    }));
  }
}

function chartOptions(textColor, mutedColor, gridColor) {
  return {
    responsive: true,
    scales: {
      x: { ticks: { color: textColor }, grid: { color: gridColor } },
      y: { ticks: { color: textColor }, grid: { color: gridColor }, beginAtZero: true }
    },
    plugins: { legend: { labels: { color: textColor, font: { size: 13 } } } }
  };
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}
