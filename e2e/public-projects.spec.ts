import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';

// All identities, projects, metadata, images and refusals go through the built
// API backed by a real isolated PostgreSQL. There are no route.fulfill mocks.
// Raster fixtures deliberately say V1/V2: their byte identity, not an editor's
// rendering algorithm, is the invariant this publication boundary must preserve.
const EVIDENCE = 'e2e/artifacts/public-projects';
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440] as const;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
test('preview cards have no vignette or added strips and electronics uses a white background', async ({
  page,
}) => {
  await page.goto('/#/explore');
  await register(page, 'Автор проверки превью');
  await ok(
    await page.request.patch('/api/account/avatar', {
      headers: { origin: origin(page) },
      data: {
        avatarDataUrl:
          'data:image/webp;base64,' +
          readFileSync('apps/web/public/assets/avatars/default/avatar-01.webp').toString('base64'),
      },
    }),
  );
  const title =
    'Длинное название электронной схемы для проверки сокращения рядом с лайками ' +
    randomUUID().slice(0, 8);
  const image = await raster(page, 'Preview');
  const projectId = await createProject(page, title, image);
  try {
    const published = await publish(page, projectId);
    const data = await publication(page, published.publicationId);
    const original = await imageHash(page, data.preview.url);
    await page.goto('/#/explore');
    await page.getByRole('searchbox').fill(title);
    await page.getByRole('button', { name: 'Найти', exact: true }).click();
    const card = page.getByTestId('public-project-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Идеи, схемы и программы сообщества ASA Lab',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('.public-projects-results')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Сортировка проектов' }).selectOption('likes');
    await expect(page).toHaveURL(/sort=likes/);
    await expect(card).toBeVisible();
    await expect(page.getByRole('button', { name: 'Шахматы', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Шашки', exact: true })).toHaveCount(0);
    await expect(card.locator('.public-project-author')).toHaveText('Автор проверки превью');
    await expect
      .poll(() =>
        card
          .locator('.public-project-avatar img')
          .evaluate((image: HTMLImageElement) => Boolean(image.complete && image.naturalWidth)),
      )
      .toBe(true);
    for (const width of [3840, 2560, 1920, 1440, 1024, 1023, 601, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
      const columns = await page
        .getByTestId('public-project-grid')
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(4);
      const authorStyle = await card.locator('.public-project-author').evaluate((element) => ({
        wrapping: getComputedStyle(element).whiteSpace,
        overflow: getComputedStyle(element).textOverflow,
      }));
      expect(authorStyle).toEqual({ wrapping: 'nowrap', overflow: 'ellipsis' });
      await card.hover();
      const date = card.locator('.public-project-card-date');
      expect(await date.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
      expect(await date.textContent()).not.toContain('Опубликовано');
      const authorBox = await card.locator('.public-project-author').boundingBox();
      const dateBox = await date.boundingBox();
      expect(Math.abs(dateBox!.x - authorBox!.x)).toBeLessThan(1);
      expect(dateBox!.y).toBeGreaterThanOrEqual(authorBox!.y + authorBox!.height - 1);
      await page.mouse.move(0, 0);
      expect(await date.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
      const chipsBox = await page.getByRole('group', { name: 'Среда проекта' }).boundingBox();
      const sortBox = await page
        .getByRole('combobox', { name: 'Сортировка проектов' })
        .boundingBox();
      expect(
        Math.abs(chipsBox!.y + chipsBox!.height / 2 - sortBox!.y - sortBox!.height / 2),
      ).toBeLessThan(2);
      expect(chipsBox!.x + chipsBox!.width).toBeLessThanOrEqual(sortBox!.x);
      const toolsBox = await page.locator('.public-projects-tools').boundingBox();
      expect(sortBox!.width).toBeLessThanOrEqual(148);
      expect(Math.abs(sortBox!.x + sortBox!.width - toolsBox!.x - toolsBox!.width)).toBeLessThan(1);
      const bounds = await card.boundingBox();
      expect(Math.abs(bounds!.width / bounds!.height - 4 / 3)).toBeLessThan(0.025);
      const catalogBox = await page.getByTestId('public-project-catalog').boundingBox();
      if (width >= 1920) {
        expect(catalogBox!.width).toBeGreaterThan(width - 350);
        expect(bounds!.width).toBeGreaterThan((width - 420) / 4);
      }
      const titleBox = await card.getByTestId('public-project-card-title').boundingBox();
      const countsBox = await card.locator('.public-project-card-meta').boundingBox();
      expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(countsBox!.x);
      expect(
        Math.abs(titleBox!.y + titleBox!.height / 2 - countsBox!.y - countsBox!.height / 2),
      ).toBeLessThan(2);
      const titleStyle = await card
        .getByTestId('public-project-card-title')
        .evaluate((element) => ({
          overflow: getComputedStyle(element).textOverflow,
          wrapping: getComputedStyle(element).whiteSpace,
          truncated: element.scrollWidth > element.clientWidth,
        }));
      expect(titleStyle.overflow).toBe('ellipsis');
      expect(titleStyle.wrapping).toBe('nowrap');
      if (width <= 390) expect(titleStyle.truncated).toBe(true);
      const labels = await card
        .locator(
          '.public-project-card-body h2, .public-project-card-meta, .public-project-author, .publication-module',
        )
        .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).textShadow));
      expect(labels.every((shadow) => shadow !== 'none' && shadow.includes('255, 255, 255'))).toBe(
        true,
      );
      const styles = await card.evaluate((el) => ({
        vignette: getComputedStyle(el.querySelector('.public-project-card-cover')!, '::after')
          .content,
        background: getComputedStyle(el.querySelector('.publication-preview')!).backgroundColor,
        strip: getComputedStyle(el.querySelector('.public-project-card-body')!).backgroundColor,
        fit: getComputedStyle(el.querySelector('.publication-preview img')!).objectFit,
        filter: getComputedStyle(el.querySelector('.publication-preview img')!).filter,
      }));
      expect(styles).toEqual({
        vignette: 'none',
        background: 'rgb(255, 255, 255)',
        strip: 'rgba(0, 0, 0, 0)',
        fit: 'contain',
        filter: 'none',
      });
      await card.screenshot({ path: `${EVIDENCE}/no-vignette-${width}.png` });
    }
    expect(await imageHash(page, data.preview.url)).toBe(original);
    await page.goto(`/#/public-projects/${published.publicationId}`);
    await expect(page.locator('.public-project-detail-author')).toHaveText('Автор проверки превью');
    await expect
      .poll(() =>
        page
          .locator('.public-project-detail-avatar img')
          .evaluate((image: HTMLImageElement) => Boolean(image.complete && image.naturalWidth)),
      )
      .toBe(true);
  } finally {
    await page.request.delete(`/api/projects/${projectId}/publication`, {
      headers: { origin: origin(page) },
    });
  }
});
let admin: pg.Pool;

interface Publication {
  publicationId: string;
  revisionId: string;
  revisionNo: number;
  versionNo: number;
  title: string;
  description: string | null;
  tags: string[];
  license: string;
  authorLabel: string;
  moduleKey: string;
  preview: { url: string; contentType: string; width: number; height: number };
}

test.beforeAll(() => {
  admin = e2eAdminPool();
  mkdirSync(EVIDENCE, { recursive: true });
});
test.afterAll(async () => {
  await admin?.end();
});

function origin(page: Page): string {
  return new URL(page.url()).origin;
}

async function ok(response: APIResponse, status = 200): Promise<void> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
}

async function register(page: Page, label: string): Promise<{ accountId: string; email: string }> {
  await page.goto('/#/explore');
  const id = randomUUID().replaceAll('-', '');
  const email = `publication-${id}@isolated.test`;
  const response = await page.request.post('/api/auth/register', {
    headers: { origin: origin(page) },
    data: {
      email,
      username: `pub_${id.slice(0, 24)}`,
      displayName: label,
      password: `Publication-${id}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  await ok(response, 201);
  const session = await response.json();
  expect(session.authenticated).toBe(true);
  await page.goto('/#/projects');
  await page.reload();
  await expect(page.getByRole('banner').getByLabel(/^Меню аккаунта /)).toBeVisible();
  return { accountId: session.user.id as string, email };
}

async function raster(page: Page, version: string, color = '#2464bd'): Promise<string> {
  return page.evaluate(
    ({ version, color }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('fixture canvas unavailable');
      context.fillStyle = '#edf3f8';
      context.fillRect(0, 0, 400, 240);
      context.fillStyle = color;
      context.fillRect(96, 56, 208, 104);
      context.fillStyle = '#ffffff';
      context.font = 'bold 36px sans-serif';
      context.fillText(version, 162, 123);
      context.fillStyle = '#172b4d';
      context.font = '18px sans-serif';
      context.fillText('Тестовая работа ASA Lab', 84, 203);
      return canvas.toDataURL('image/png');
    },
    { version, color },
  );
}

async function createProject(
  page: Page,
  title: string,
  image: string,
  module = 'electronics',
): Promise<string> {
  const created = await page.request.post('/api/projects', {
    headers: { origin: origin(page), 'idempotency-key': `publication-${randomUUID()}` },
    data: { scope: 'personal', module, title },
  });
  await ok(created, 201);
  const { project } = await created.json();
  expect(project.id).toMatch(UUID);
  await ok(
    await page.request.put(`/api/projects/${project.id}/snapshot`, {
      headers: { origin: origin(page) },
      data: { imageDataUrl: image, sourceRevision: 1 },
    }),
  );
  return project.id as string;
}

async function publish(page: Page, projectId: string, metadata: Record<string, unknown> = {}) {
  const response = await page.request.post(`/api/projects/${projectId}/publication`, {
    headers: { origin: origin(page) },
    data: metadata,
  });
  await ok(response);
  const state = (await response.json()).publication;
  expect(state.state).toBe('public');
  expect(state.publicationId).toMatch(UUID);
  return state as {
    publicationId: string;
    revisionId: string;
    revisionNo: number;
    versionNo: number;
  };
}

async function publication(page: Page, id: string): Promise<Publication> {
  const response = await page.request.get(`/api/public-projects/${id}`);
  await ok(response);
  expect(response.headers()['cache-control']).toContain('no-store');
  return (await response.json()).publication as Publication;
}

async function imageHash(page: Page, url: string): Promise<string> {
  const response = await page.request.get(url);
  await ok(response);
  expect(response.headers()['content-type']).toMatch(/^image\/(png|webp)/);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  return createHash('sha256')
    .update(await response.body())
    .digest('hex');
}

async function openPublicationDialog(page: Page, title: string) {
  await page.goto('/#/projects');
  await page.reload();
  const card = page.getByTestId('project-card').filter({ hasText: title });
  await expect(card).toHaveCount(1);
  await card.hover();
  await card.locator('details > summary').click();
  await card.getByRole('button', { name: 'Публикация', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Публикация проекта' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectPublicImage(page: Page): Promise<void> {
  const image = page.getByTestId('public-project-preview');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const picture = element as HTMLImageElement;
        return picture.complete && picture.naturalWidth > 0 && picture.naturalHeight > 0;
      }),
    )
    .toBe(true);
}

async function expectEmptyElectronicsScene(page: Page): Promise<void> {
  // These metadata/version fixtures intentionally contain the editor's empty
  // initial document. Raster integrity remains asserted separately through HTTP.
  await expect(page.getByTestId('public-electronics-scene')).toBeVisible();
  await expect(page.getByTestId('public-electronics-component')).toHaveCount(0);
  await expect(page.getByTestId('public-electronics-wire')).toHaveCount(0);
  await expect(page.getByTestId('public-project-preview')).toHaveCount(0);
}

async function expectNoOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (sizes.document > sizes.viewport || sizes.body > sizes.viewport) {
    const geometry = await page.evaluate(() => {
      const describe = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const parent = element.parentElement;
        const parentRect = parent?.getBoundingClientRect();
        return {
          tag: element.tagName,
          id: element.id,
          className: element.getAttribute('class'),
          testId: element.getAttribute('data-testid'),
          text: element.textContent?.trim().slice(0, 160),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
          },
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          style: {
            display: style.display,
            visibility: style.visibility,
            position: style.position,
            boxSizing: style.boxSizing,
            width: style.width,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            gridTemplateColumns: style.gridTemplateColumns,
            gridAutoColumns: style.gridAutoColumns,
            columnGap: style.columnGap,
            flex: style.flex,
            flexWrap: style.flexWrap,
            whiteSpace: style.whiteSpace,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
          },
          parent: parent
            ? {
                tag: parent.tagName,
                id: parent.id,
                className: parent.getAttribute('class'),
                x: parentRect?.x,
                width: parentRect?.width,
                right: parentRect?.right,
                clientWidth: parent.clientWidth,
                scrollWidth: parent.scrollWidth,
              }
            : null,
        };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        overflowingElements: [...document.querySelectorAll('body *')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.right > innerWidth || rect.x < 0);
          })
          .map(describe),
        layoutContainers: [
          ...document.querySelectorAll(
            '.portal-header, .portal-content, .modal-backdrop, .publication-properties, .project-card-grid, .project-card-body, .project-card-footer',
          ),
        ].map(describe),
      };
    });
    await test.info().attach(`overflow-geometry-${sizes.viewport}.json`, {
      body: JSON.stringify({ sizes, ...geometry }, null, 2),
      contentType: 'application/json',
    });
  }
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport);
}

async function captureDetailViewport(page: Page, name: string): Promise<void> {
  // Override smooth scrolling for this operation, then prove the captured origin.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const heading = await page.getByTestId('public-project-title').boundingBox();
  const banner = await page.getByRole('banner').boundingBox();
  expect(heading).not.toBeNull();
  expect(banner).not.toBeNull();
  expect(heading!.y).toBeGreaterThanOrEqual(banner!.y + banner!.height);
  const back = await page.getByRole('link', { name: '← Проекты', exact: true }).boundingBox();
  expect(back).not.toBeNull();
  expect(back!.y).toBeGreaterThanOrEqual(banner!.y + banner!.height);
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
}

function assertPublicDto(value: unknown, privateValues: string[]): void {
  const serialized = JSON.stringify(value);
  for (const secret of privateValues) expect(serialized).not.toContain(secret);
  const forbidden = new Set([
    'projectId',
    'projectVersionId',
    'document',
    'documentJson',
    'document_json',
    'tenantId',
    'workspaceId',
    'classroomId',
    'schoolId',
    'accountId',
    'principalId',
    'ownerPrincipalId',
    'email',
    'login',
    'shareToken',
    'session',
  ]);
  function inspect(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      expect(forbidden.has(key), `private DTO field ${key}`).toBe(false);
      inspect(child);
    }
  }
  inspect(value);
}

test('real 3D editor creates the Project and its raster, then UI publication shows the same image anonymously', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page, 'Автор настоящей 3D модели');
  const createdResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/projects' &&
      response.request().method() === 'POST',
  );
  const create = page.locator('.portal-header .portal-quick-create:visible');
  await create.locator('> summary').click();
  await create.getByRole('button', { name: /^3D модель/ }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  const viewport = page.getByTestId('asa3d-viewport');
  await expect(viewport).toHaveAttribute('data-runtime-ready', 'true', { timeout: 30_000 });
  const title = `Модель из редактора ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Название проекта', { exact: true }).fill(title);
  const renamed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/projects/${projectId}` &&
      response.request().method() === 'PATCH',
  );
  await page.getByLabel('Название проекта', { exact: true }).press('Enter');
  expect((await renamed).status()).toBe(200);

  const capturedUploads: { revision: number; status: number }[] = [];
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === `/api/projects/${projectId}/snapshot` &&
      response.request().method() === 'PUT'
    ) {
      capturedUploads.push({
        revision: response.request().postDataJSON().sourceRevision,
        status: response.status(),
      });
    }
  });

  const savedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/projects/${projectId}/draft` &&
      response.request().method() === 'PUT' &&
      response.request().postDataJSON().document.nodes.length > 0,
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-selected-node-id', /box-/);
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  const sourceRevision = (await saved.json()).draft.revision as number;
  await page.screenshot({ path: `${EVIDENCE}/00-real-editor-source-desktop.png`, fullPage: true });

  // Exercise the editor's existing snapshot lifecycle trigger. This test never
  // generates or uploads the picture itself: the real editor must do both.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(
      () =>
        capturedUploads.some(
          (upload) => upload.revision === sourceRevision && upload.status === 200,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  const snapshot = await page.request.get(`/api/projects/${projectId}/snapshot`);
  await ok(snapshot);
  const snapshotBytes = await snapshot.body();
  expect(snapshotBytes.length).toBeGreaterThan(1000);
  const sourceHash = createHash('sha256').update(snapshotBytes).digest('hex');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const dialog = await openPublicationDialog(page, title);
  await dialog
    .getByLabel('Описание проекта')
    .fill('Параллелепипед создан в настоящем 3D редакторе. Превью сохранено самим редактором.');
  const publishedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/projects/${projectId}/publication` &&
      response.request().method() === 'POST',
  );
  await dialog.getByTestId('publication-publish').click();
  const published = await publishedResponse;
  expect(published.status()).toBe(200);
  const publicationId = (await published.json()).publication.publicationId as string;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto('/#/explore');
    await guest.getByRole('link', { name: `Открыть проект «${title}»` }).click();
    await expect(guest).toHaveURL(new RegExp(`#/public-projects/${publicationId}$`));
    await expect(guest.getByTestId('public-project-title')).toHaveText(title);
    await expectPublicImage(guest);
    const dto = await publication(guest, publicationId);
    expect(dto.moduleKey).toBe('three-d');
    expect(await imageHash(guest, dto.preview.url)).toBe(sourceHash);
    await guest.setViewportSize({ width: 1440, height: 900 });
    await expectNoOverflow(guest);
    await guest.screenshot({
      path: `${EVIDENCE}/00-real-editor-publication-desktop.png`,
      fullPage: true,
    });
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.reload();
    await expectPublicImage(guest);
    await expectNoOverflow(guest);
    await guest.screenshot({
      path: `${EVIDENCE}/00-real-editor-publication-mobile.png`,
      fullPage: true,
    });
    for (const width of [320, 390, 1440]) {
      await guest.setViewportSize({ width, height: 900 });
      await expectNoOverflow(guest);
      await expect(
        guest.getByRole('button', { name: 'Название целиком', exact: true }),
      ).toHaveCount(0);
      await captureDetailViewport(guest, `detail-normal-viewport-${width}`);
    }
  } finally {
    await guestContext.close();
  }
});

test('ordinary Account publishes in UI; anonymous V1 survives draft V2 until explicit update and revoke', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const owner = await register(page, 'Анна — автор тестовой работы');
  const titleV1 = `Публикация V1 ${randomUUID().slice(0, 8)}`;
  const titleV2 = `${titleV1} — новая рабочая версия`;
  const pngV1 = await raster(page, 'V1');
  const projectId = await createProject(page, titleV1, pngV1);
  const dialog = await openPublicationDialog(page, titleV1);
  await dialog.getByLabel('Описание проекта').fill('Первая неизменяемая опубликованная версия.');
  await dialog.getByLabel('Лицензия').selectOption('cc-by');
  const publishResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/projects/${projectId}/publication` &&
      response.request().method() === 'POST',
  );
  await dialog.getByTestId('publication-publish').click();
  expect((await publishResponse).status()).toBe(200);
  const state = await page.request
    .get(`/api/projects/${projectId}/publication`)
    .then((r) => r.json());
  const publicationId = state.publication.publicationId as string;
  expect(publicationId).toMatch(UUID);
  expect(publicationId).not.toBe(projectId);
  await page.screenshot({ path: `${EVIDENCE}/01-owner-published.png`, fullPage: true });

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  guest.on('pageerror', (error) => failures.push(error.message));
  try {
    await guest.goto('/#/explore');
    const card = guest.getByTestId('public-project-card').filter({ hasText: titleV1 });
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: `Открыть проект «${titleV1}»` }).click();
    await expect(guest).toHaveURL(new RegExp(`#/public-projects/${publicationId}$`));
    await expect(guest.getByTestId('public-project-title')).toHaveText(titleV1);
    await expect(guest.getByTestId('public-project-description')).toContainText(
      'Первая неизменяемая',
    );
    await expectEmptyElectronicsScene(guest);
    const v1 = await publication(guest, publicationId);
    assertPublicDto(v1, [projectId, owner.accountId, owner.email]);
    const v1Hash = await imageHash(guest, v1.preview.url);
    expect(v1Hash).toBe(
      createHash('sha256')
        .update(Buffer.from(pngV1.split(',')[1], 'base64'))
        .digest('hex'),
    );
    await guest.reload();
    await expect(guest.getByTestId('public-project-title')).toHaveText(titleV1);
    await expectEmptyElectronicsScene(guest);
    await guest.screenshot({ path: `${EVIDENCE}/02-anonymous-v1-desktop.png`, fullPage: true });

    // Save real Working Draft V2 and new raster, without any publication mutation.
    const opened = await page.request.get(`/api/projects/${projectId}`).then((r) => r.json());
    const changedDocument = structuredClone(opened.draft.document);
    changedDocument.viewport = { ...(changedDocument.viewport ?? {}), x: 87, y: 39, zoom: 1.2 };
    const save = await page.request.put(`/api/projects/${projectId}/draft`, {
      headers: { origin: origin(page) },
      data: {
        document: changedDocument,
        baseRevision: opened.draft.revision,
        mutationId: randomUUID(),
      },
    });
    await ok(save);
    const saved = await save.json();
    expect(saved.draft.revision).toBeGreaterThan(opened.draft.revision);
    const stalePublish = await page.request.post(`/api/projects/${projectId}/publication`, {
      headers: { origin: origin(page) },
      data: {},
    });
    await ok(stalePublish, 409);
    expect((await stalePublish.json()).error.code).toBe('preview_required');
    const pngV2 = await raster(page, 'V2', '#bd493c');
    await ok(
      await page.request.put(`/api/projects/${projectId}/snapshot`, {
        headers: { origin: origin(page) },
        data: { imageDataUrl: pngV2, sourceRevision: saved.draft.revision },
      }),
    );
    await ok(
      await page.request.put(`/api/projects/${projectId}/properties`, {
        headers: { origin: origin(page) },
        data: {
          title: titleV2,
          description: 'Изменённый рабочий документ V2.',
          tags: ['версия-два'],
          license: 'cc-by',
        },
      }),
    );
    const stillV1 = await publication(guest, publicationId);
    expect(stillV1.revisionId).toBe(v1.revisionId);
    expect(stillV1.versionNo).toBe(v1.versionNo);
    expect(stillV1.title).toBe(titleV1);
    expect(stillV1.description).toBe(v1.description);
    expect(await imageHash(guest, stillV1.preview.url)).toBe(v1Hash);
    await guest.reload();
    await expect(guest.getByTestId('public-project-title')).toHaveText(titleV1);
    await guest.screenshot({ path: `${EVIDENCE}/03-v1-after-private-v2.png`, fullPage: true });

    const updateDialog = await openPublicationDialog(page, titleV2);
    const updateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/projects/${projectId}/publication` &&
        response.request().method() === 'POST',
    );
    await expect(updateDialog.getByTestId('publication-publish')).toHaveText('Обновить публикацию');
    await updateDialog.getByTestId('publication-publish').click();
    expect((await updateResponse).status()).toBe(200);
    const v2 = await publication(guest, publicationId);
    expect(v2.revisionNo).toBe(v1.revisionNo + 1);
    expect(v2.versionNo).toBeGreaterThan(v1.versionNo);
    expect(v2.title).toBe(titleV2);
    expect(await imageHash(guest, v2.preview.url)).not.toBe(v1Hash);
    expect(await imageHash(guest, v2.preview.url)).toBe(
      createHash('sha256')
        .update(Buffer.from(pngV2.split(',')[1], 'base64'))
        .digest('hex'),
    );
    await ok(await guest.request.get(v1.preview.url), 404);
    await guest.reload();
    await expect(guest.getByTestId('public-project-title')).toHaveText(titleV2);
    await expectEmptyElectronicsScene(guest);
    await guest.setViewportSize({ width: 390, height: 844 });
    await expectNoOverflow(guest);
    await guest.screenshot({ path: `${EVIDENCE}/04-explicit-v2-mobile.png`, fullPage: true });

    // The same exact request is an idempotent retry, not another revision.
    const repeated = await publish(page, projectId);
    expect(repeated.revisionId).toBe(v2.revisionId);
    expect(repeated.versionNo).toBe(v2.versionNo);
    const revokeDialog = await openPublicationDialog(page, titleV2);
    await revokeDialog.getByTestId('publication-revoke').click();
    const revokeResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/projects/${projectId}/publication` &&
        response.request().method() === 'DELETE',
    );
    await revokeDialog.getByTestId('publication-revoke-confirm').click();
    expect((await revokeResponse).status()).toBe(200);
    await ok(await guest.request.get(`/api/public-projects/${publicationId}`), 404);
    await ok(await guest.request.get(v2.preview.url), 404);
    await ok(await guest.request.get(`/api/public-projects/${publicationId}/image`), 404);
    const catalogue = await guest.request
      .get('/api/public-projects?limit=48')
      .then((r) => r.json());
    expect(catalogue.items.some((item: Publication) => item.publicationId === publicationId)).toBe(
      false,
    );
    await guest.reload();
    await expect(guest.getByTestId('public-project-detail')).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: /недоступ/i })).toBeVisible();
    await guest.screenshot({ path: `${EVIDENCE}/05-revoked-mobile.png`, fullPage: true });
    const original = await page.request.get(`/api/projects/${projectId}`).then((r) => r.json());
    expect(original.project.id).toBe(projectId);
    expect(original.project.title).toBe(titleV2);
    expect(original.draft.document).toEqual(saved.draft.document);
    const versions = await admin.query(
      'SELECT count(*)::int n FROM project_versions WHERE project_id=$1',
      [projectId],
    );
    expect(versions.rows[0].n).toBeGreaterThanOrEqual(2);
    expect(failures).toEqual([]);
  } finally {
    await guestContext.close();
  }
});

