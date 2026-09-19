(() => {
  const pages = [...document.querySelectorAll('[data-page]')];
  const pageLinks = [...document.querySelectorAll('[data-page-link]')];
  const navItems = [...document.querySelectorAll('.nav-item[data-page-link]')];

  const setPage = (nextPage, updateHash = true) => {
    const pageName = nextPage === 'knowledge' ? 'knowledge' : 'projects';

    pages.forEach((page) => {
      page.classList.toggle('active', page.dataset.page === pageName);
    });

    navItems.forEach((item) => {
      item.classList.toggle('active', item.dataset.pageLink === pageName);
    });

    if (updateHash) {
      history.replaceState(null, '', `#${pageName}`);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  pageLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setPage(link.dataset.pageLink);
    });
  });

  const initialPage = window.location.hash.replace('#', '');
  if (initialPage === 'knowledge' || initialPage === 'projects') {
    setPage(initialPage, false);
  }

  document.querySelectorAll('.topic-strip').forEach((strip) => {
    strip.addEventListener('click', (event) => {
      const target = event.target.closest('.topic-chip');
      if (!target) return;
      strip.querySelectorAll('.topic-chip').forEach((chip) => chip.classList.remove('active'));
      target.classList.add('active');
    });
  });

  document.querySelectorAll('.sort-tabs').forEach((tabs) => {
    tabs.addEventListener('click', (event) => {
      const target = event.target.closest('.sort-tab');
      if (!target) return;
      tabs.querySelectorAll('.sort-tab').forEach((tab) => tab.classList.remove('active'));
      target.classList.add('active');
    });
  });

  const modal = document.querySelector('#video-modal');
  const modalTitle = document.querySelector('#video-modal-title');

  const closeVideo = () => {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  };

  document.querySelectorAll('[data-video-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-video-title]');
      if (card && modalTitle) modalTitle.textContent = card.dataset.videoTitle || 'Видео AsaLab';
      modal?.classList.add('open');
      modal?.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    });
  });

  document.querySelectorAll('[data-video-close]').forEach((button) => {
    button.addEventListener('click', closeVideo);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeVideo();

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const activePage = document.querySelector('.page.active');
      activePage?.querySelector('.big-search input')?.focus();
    }
  });
})();
