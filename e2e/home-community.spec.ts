import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';

test('knowledge opens published material; private and revoked courses cannot leak through a direct URL', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const pool = e2eAdminPool();
  const author = await seedTeacher(pool, 'public-course-author');
  const reader = await seedTeacher(pool, 'public-course-reader');
  const authorContext = await browser.newContext();
  const readerContext = await browser.newContext();
  try {
    const a = await authorContext.newPage(),
      b = await readerContext.newPage();
    await loginWithOrganization(a, author);
    await loginWithOrganization(b, reader);
    const origin = new URL(a.url()).origin;
    const created = await a.request.post('/api/courses/demo', { headers: { origin } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    expect((await b.request.get(`/api/gallery/knowledge/${id}`)).status()).toBe(404);
    const show = await a.request.put(`/api/sharing/course/${id}/visibility`, {
      headers: { origin },
      data: { visibility: 'public' },
    });
    expect(show.ok()).toBe(true);
    // A normal account, without the educator capability, can read public knowledge.
    await pool.query(
      `DELETE FROM capability_grants WHERE capability = 'educator' AND account_id IN (SELECT account_id FROM legacy_user_account_links WHERE tenant_id = $1 AND user_id = $2)`,
      [reader.tenantId, reader.teacherId],
    );
    await b.goto('/#/home');
    await b.reload();
    await b.getByRole('heading', { name: 'Новое в знаниях' }).scrollIntoViewIfNeeded();
    await b.locator(`.home-public-card a[href="/#/knowledge/${id}"]`).click();
    await expect(b).toHaveURL(new RegExp(`#/knowledge/${id}$`));
    await expect(b.locator('.knowledge-lesson')).toHaveCount(12);
    await b.locator('.knowledge-lesson > summary').first().click();
    await expect(b.locator('.knowledge-lesson[open] .lesson-blocks')).toBeVisible();
    expect(await b.locator('video[autoplay], audio[autoplay]').count()).toBe(0);
    await b.reload();
    await expect(b.locator('.knowledge-lesson')).toHaveCount(12);
    const hide = await a.request.put(`/api/sharing/course/${id}/visibility`, {
      headers: { origin },
      data: { visibility: 'private' },
    });
    expect(hide.ok()).toBe(true);
    await b.reload();
    await expect(b.getByRole('alert')).toContainText('недоступен');
    expect(await b.locator('.knowledge-lesson').count()).toBe(0);
    const list = await b.request.get('/api/gallery/knowledge?limit=10');
    expect((await list.json()).items.some((item: { id: string }) => item.id === id)).toBe(false);
  } finally {
    await authorContext.close();
    await readerContext.close();
    await pool.end();
  }
});

test('header keeps identity, visible event source and gentle reduced-motion-safe attention on phones', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pool = e2eAdminPool();
  const teacher = await seedTeacher(pool, 'home-attention');
  await pool.end();
  // UI fixture only: these are server counter responses, not seeded production events.
  await page.route('**/api/classrooms/awaiting-review', (route) =>
    route.fulfill({ json: { total: 2 } }),
  );
  await loginWithOrganization(page, teacher);
  mkdirSync('e2e/artifacts/owner-preview/home-release', { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `e2e/artifacts/owner-preview/home-release/inspect-${width}.png`,
      fullPage: true,
    });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      console.log(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll('body *'))
            .filter(
              (el) =>
                !el.closest('.home-shelf-track') &&
                el.getBoundingClientRect().right > innerWidth + 1,
            )
            .map((el) => ({
              tag: el.tagName,
              className: el.className,
              right: el.getBoundingClientRect().right,
            }))
            .slice(0, 15),
        ),
      );
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const header = page.locator('.portal-header');
    await expect(header.locator('.portal-user-avatar img')).toBeVisible();
    await expect(header.locator('.asa-brand-mark')).toBeVisible();
    await expect(header.getByRole('link', { name: 'Проекты', exact: true })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Знания', exact: true })).toBeVisible();
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(58);
    const controls = await header.locator(':scope > *:visible').evaluateAll((elements) =>
      elements.map((element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
    for (let i = 1; i < controls.length; i++)
      expect(controls[i].left).toBeGreaterThanOrEqual(controls[i - 1].right - 1);
    const create = page.locator('.portal-quick-create:visible > summary');
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await create.evaluate((el) => {
        const style = getComputedStyle(el, '::before');
        return (
          parseFloat(style.height) +
          parseFloat(style.borderTopWidth) +
          parseFloat(style.borderBottomWidth)
        );
      }),
    ).toBe(32);
    if (width <= 820) {
      const dot = page.locator('.portal-menu-toggle .portal-attention-dot');
      await expect(dot).toBeVisible();
      expect((await dot.boundingBox())!.width).toBeGreaterThan(13);
      expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe(
        'portal-attention-pulse',
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
      await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
      await expect(page.getByRole('dialog').getByText('На проверку: 2')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dot).toBeVisible();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    await page.screenshot({
      path: `e2e/artifacts/owner-preview/home-release/home-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Помощь и сообщество' }).click();
  await expect(page.getByRole('link', { name: 'ВКонтакте' })).toHaveAttribute(
    'href',
    'https://vk.ru/asalabru',
  );
  await expect(page.getByRole('link', { name: 'Бот ASA Lab в MAX' })).toHaveAttribute(
    'href',
    'https://max.ru/id231408577954_3_bot',
  );
  expect(errors).toEqual([]);
});