test('catalogue and detail fit seven widths with long Russian text, keyboard focus and genuine loading/error states', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await register(page, 'Автор длинного русского названия');
  const prefix = `Витрина ${randomUUID().slice(0, 8)}`;
  const longTitle = `${prefix} — ${'Оченьдлинноеназвание'.repeat(9)}`;
  const description = `${'Исследовательская работа ученика с подробным объяснением устройства. '.repeat(15)}${'Описаниебезпробелов'.repeat(15)}`;
  const image = await raster(page, 'V1');
  let firstId = '';
  for (let i = 0; i < 8; i++) {
    const title = i === 0 ? longTitle : `${prefix} — исследование ${i + 1}`;
    // Keep real raster loading/error regression on a module using the cover fallback.
    // Electronics' actual SVG scene has its own seven-width editor-backed journey.
    const id = await createProject(page, title, image, 'three-d');
    const published = await publish(page, id, {
      title,
      description,
      tags: ['исследование', 'электроника'],
      license: 'cc-by',
    });
    if (i === 0) firstId = published.publicationId;
  }
  const ownerDialog = await openPublicationDialog(page, longTitle);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoOverflow(page);
    const bounds = await ownerDialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.height).toBeLessThanOrEqual(900);
    await ownerDialog.getByLabel('Имя проекта').focus();
    await page.keyboard.press('Tab');
    await expect(ownerDialog.getByLabel('Описание проекта')).toBeFocused();
    await page.screenshot({ path: `${EVIDENCE}/owner-dialog-${width}.png`, fullPage: true });
  }
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  guest.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const width of WIDTHS) {
      await guest.setViewportSize({ width, height: 900 });
      await guest.goto('/#/explore');
      await expect(
        guest.getByTestId('public-project-card').filter({ hasText: prefix }),
      ).toHaveCount(8);
      await expect(
        guest
          .getByTestId('public-project-card')
          .filter({ hasText: prefix })
          .locator('.public-project-author'),
      ).toHaveText(Array(8).fill('Автор длинного русского названия'));
      await expectNoOverflow(guest);
      const rowCount = await guest.getByTestId('public-project-card').evaluateAll((cards) => {
        const top = cards[0].getBoundingClientRect().top;
        return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - top) < 2).length;
      });
      expect(rowCount).toBeLessThanOrEqual(4);
      if (width === 320) expect(rowCount).toBe(1);
      if (width >= 360 && width <= 768) expect(rowCount).toBe(2);
      if (width === 1024) expect(rowCount).toBe(3);
      if (width === 1440) expect(rowCount).toBe(4);
      const searchBounds = await guest.getByRole('search').boundingBox();
      expect(searchBounds!.width).toBeLessThanOrEqual(width >= 768 ? 400 : width);
      expect(
        (await guest.getByTestId('public-project-card').first().boundingBox())!.y,
      ).toBeLessThan(400);
      const categories = guest.getByRole('group', { name: 'Среда проекта', exact: true });
      await expect(categories.getByRole('button', { name: 'Все', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      if (width === 390) {
        const threeD = categories.getByRole('button', { name: '3D-моделирование', exact: true });
        await threeD.click();
        await expect(threeD).toHaveAttribute('aria-pressed', 'true');
        await expect(guest).toHaveURL(/module=three-d/);
        await expect(
          guest.getByTestId('public-project-card').filter({ hasText: prefix }),
        ).toHaveCount(8);
        await categories.getByRole('button', { name: 'Все', exact: true }).click();
        await expect(guest).toHaveURL(/#\/explore$/);
        await expect(
          guest.getByTestId('public-project-card').filter({ hasText: prefix }),
        ).toHaveCount(8);
      }
      const visualCard = guest.getByTestId('public-project-card').filter({ hasText: longTitle });
      const cardGeometry = await visualCard.evaluate((card) => {
        const bounds = card.getBoundingClientRect();
        const cover = card.querySelector('.public-project-card-cover')!.getBoundingClientRect();
        const footer = card.querySelector('.public-project-card-body')!.getBoundingClientRect();
        const identity = card
          .querySelector('.public-project-card-identity')!
          .getBoundingClientRect();
        const module = card.querySelector('.publication-module')!.getBoundingClientRect();
        const likes = card.querySelector('.public-project-card-meta')!.getBoundingClientRect();
        return {
          square: Math.abs(bounds.width - bounds.height),
          titleInside: footer.top >= cover.top && footer.bottom <= cover.bottom,
          fullBleed: Math.abs(cover.height - (bounds.height - 2)),
          identityFits: identity.right <= module.left && identity.left >= cover.left,
          likesInside: likes.bottom <= cover.bottom && likes.right <= cover.right,
          titleOnly: card.querySelector('.public-project-card-body')!.children.length === 1,
        };
      });
      expect(cardGeometry.square).toBeLessThan(3);
      expect(cardGeometry.titleInside).toBe(true);
      expect(cardGeometry.fullBleed).toBeLessThan(1);
      expect(cardGeometry.identityFits).toBe(true);
      expect(cardGeometry.likesInside).toBe(true);
      expect(cardGeometry.titleOnly).toBe(true);
      // Date is discoverable with pointer and keyboard, without an extra footer row.
      await guest.mouse.move(0, 0);
      await visualCard.locator('a').evaluate((element: HTMLElement) => element.blur());
      await expect(visualCard.locator('time')).toHaveCSS('opacity', '0');
      await visualCard.hover();
      await expect(visualCard.locator('time')).toHaveCSS('opacity', '1');
      await guest.mouse.move(0, 0);
      await guest.screenshot({ path: `${EVIDENCE}/catalogue-${width}.png`, fullPage: true });
      const link = guest.getByRole('link', { name: `Открыть проект «${longTitle}»` });
      // A programmatic focus after clicking a category retains pointer modality.
      // Leave and return through real keyboard navigation before asserting the
      // browser's :focus-visible presentation; do not force a class or style.
      await link.focus();
      await guest.keyboard.press('Shift+Tab');
      await expect(link).not.toBeFocused();
      await guest.keyboard.press('Tab');
      await expect(link).toBeFocused();
      await expect(visualCard.locator('time')).toHaveCSS('opacity', '1');
      const visibleFocus = await link.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none'
        );
      });
      expect(visibleFocus, 'keyboard focus has a visible outline or shadow').toBe(true);
      await guest.keyboard.press('Enter');
      await expect(guest).toHaveURL(new RegExp(`#/public-projects/${firstId}$`));
      await expect(guest.getByTestId('public-project-title')).toHaveText(longTitle);
      await expect(guest.locator('.public-project-detail-author')).toHaveText(
        'Автор длинного русского названия',
      );
      await expectPublicImage(guest);
      await expectNoOverflow(guest);
      if (width === 320) {
        const heading = guest.getByTestId('public-project-title');
        const collapsed = await heading.boundingBox();
        const lineHeight = await heading.evaluate((element) =>
          parseFloat(getComputedStyle(element).lineHeight),
        );
        expect(collapsed!.height).toBeLessThanOrEqual(lineHeight * 3 + 1);
        const headingId = await heading.getAttribute('id');
        expect(headingId).toBeTruthy();
        const toggle = guest.locator(`button[aria-controls="${headingId}"]`);
        await expect(toggle).toHaveAccessibleName('Название целиком');
        await toggle.focus();
        await guest.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toHaveAccessibleName('Свернуть название');
        expect((await heading.boundingBox())!.height).toBeGreaterThan(collapsed!.height);
        await expectNoOverflow(guest);
        await guest.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toHaveAccessibleName('Название целиком');
        expect((await heading.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 3 + 1);
      }
      const geometry = await guest.getByTestId('public-project-detail').evaluate((article) => {
        const rect = (selector: string) => {
          const bounds = article.querySelector(selector)!.getBoundingClientRect();
          return {
            top: bounds.top,
            bottom: bounds.bottom,
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
          };
        };
        return {
          heading: rect('header'),
          workspace: rect('[aria-label="Просмотр проекта"]'),
          actions: rect('[aria-label="Действия с проектом"]'),
          about: rect('[aria-label="О проекте"]'),
          nestedScroll: [...article.querySelectorAll('*')].some((element) => {
            const style = getComputedStyle(element);
            return (
              ['auto', 'scroll'].includes(style.overflowY) &&
              element.scrollHeight > element.clientHeight
            );
          }),
        };
      });
      expect(geometry.heading.bottom).toBeLessThanOrEqual(geometry.workspace.top);
      expect(geometry.workspace.bottom).toBeLessThanOrEqual(geometry.actions.top);
      if (width >= 900) {
        expect(geometry.workspace.right).toBeLessThanOrEqual(geometry.about.left);
        expect(Math.abs(geometry.workspace.top - geometry.about.top)).toBeLessThan(2);
        expect(geometry.workspace.width).toBeGreaterThan(Math.min(width, 1180) * 0.5);
      } else {
        expect(geometry.actions.bottom).toBeLessThanOrEqual(geometry.about.top);
        expect(geometry.workspace.width).toBeGreaterThan(width * 0.8);
      }
      await expect(guest.getByTestId('public-project-detail').locator('aside, figure')).toHaveCount(
        0,
      );
      expect(geometry.nestedScroll).toBe(false);
      await guest.screenshot({ path: `${EVIDENCE}/detail-${width}.png`, fullPage: true });
      if ([320, 390, 1440].includes(width)) {
        await captureDetailViewport(guest, `detail-viewport-${width}`);
      }
    }

    const refreshDetail = async () => {
      await guest.evaluate(() => {
        location.hash = '#/explore';
      });
      await expect(guest.getByTestId('public-project-detail')).toHaveCount(0);
      await guest.evaluate((id) => {
        location.hash = `#/public-projects/${id}`;
      }, firstId);
    };
    // A failed real image request preserves the cover boundary and the real actions.
    const coverUrl = await guest.getByTestId('public-project-preview').getAttribute('src');
    expect(coverUrl).toBeTruthy();
    const coverPattern = new URL(coverUrl!, guest.url()).href;
    await guest.route(coverPattern, (route) => route.abort('failed'));
    await guest.reload();
    await expect(guest.getByTestId('public-project-preview-unavailable')).toContainText(
      'Изображение не загрузилось',
    );
    await expectNoOverflow(guest);
    await guest.screenshot({ path: `${EVIDENCE}/detail-image-error.png`, fullPage: true });
    await guest.unroute(coverPattern);
    await refreshDetail();
    await expectPublicImage(guest);

    // Exercise denied browser clipboard permission, without replacing API data.
    await guest.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
    );
    const share = guest.getByRole('button', { name: 'Копировать ссылку', exact: true });
    await share.focus();
    await expect(share).toBeFocused();
    await guest.keyboard.press('Enter');
    await expect(guest.getByRole('textbox', { name: 'Публичная ссылка на проект' })).toHaveValue(
      new RegExp(`/#/public-projects/${firstId}$`),
    );
    const copy = guest.getByRole('button', { name: 'Создать свою копию', exact: true });
    await expect(copy).toHaveCount(0);
    await guestContext.setOffline(true);
    await refreshDetail();
    await expect(guest.getByTestId('public-project-error')).toBeVisible();
    await expectNoOverflow(guest);
    await guest.screenshot({ path: `${EVIDENCE}/detail-network-error.png`, fullPage: true });
    await guestContext.setOffline(false);
    await guest.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expectPublicImage(guest);

    // A held PostgreSQL read proves the loading state without inventing API data.
    const lock = await admin.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('LOCK TABLE project_publication_state IN ACCESS EXCLUSIVE MODE');
      await refreshDetail();
      await expect(guest.getByTestId('public-project-loading')).toBeVisible();
      await guest.screenshot({ path: `${EVIDENCE}/detail-loading.png`, fullPage: true });
      await guest.goto('/#/explore');
      await expect(guest.getByTestId('public-projects-loading')).toBeVisible();
      await guest.screenshot({ path: `${EVIDENCE}/catalogue-loading.png`, fullPage: true });
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    await expect(guest.getByTestId('public-project-card').filter({ hasText: prefix })).toHaveCount(
      8,
    );
    await guest.getByRole('searchbox').fill(`нет-результатов-${randomUUID()}`);
    await guest.getByRole('searchbox').press('Enter');
    await expect(guest.getByTestId('public-projects-empty')).toBeVisible();
    await guest.screenshot({ path: `${EVIDENCE}/catalogue-empty.png`, fullPage: true });

    // Offline affects only this isolated browser context. Restoring connectivity
    // and Retry must fetch the real PostgreSQL-backed catalogue again.
    await guestContext.setOffline(true);
    await guest.getByRole('searchbox').fill(prefix);
    await guest.getByRole('searchbox').press('Enter');
    await expect(guest.getByTestId('public-projects-error')).toBeVisible();
    await guest.screenshot({ path: `${EVIDENCE}/catalogue-network-error.png`, fullPage: true });
    await guestContext.setOffline(false);
    await guest.getByRole('button', { name: /повторить/i }).click();
    await expect(guest.getByTestId('public-project-card').filter({ hasText: prefix })).toHaveCount(
      8,
    );
    expect(errors).toEqual([]);
  } finally {
    await guestContext.setOffline(false);
    await guestContext.close();
  }
});

