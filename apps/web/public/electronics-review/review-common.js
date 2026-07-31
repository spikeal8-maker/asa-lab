export const PAGES = [
  ['reference-vs-production.html', 'Эталон ↔ production'],
  ['physical-scale.html', 'Физический масштаб'],
  ['led-rgb-state-lab.html', 'LED / RGB'],
  ['display-and-motion-state-lab.html', 'Display / motion'],
  ['breadboard-fit-connectivity.html', 'Breadboard fit'],
];

export async function loadFoundation() {
  const [manifest, references, states, connectivity] = await Promise.all([
    fetch('/assets/electronics/production/manifest.json').then((response) => response.json()),
    fetch('/assets/electronics/reference/manifest.json').then((response) => response.json()),
    fetch('/assets/electronics/production/state-contracts.json').then((response) =>
      response.json(),
    ),
    fetch('/assets/electronics/production/breadboard-connectivity.json').then((response) =>
      response.json(),
    ),
  ]);
  return { manifest, references, states, connectivity };
}

export function mountShell(active, title, subtitle) {
  document.title = `${title} · ASA Lab Electronics`;
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<header class="topbar">
      <a class="brand" href="/electronics-review/reference-vs-production.html">
        <span class="brand-mark">E</span>
        <span><strong>Electronics Asset Foundation</strong><small>Owner visual checkpoint</small></span>
      </a>
      <nav class="nav">${PAGES.map(([file, label]) => `<a class="${file === active ? 'active' : ''}" href="/electronics-review/${file}">${label}</a>`).join('')}</nav>
      <div class="checkpoint"><span>32 candidates · 0 accepted</span><small>solver и editor integration выключены</small></div>
    </header>
    <main><section class="hero"><div><div class="eyebrow">production_vector_and_animation_rework</div><h1>${title}</h1><p>${subtitle}</p></div><div class="stats" id="page-stats"></div></section></main>`,
  );
  return document.querySelector('main');
}

export function setStats(values) {
  document.querySelector('#page-stats').innerHTML = values
    .map(
      ([value, label]) =>
        `<div class="stat"><strong>${value}</strong><small>${label}</small></div>`,
    )
    .join('');
}

export function assetPath(path) {
  return path || '';
}

export async function inlineSvg(path, host) {
  const text = await fetch(path).then((response) => response.text());
  host.innerHTML = text;
  return host.querySelector('svg');
}

export function reportReady(pageId) {
  document.documentElement.dataset.reviewPage = pageId;
  document.documentElement.dataset.reviewReady = 'true';
}
