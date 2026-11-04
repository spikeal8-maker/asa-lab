import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

// Gallery's social wall and mutable-work reader are superseded. These route
// regressions preserve the privacy and Project Core boundaries during cutover;
// the new real publication lifecycle lives in public-projects.spec.ts.
test('legacy Gallery entry opens the canonical anonymous Public Projects catalogue', async ({
  page,
}) => {
  await page.goto('/#/gallery');
  await expect(page).toHaveURL(/#\/explore$/);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Идеи, схемы и программы сообщества ASA Lab',
      exact: true,
    }),
  ).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Поиск по названию и описанию', exact: true });
  await expect(search).toBeVisible();
  await expect(page.getByTestId('gallery')).toHaveCount(0);
  const query = `gallery-cutover-${randomUUID()}`;
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname === '/api/public-projects' && url.searchParams.get('q') === query;
  });
  await search.fill(query);
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect((await result.json()).items).toEqual([]);
  await expect.poll(() => new URL(page.url()).hash).toBe(`#/explore?q=${query}`);
});

test('legacy detail never resolves an original Project, including its owner and an anonymous visitor', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const admin = e2eAdminPool();
  const guestContext = await browser.newContext();
  try {
    const author = await seedTeacher(admin, 'gallery-cutover');
    await loginWithOrganization(page, author);
    const title = `Частный оригинал для старой ссылки ${randomUUID().slice(0, 8)}`;
    const response = await page.request.post('/api/projects', {
      headers: {
        origin: new URL(page.url()).origin,
        'idempotency-key': `gallery-cutover-${randomUUID()}`,
      },
      data: { scope: 'personal', module: 'electronics', title },
    });
    expect(response.status()).toBe(201);
    const projectId = (await response.json()).project.id as string;
    const guest = await guestContext.newPage();
    for (const visitor of [page, guest]) {
      await visitor.goto(`/#/gallery/${projectId}`);
      await expect(visitor.getByRole('heading', { name: 'Публикация недоступна' })).toBeVisible();
      await expect(visitor.getByText(title, { exact: true })).toHaveCount(0);
      await expect(visitor.getByTestId('public-project-detail')).toHaveCount(0);
      await expect(visitor.getByTestId('electronics-canvas')).toHaveCount(0);
    }
    const original = await page.request.get(`/api/projects/${projectId}`);
    expect(original.status()).toBe(200);
    expect((await original.json()).project.title).toBe(title);
    expect((await guest.request.get(`/api/projects/${projectId}`)).status()).toBe(401);
    await guest.getByRole('button', { name: 'Открыть каталог' }).click();
    await expect(guest).toHaveURL(/#\/explore$/);
    mkdirSync('e2e/artifacts/public-projects', { recursive: true });
    await guest.screenshot({
      path: 'e2e/artifacts/public-projects/legacy-gallery-cutover.png',
      fullPage: true,
    });
  } finally {
    await guestContext.close();
    await admin.end();
  }
});