async function contextPage(browser: Browser, accountLabel?: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/#/explore');
  const account = accountLabel ? await register(page, accountLabel) : null;
  return { context, page, account };
}

test('real API denies anonymous/non-owner/Seat/teacher/Learning bypasses and keeps private Collections private', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = await register(page, 'Владелец с личным аккаунтом');
  const outsider = await contextPage(browser, 'Посторонний автор');
  const guest = await contextPage(browser);
  const seat = await contextPage(browser);
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  try {
    const teacher = await seedTeacher(admin, 'publication-rights');
    await loginWithOrganization(teacherPage, teacher);
    const image = await raster(page, 'V1');
    const title = `Частный оригинал ${randomUUID().slice(0, 8)}`;
    const projectId = await createProject(page, title, image);
    const state = await publish(page, projectId);
    const dto = await publication(guest.page, state.publicationId);
    assertPublicDto(dto, [
      projectId,
      owner.accountId,
      owner.email,
      teacher.tenantId,
      teacher.schoolId,
    ]);
    for (const method of ['post', 'delete'] as const) {
      await ok(
        await guest.page.request[method](`/api/projects/${projectId}/publication`, {
          headers: { origin: origin(guest.page) },
          ...(method === 'post' ? { data: {} } : {}),
        }),
        401,
      );
      await ok(
        await outsider.page.request[method](`/api/projects/${projectId}/publication`, {
          headers: { origin: origin(outsider.page) },
          ...(method === 'post' ? { data: {} } : {}),
        }),
        404,
      );
      await ok(
        await teacherPage.request[method](`/api/projects/${projectId}/publication`, {
          headers: { origin: origin(teacherPage) },
          ...(method === 'post' ? { data: {} } : {}),
        }),
        404,
      );
    }
    await ok(await outsider.page.request.get(`/api/projects/${projectId}`), 404);
    await ok(await outsider.page.request.get(`/api/projects/${projectId}/snapshot`), 404);
    await ok(await outsider.page.request.get(`/api/gallery/${projectId}/work`), 404);

    const collection = await page.request.post('/api/collections', {
      headers: { origin: origin(page) },
      data: { title: 'Моя частная коллекция' },
    });
    await ok(collection, 201);
    const collectionId = (await collection.json()).id;
    const privateProject = await createProject(
      page,
      `Личная работа ${randomUUID().slice(0, 8)}`,
      image,
    );
    const unlisted = await publish(page, privateProject);
    const unlistedDto = await publication(guest.page, unlisted.publicationId);
    await ok(
      await page.request.put(`/api/projects/${privateProject}/properties`, {
        headers: { origin: origin(page) },
        data: {
          title: 'Приватная работа по прежней ссылке',
          description: 'Только личные данные',
          visibility: 'link',
          license: 'cc-by',
        },
      }),
    );
    await ok(await guest.page.request.get(`/api/public-projects/${unlisted.publicationId}`), 404);
    await ok(await guest.page.request.get(unlistedDto.preview.url), 404);
    await ok(await outsider.page.request.get(`/api/gallery/${privateProject}/work`), 404);
    await ok(await outsider.page.request.get(`/api/gallery/${privateProject}/image`), 404);
    const unlistedList = await guest.page.request
      .get('/api/public-projects?limit=48')
      .then((r) => r.json());
    expect(
      unlistedList.items.some((item: Publication) => item.publicationId === unlisted.publicationId),
    ).toBe(false);
    await ok(
      await page.request.put(`/api/collections/${collectionId}/items/${privateProject}`, {
        headers: { origin: origin(page) },
        data: { inside: true },
      }),
    );
    const ownCollectionResponse = await page.request.get(`/api/collections/${collectionId}`);
    expect(ownCollectionResponse.headers()['cache-control']).toContain('no-store');
    const ownCollection = await ownCollectionResponse.json();
    expect(
      ownCollection.items.some((item: { projectId: string }) => item.projectId === privateProject),
    ).toBe(true);
    const foreignCollection = await outsider.page.request
      .get(`/api/collections/${collectionId}`)
      .then((r) => r.json());
    expect(foreignCollection.items).toEqual([]);
    await ok(await guest.page.request.get(`/api/collections/${collectionId}`), 401);
    const readerCollectionResponse = await outsider.page.request.post('/api/collections', {
      headers: { origin: origin(outsider.page) },
      data: { title: 'Ссылка на публикацию' },
    });
    await ok(readerCollectionResponse, 201);
    const readerCollection = (await readerCollectionResponse.json()).id;
    await ok(
      await outsider.page.request.put(`/api/collections/${readerCollection}/items/${projectId}`, {
        headers: { origin: origin(outsider.page) },
        data: { inside: true },
      }),
    );
    const sharedBefore = await outsider.page.request
      .get(`/api/collections/${readerCollection}`)
      .then((r) => r.json());
    expect(sharedBefore.items[0].title).toBe(title);
    await ok(
      await page.request.put(`/api/projects/${projectId}/properties`, {
        headers: { origin: origin(page) },
        data: {
          title: 'Секретное название черновика',
          description: 'Приватное описание',
          tags: [],
          license: 'cc-by',
        },
      }),
    );
    const sharedAfter = await outsider.page.request
      .get(`/api/collections/${readerCollection}`)
      .then((r) => r.json());
    expect(sharedAfter.items[0].title).toBe(title);
    expect(JSON.stringify(sharedAfter)).not.toContain('Секретное название');

    const classroomResponse = await teacherPage.request.post('/api/classrooms', {
      headers: { origin: origin(teacherPage), 'idempotency-key': `pub-class-${randomUUID()}` },
      data: {
        title: 'Проверка ограничений публикации',
        ageBand: 'mixed',
        topicKeys: [],
        safeModeDefault: true,
      },
    });
    await ok(classroomResponse, 201);
    const classroomId = (await classroomResponse.json()).classroom.id;
    const classroom = await teacherPage.request
      .get(`/api/classrooms/${classroomId}`)
      .then((r) => r.json());
    const seatResponse = await teacherPage.request.post(`/api/classrooms/${classroomId}/seats`, {
      headers: { origin: origin(teacherPage) },
      data: { displayLabel: 'Тестовый ученик', safeMode: false },
    });
    await ok(seatResponse, 201);
    const pupil = (await seatResponse.json()).student;
    const codeResponse = await teacherPage.request.post(
      `/api/classrooms/${classroomId}/seats/${pupil.id}/code`,
      { headers: { origin: origin(teacherPage) }, data: { requestId: randomUUID() } },
    );
    await ok(codeResponse, 201);
    const studentCode = (await codeResponse.json()).studentCode;
    const seatLogin = await seat.page.request.post('/api/class-join/studentseat', {
      headers: { origin: origin(seat.page) },
      data: { code: classroom.classroom.joinCode, studentCode },
    });
    await ok(seatLogin);
    const seatProject = await createProject(seat.page, 'Работа тестового ученика', image);
    for (const path of [
      `/api/projects/${seatProject}/publication`,
      `/api/gallery/${seatProject}`,
    ]) {
      await ok(
        await seat.page.request.post(path, { headers: { origin: origin(seat.page) }, data: {} }),
        403,
      );
    }
    const propertiesBypass = await seat.page.request.put(
      `/api/projects/${seatProject}/properties`,
      {
        headers: { origin: origin(seat.page) },
        data: { title: 'Попытка обойти запрет', visibility: 'public', license: 'cc-by' },
      },
    );
    expect(propertiesBypass.status()).toBe(403);
    const teacherPublish = await teacherPage.request.post(
      `/api/projects/${seatProject}/publication`,
      { headers: { origin: origin(teacherPage) }, data: {} },
    );
    expect([403, 404]).toContain(teacherPublish.status());
    const teacherLegacyPublish = await teacherPage.request.post(`/api/gallery/${seatProject}`, {
      headers: { origin: origin(teacherPage) },
      data: {},
    });
    expect([400, 403, 404]).toContain(teacherLegacyPublish.status());
    const seatPublications = await admin.query(
      'SELECT count(*)::int n FROM project_publication_state WHERE project_id=$1',
      [seatProject],
    );
    expect(seatPublications.rows[0].n).toBe(0);

    // A Safe Mode Seat relation does not impose a global ban on this Account's
    // independent, personal, non-Learning Project outside the classroom.
    await admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
      pupil.id,
      owner.accountId,
    ]);
    const stillPersonal = await publish(page, privateProject);
    await publication(guest.page, stillPersonal.publicationId);
    await ok(
      await page.request.delete(`/api/projects/${privateProject}/publication`, {
        headers: { origin: origin(page) },
      }),
    );

    // A real immutable legacy origin is sufficient server evidence, even after
    // an old assignment source has been withdrawn. No HTTP response is faked.
    await admin.query(
      `INSERT INTO learning_legacy_project_origins (project_id, project_tenant_id, school_tenant_id, source_work_id, claimed_at)
       SELECT id, tenant_id, $2, $3, now() FROM projects WHERE id=$1`,
      [privateProject, teacher.tenantId, randomUUID()],
    );
    const learningPublish = await page.request.post(`/api/projects/${privateProject}/publication`, {
      headers: { origin: origin(page) },
      data: {},
    });
    await ok(learningPublish, 403);
    expect((await learningPublish.json()).error.code).toBe('learning_work_protected');
    await ok(
      await page.request.put(`/api/projects/${privateProject}/properties`, {
        headers: { origin: origin(page) },
        data: { title: 'Оригинальная учебная работа', visibility: 'public', license: 'cc-by' },
      }),
      403,
    );
    await ok(
      await guest.page.request.get(`/api/public-projects/${stillPersonal.publicationId}`),
      404,
    );

    // Revocation removes the foreign projection but keeps private own entries.
    await ok(
      await page.request.delete(`/api/projects/${projectId}/publication`, {
        headers: { origin: origin(page) },
      }),
    );
    await ok(await guest.page.request.get(dto.preview.url), 404);
    const hiddenResponse = await outsider.page.request.get(`/api/collections/${readerCollection}`);
    expect(hiddenResponse.headers()['cache-control']).toContain('no-store');
    const hidden = await hiddenResponse.json();
    expect(hidden.items).toEqual([]);
    const preserved = await page.request
      .get(`/api/collections/${collectionId}`)
      .then((r) => r.json());
    expect(
      preserved.items.some((item: { projectId: string }) => item.projectId === privateProject),
    ).toBe(true);
    await guest.page.goto(`/#/public-projects/${state.publicationId}`);
    await expect(guest.page.getByTestId('public-project-detail')).toHaveCount(0);
    await guest.page.screenshot({
      path: `${EVIDENCE}/api-policy-not-available.png`,
      fullPage: true,
    });
  } finally {
    await outsider.context.close();
    await guest.context.close();
    await seat.context.close();
    await teacherContext.close();
  }
});

