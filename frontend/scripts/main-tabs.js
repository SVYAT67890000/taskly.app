document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('[data-main-tab]');
  const panels = document.querySelectorAll('[data-main-panel]');
  if (!tabs.length) return;

  const params = new URLSearchParams(window.location.search);
  const initial = params.get('tab') || 'tasks';

  function activate(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.mainTab === name));
    panels.forEach(p => p.classList.toggle('active', p.dataset.mainPanel === name));
    if (name === 'notes' && typeof loadNotes === 'function') loadNotes();
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activate(tab.dataset.mainTab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab.dataset.mainTab);
      history.replaceState(null, '', url);
    });
  });

  activate(initial);
});
