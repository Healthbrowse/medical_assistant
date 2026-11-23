const header = document.querySelector('.site-header');
const toggle = header?.querySelector('.nav-toggle');
const nav = header?.querySelector('#siteNav');

if (toggle && nav) {
  const narrow = matchMedia('(max-width: 60rem)');
  const groups = [...nav.querySelectorAll('details.nav-group')];

  function closeGroups(except) {
    for (const group of groups) {
      if (group !== except) group.open = false;
    }
  }

  function closeMenu() {
    closeGroups();
    header.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function updateCurrentDestination() {
    const current = nav.querySelector('#accountSignOut')
      ? (location.hash === '#chats' ? 'history' : 'account')
      : 'research';

    for (const control of nav.querySelectorAll('[data-nav-destination]')) {
      if (control.dataset.navDestination === current) {
        control.setAttribute('aria-current', control.tagName === 'A' ? 'page' : 'true');
      } else {
        control.removeAttribute('aria-current');
      }
    }
  }

  header.classList.add('nav-ready');
  updateCurrentDestination();
  window.addEventListener('hashchange', updateCurrentDestination);

  toggle.addEventListener('click', () => {
    if (header.classList.contains('nav-open')) {
      closeMenu();
    } else {
      header.classList.add('nav-open');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });

  for (const group of groups) {
    group.addEventListener('toggle', () => {
      if (group.open) closeGroups(group);
    });
  }

  nav.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    closeMenu();

    if (link.hash && link.origin === location.origin && link.pathname === location.pathname) {
      const target = document.getElementById(link.hash.slice(1));
      if (target) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    }
  });

  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const group = groups.find(item => item.open);
    if (group) {
      group.open = false;
      group.querySelector('summary').focus();
    } else if (header.classList.contains('nav-open')) {
      closeMenu();
      toggle.focus();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // Close a disclosure when keyboard or pointer navigation moves elsewhere.
  function dismissOutside(target) {
    if (!header.contains(target)) {
      closeMenu();
    } else {
      closeGroups(groups.find(group => group.contains(target)));
    }
  }

  document.addEventListener('click', event => dismissOutside(event.target));
  document.addEventListener('focusin', event => dismissOutside(event.target));

  narrow.addEventListener('change', () => {
    const trigger = document.activeElement?.closest('details.nav-group')?.querySelector('summary');
    const focusInNav = nav.contains(document.activeElement);
    const focusOnToggle = document.activeElement === toggle;
    closeMenu();
    if (narrow.matches && focusInNav && toggle.getClientRects().length) toggle.focus();
    else if (!narrow.matches && focusOnToggle) nav.querySelector('a[href]')?.focus();
    else if (trigger) trigger.focus();
  });
}