test('archiving a previously public source closes metadata and images through the current policy without deleting the original', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await register(page, 'Автор проверки отзыва доступа');
  const projectId = await createProject(
    page,
    `Доступ после архивации ${randomUUID().slice(0, 8)}`,
    await raster(page, 'V1'),
  );
  const state = await publish(page, projectId);
  const guest = await contextPage(browser);
  try {
    const before = await publication(guest.page, state.publicationId);
    await imageHash(guest.page, before.preview.url);
    await ok(
      await page.request.post(`/api/projects/${projectId}/status`, {
        headers: { origin: origin(page) },
        data: { status: 'archived' },
      }),
      201,
    );
    const source = await admin.query(
      `SELECT project.status, state.state, (SELECT count(*)::int FROM project_drafts WHERE project_id=project.id) drafts,
              (SELECT count(*)::int FROM project_versions WHERE project_id=project.id) versions
         FROM projects project JOIN project_publication_state state ON state.project_id=project.id WHERE project.id=$1`,
      [projectId],
    );
    expect(source.rows[0]).toMatchObject({ status: 'archived', state: 'public', drafts: 1 });
    expect(source.rows[0].versions).toBeGreaterThanOrEqual(1);
    await ok(await guest.page.request.get(`/api/public-projects/${state.publicationId}`), 404);
    const image = await guest.page.request.get(before.preview.url, {
      headers: {
        'if-none-match': 'old-cached-image',
        'if-modified-since': new Date().toUTCString(),
      },
    });
    await ok(image, 404);
    expect(image.headers()['cache-control']).toContain('no-store');
    await ok(await page.request.get(`/api/gallery/${projectId}/image`), 404);
    const list = await guest.page.request
      .get('/api/public-projects?limit=48')
      .then((r) => r.json());
    expect(list.items.some((item: Publication) => item.publicationId === state.publicationId)).toBe(
      false,
    );
    await guest.page.goto(`/#/public-projects/${state.publicationId}`);
    await expect(guest.page.getByRole('heading', { name: 'Публикация недоступна' })).toBeVisible();
    await guest.page.screenshot({ path: `${EVIDENCE}/source-policy-change.png`, fullPage: true });
  } finally {
    await guest.context.close();
  }
});
