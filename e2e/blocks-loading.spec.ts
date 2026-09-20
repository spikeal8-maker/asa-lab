import { expect, test } from '@playwright/test';
import fs from 'node:fs';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let parentOrigin: string;
let projectId: string;

const evidenceDir = 'reports/blocks/loading-evidence';

test.beforeAll(async () => {
  ({ createProtocolFixture } = await import('../tools/blocks/browser/fixture.mjs'));
  ({ parentOrigin, projectId } = await import('../tools/blocks/browser/protocol.mjs'));
  fs.mkdirSync(evidenceDir, { recursive: true });
});

async function holdRuntimeSession(context: import('@playwright/test').BrowserContext) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route(
    `${parentOrigin}/api/projects/${projectId}/blocks/runtime-session`,
    async (route) => {
      await gate;
      await route.continue();
    },
  );
  return release;
}

async function assertLoadingSurface(
  page: import('@playwright/test').Page,
  expectedTransitionDuration = '0.2s, 0s',
) {
  const overlay = page.locator('[data-asa-blocks-loading-overlay]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-state', 'loading');
  await expect(overlay.getByText('Загружаем рабочую среду…', { exact: true })).toBeVisible();
  await expect(overlay.getByText('Открываем ваш проект', { exact: true })).toBeVisible();
  await expect(overlay.locator('.blocks-editor-loading-mark')).toHaveAttribute(
    'src',
    '/asa-lab-mark.svg',
  );
  await expect(overlay.locator('.blocks-editor-loading-spinner')).toBeVisible();
  await expect(page.locator('.blocks-editor-connection-status')).toHaveCount(0);
  await expect(overlay).not.toContainText('Scratch');
  await expect(overlay).not.toContainText('init-accepted');
  await expect(overlay).not.toContainText('token-updated');
  await expect(overlay).not.toContainText('project-dirty');

  const coverage = await overlay.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const content = node.querySelector('.blocks-editor-loading-content')?.getBoundingClientRect();
    const style = getComputedStyle(node);
    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      pointerEvents: style.pointerEvents,
      background: style.backgroundColor,
      transitionDuration: style.transitionDuration,
      centerCovered: node === center || node.contains(center),
      centerOffsetX: content ? Math.round(content.left + content.width / 2 - innerWidth / 2) : 999,
      centerOffsetY: content ? Math.round(content.top + content.height / 2 - innerHeight / 2) : 999,
    };
  });
  expect(coverage).toMatchObject({
    left: 0,
    top: 0,
    width: coverage.viewportWidth,
    height: coverage.viewportHeight,
    pointerEvents: 'auto',
    background: 'rgb(247, 250, 252)',
    transitionDuration: expectedTransitionDuration,
    centerCovered: true,
  });
  expect(Math.abs(coverage.centerOffsetX)).toBeLessThanOrEqual(1);
  expect(Math.abs(coverage.centerOffsetY)).toBeLessThanOrEqual(1);
}

test('delayed startup shows one full-screen ASA loader until canonical editor-ready', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const release = await holdRuntimeSession(fixture.context);
  const page = await fixture.context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    await assertLoadingSurface(page);

    const home = page.locator('[data-asa-blocks-home-overlay]');
    const homeCovered = await home.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top !== node;
    });
    expect(homeCovered).toBe(true);

    await page.screenshot({ path: `${evidenceDir}/loading-1440x960.png`, fullPage: true });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await assertLoadingSurface(page);
    await page.screenshot({ path: `${evidenceDir}/loading-1920x1080.png`, fullPage: true });

    release();
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );

    const overlay = page.locator('[data-asa-blocks-loading-overlay]');
    await expect(overlay).toHaveAttribute('data-state', 'ready');
    await expect
      .poll(() =>
        overlay.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            opacity: style.opacity,
            visibility: style.visibility,
            pointerEvents: style.pointerEvents,
          };
        }),
      )
      .toEqual({ opacity: '0', visibility: 'hidden', pointerEvents: 'none' });

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: `${evidenceDir}/ready-1440x960.png`, fullPage: true });
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    release();
    await fixture.close();
  }
});

test('runtime startup failure uses the central ASA error screen and Back returns to projects', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  await fixture.context.route(
    `${parentOrigin}/api/projects/${projectId}/blocks/runtime-session`,
    async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  const page = await fixture.context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });

    const overlay = page.locator('[data-asa-blocks-loading-overlay]');
    await expect(overlay).toHaveAttribute('data-state', 'error');
    await expect(overlay.getByText('Не удалось открыть среду', { exact: true })).toBeVisible();
    await expect(
      overlay.getByText('Проверьте подключение и попробуйте снова.', { exact: true }),
    ).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'К проектам', exact: true })).toBeVisible();
    await expect(overlay.locator('.blocks-editor-loading-mark')).toHaveAttribute(
      'src',
      '/asa-lab-mark.svg',
    );
    await expect(page.locator('.blocks-editor-connection-status')).toHaveCount(0);
    await expect(overlay).not.toContainText('Scratch');

    await page.screenshot({ path: `${evidenceDir}/error-1440x960.png`, fullPage: true });
    await overlay.getByRole('button', { name: 'К проектам', exact: true }).click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/projects`);
  } finally {
    await fixture.close();
  }
});

test('Retry returns to loading and second runtime boot reaches editor-ready', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  let requests = 0;
  await fixture.context.route(
    `${parentOrigin}/api/projects/${projectId}/blocks/runtime-session`,
    async (route) => {
      requests += 1;
      if (requests === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.continue();
    },
  );
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const overlay = page.locator('[data-asa-blocks-loading-overlay]');
    await expect(overlay).toHaveAttribute('data-state', 'error');

    await overlay.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(overlay).toHaveAttribute('data-state', 'loading');
    await expect(overlay.getByText('Загружаем рабочую среду…', { exact: true })).toBeVisible();

    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(overlay).toHaveAttribute('data-state', 'ready');
    expect(requests).toBe(2);
    expect(fixture.pageErrors.filter((error) => !error.includes('503'))).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('prefers-reduced-motion disables continuous loader rotation', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const release = await holdRuntimeSession(fixture.context);
  const page = await fixture.context.newPage();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    await assertLoadingSurface(page, '0s');

    const motion = await page.locator('.blocks-editor-loading-spinner').evaluate((node) => {
      const style = getComputedStyle(node);
      return { animationName: style.animationName, animationDuration: style.animationDuration };
    });
    expect(motion.animationName).toBe('none');
  } finally {
    release();
    await fixture.close();
  }
});
