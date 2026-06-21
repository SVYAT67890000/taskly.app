document.addEventListener('DOMContentLoaded', () => {
  const wrap = document.querySelector('.sidebar-tabs');
  const tabs = document.querySelectorAll('[data-sidebar-tab]');
  const panels = document.querySelectorAll('[data-sidebar-panel]');
  if (!tabs.length) return;

  let indicator = wrap?.querySelector('.sidebar-tab-indicator');
  if (wrap && !indicator) {
    indicator = document.createElement('span');
    indicator.className = 'sidebar-tab-indicator';
    wrap.appendChild(indicator);
  }

  function moveIndicator(activeTab) {
    if (!indicator || !activeTab || !wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    indicator.style.width = `${tabRect.width}px`;
    indicator.style.transform = `translateX(${tabRect.left - wrapRect.left}px)`;
  }

  function activate(name) {
    let activeTab = null;
    tabs.forEach(t => {
      const isActive = t.dataset.sidebarTab === name;
      t.classList.toggle('active', isActive);
      if (isActive) activeTab = t;
    });
    panels.forEach(p => p.classList.toggle('active', p.dataset.sidebarPanel === name));
    requestAnimationFrame(() => moveIndicator(activeTab));
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activate(tab.dataset.sidebarTab));
  });

  const initial = document.querySelector('[data-sidebar-tab].active')?.dataset.sidebarTab || 'projects';
  activate(initial);
  window.addEventListener('resize', () => {
    const active = document.querySelector('[data-sidebar-tab].active');
    if (active) moveIndicator(active);
  });
});
