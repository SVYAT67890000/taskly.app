document.addEventListener('DOMContentLoaded', () => {
  const wrap = document.querySelector('[data-page-tabs]');
  const tabs = document.querySelectorAll('[data-page-tab]');
  const panels = document.querySelectorAll('[data-page-panel]');
  if (!tabs.length || !panels.length) return;

  const params = new URLSearchParams(window.location.search);
  const initial = params.get('tab') || tabs[0]?.dataset.pageTab;

  function activate(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.pageTab === name));
    panels.forEach(p => p.classList.toggle('active', p.dataset.pagePanel === name));
    if (wrap) wrap.dataset.activeTab = name;
    window.dispatchEvent(new CustomEvent('taskly-page-tab', { detail: { tab: name } }));
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activate(tab.dataset.pageTab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab.dataset.pageTab);
      history.replaceState(null, '', url);
    });
  });

  if (initial) activate(initial);
});
