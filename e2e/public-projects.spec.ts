import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import type pg from 'pg';
import type {
  OwnProgressGroupV1,
  PersonalProgressSummaryV1,
  GroupRatingPageV1,
} from '../packages/contracts/src/personal-progress';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import {
  accountMenu,
  openAccountMenu,
  openPortalSection,
  switchWorkspace,
  PERSONAL_WORKSPACE,
} from './portal-navigation';

// All identities, projects, metadata, images and refusals go through the built
// API backed by a real isolated PostgreSQL. There are no route.fulfill mocks.
// Raster fixtures deliberately say V1/V2: their byte identity, not an editor's
// rendering algorithm, is the invariant this publication boundary must preserve.
const EVIDENCE = 'e2e/artifacts/public-projects';
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440] as const;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

test('only the publication owner can resolve its private editor', async ({ page, browser }) => {
  await page.goto('/#/explore');
  await register(page, 'Автор редактора публикации');
  const projectId = await createProject(
    page,
    'Работа автора ' + randomUUID(),
    await raster(page, 'Owner'),
  );
  const published = await publish(page, projectId);
  const target = `/api/public-projects/${published.publicationId}/editor`;
  const owner = await page.request.get(target);
  expect(owner.status()).toBe(200);
  expect(await owner.json()).toEqual({ editor: { projectId, moduleKey: 'electronics' } });
  expect(owner.headers()['cache-control']).toContain('no-store');
  const other = await browser.newContext({ baseURL: origin(page) });
  try {
    expect((await other.request.get(new URL(target, page.url()).toString())).status()).toBe(401);
    const stranger = await other.newPage();
    await stranger.goto(new URL('/#/explore', page.url()).toString());
    await register(stranger, 'Другой пользователь');
    const foreign = await stranger.request.get(new URL(target, page.url()).toString());
    expect(foreign.status()).toBe(200);
    expect(await foreign.json()).toEqual({ editor: null });
  } finally {
    await other.close();
  }
});
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
      expect(columns).toBe(width <= 600 ? 2 : 4);
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
      expect(Math.abs(bounds!.width / bounds!.height - 1)).toBeLessThan(0.025);
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
      await expect(card.locator('.public-project-card-identity')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(
        card.locator('.publication-module .project-module-artwork clipPath circle'),
      ).toHaveCount(1);
      await expect(card.locator('.public-project-card-meta')).toHaveCSS(
        'background-color',
        'rgba(255, 255, 255, 0.8)',
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
  likeCount: number;
  copyCount: number;
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

async function register(
  page: Page,
  label: string,
): Promise<{ accountId: string; email: string; password: string }> {
  await page.goto('/#/explore');
  const id = randomUUID().replaceAll('-', '');
  const email = `publication-${id}@isolated.test`;
  const password = `Publication-${id}-Password`;
  const response = await page.request.post('/api/auth/register', {
    headers: { origin: origin(page) },
    data: {
      email,
      username: `pub_${id.slice(0, 24)}`,
      displayName: label,
      password,
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
  return { accountId: session.user.id as string, email, password };
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
  const live = page.locator('.public-three-d-stage[data-ready="true"] canvas');
  await expect
    .poll(async () => (await live.isVisible()) || (await image.isVisible()), { timeout: 30000 })
    .toBe(true);
  if (await live.isVisible()) return;
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

test('SP-01 shared publication cards keep real counts, navigation and readable Home rails at four widths', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const authorLabel = 'Автор учебных проектов с очень длинным именем для проверки карточки';
  await register(page, authorLabel);
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
  const readerContext = await browser.newContext({ baseURL: origin(page) });
  const reader = await readerContext.newPage();
  const sources: string[] = [];
  const acquisitionBefore = await admin.query<{ enabled: boolean }>(
    'SELECT enabled FROM publication_acquisition_settings WHERE singleton_key',
  );
  expect(acquisitionBefore.rows).toHaveLength(1);
  const errors: string[] = [];
  reader.on('pageerror', (error) => errors.push(error.message));
  try {
    await register(reader, 'Читатель общей карточки');
    const prefix = `SP-01 ${randomUUID().slice(0, 8)}`;
    const title = `${prefix} — ${'Оченьдлинноеназвание'.repeat(6)}`;
    const zeroTitle = `${prefix} — работа без отклика`;
    const image = await raster(page, 'SP-01');
    const zeroProjectId = await createProject(page, zeroTitle, image);
    sources.push(zeroProjectId);
    const zero = await publish(page, zeroProjectId);
    const projectId = await createProject(page, title, image, 'three-d');
    sources.push(projectId);
    const published = await publish(page, projectId, { license: 'public-domain' });
    // The fixture configures the existing isolated-platform gate; counts still
    // come only from successful public like/copy operations through the API.
    await admin.query(
      'UPDATE publication_acquisition_settings SET enabled=true WHERE singleton_key',
    );
    await ok(
      await page.request.post(`/api/projects/${projectId}/publication/acquisition`, {
        headers: { origin: origin(page) },
        data: {
          allowed: true,
          expectedVersion: 0,
          expectedRevisionId: published.revisionId,
        },
      }),
    );
    await ok(
      await reader.request.put(`/api/public-projects/${published.publicationId}/like`, {
        headers: { origin: origin(reader) },
        data: { revisionId: published.revisionId, on: true },
      }),
    );
    const copied = await reader.request.post(
      `/api/public-projects/${published.publicationId}/copy`,
      {
        headers: { origin: origin(reader), 'idempotency-key': randomUUID() },
        data: { revisionId: published.revisionId },
      },
    );
    expect([200, 201]).toContain(copied.status());
    expect(await copied.json()).toMatchObject({ moduleKey: 'three-d', created: true });
    const expected = await publication(reader, published.publicationId);
    const untouched = await publication(reader, zero.publicationId);
    expect(expected).toMatchObject({ authorLabel, likeCount: 1, copyCount: 1 });
    expect(untouched).toMatchObject({ likeCount: 0, copyCount: 0 });
    const href = `/#/public-projects/${published.publicationId}`;
    const cardFor = (publicationId: string) =>
      reader.getByTestId('public-project-card').filter({
        has: reader.locator(`a[href="/#/public-projects/${publicationId}"]`),
      });
    const checkCard = async (card: Locator, heading: 'H2' | 'H3') => {
      await expect(card).toBeVisible();
      await expect(card.locator('.public-project-card-link')).toHaveAttribute('href', href);
      await expect(card.locator('.public-project-card-link')).toHaveAttribute(
        'aria-label',
        `Открыть проект «${title}»`,
      );
      await expect(card.locator('a')).toHaveCount(1);
      await expect(card.locator('a a, a button')).toHaveCount(0);
      await expect(card.getByTestId('public-project-card-title')).toHaveText(title);
      await expect(card.getByTestId('public-project-card-title')).toHaveAttribute('title', title);
      expect(
        await card.getByTestId('public-project-card-title').evaluate((node) => node.tagName),
      ).toBe(heading);
      await expect(card.locator('.public-project-author')).toHaveText(expected.authorLabel);
      await expect(card.locator('.public-project-card-identity')).toHaveAttribute(
        'title',
        authorLabel,
      );
      await expect(card.locator('.public-project-avatar img')).toHaveAttribute(
        'src',
        `/api/public-projects/${published.publicationId}/author-avatar`,
      );
      await expect
        .poll(() =>
          card
            .locator('.public-project-avatar img, [data-testid="public-project-card-preview"]')
            .evaluateAll(
              (images) =>
                images.length === 2 &&
                images.every((image) => {
                  const picture = image as HTMLImageElement;
                  return picture.complete && picture.naturalWidth > 0;
                }),
            ),
        )
        .toBe(true);
      await expect(card.locator('.publication-module')).toHaveAttribute('data-module', 'three-d');
      await expect(
        card.getByLabel(`${expected.likeCount} нравится`, { exact: true }),
      ).toBeVisible();
      await expect(
        card.getByLabel(`${expected.copyCount} добавлений в свои проекты`, { exact: true }),
      ).toHaveAttribute('title', 'Добавили к себе');
      const layout = await card.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const title = element
          .querySelector('[data-testid="public-project-card-title"]')!
          .getBoundingClientRect();
        const counts = element.querySelector('.public-project-card-meta')!.getBoundingClientRect();
        const identity = element
          .querySelector('.public-project-card-identity')!
          .getBoundingClientRect();
        const module = element.querySelector('.publication-module')!.getBoundingClientRect();
        return {
          square: Math.abs(bounds.width / bounds.height - 1),
          titleWidth: title.width,
          titleClearance: counts.left - title.right,
          identityClearance: module.left - identity.right,
          countsInside: counts.right <= bounds.right && counts.bottom <= bounds.bottom,
        };
      });
      expect(layout.square).toBeLessThan(0.025);
      expect(layout.titleWidth).toBeGreaterThan(20);
      expect(layout.titleClearance).toBeGreaterThanOrEqual(-1);
      expect(layout.identityClearance).toBeGreaterThanOrEqual(-1);
      expect(layout.countsInside).toBe(true);
    };

    for (const width of [1440, 1024, 390, 320]) {
      await reader.setViewportSize({ width, height: 900 });
      await reader.mouse.move(0, 0);
      await reader.goto('/#/home');
      const header = reader.locator('.portal-header');
      await expect(header).toBeVisible();
      const headerBefore = (await header.boundingBox())!;
      const community = reader.locator('.home-community-shelf');
      await community
        .getByRole('heading', { name: 'Проекты сообщества', level: 2 })
        .scrollIntoViewIfNeeded();
      await expect(
        community.getByText('Работы пользователей платформы', { exact: true }),
      ).toBeVisible();
      const homeCard = cardFor(published.publicationId);
      await homeCard.scrollIntoViewIfNeeded();
      await checkCard(homeCard, 'H3');
      await expect(
        cardFor(zero.publicationId).getByLabel('0 нравится', { exact: true }),
      ).toBeVisible();
      await expect(
        cardFor(zero.publicationId).getByLabel('0 добавлений в свои проекты', { exact: true }),
      ).toHaveAttribute('title', 'Добавили к себе');
      await expectNoOverflow(reader);
      const headerAfter = (await header.boundingBox())!;
      expect(headerAfter.width).toBeCloseTo(headerBefore.width, 1);
      expect(headerAfter.height).toBeCloseTo(headerBefore.height, 1);
      expect(headerAfter.x).toBeCloseTo(headerBefore.x, 1);
      if (width <= 390) {
        const rail = community.locator('.home-shelf-track');
        expect((await homeCard.boundingBox())!.width).toBeGreaterThanOrEqual(220);
        await expect(rail).toHaveCSS('overflow-x', 'auto');
        await rail.evaluate((element) => {
          element.scrollLeft = 0;
        });
        expect(
          await rail.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return [...element.children].some((child) => {
              const card = child.getBoundingClientRect();
              return card.left < bounds.right - 8 && card.right > bounds.right + 8;
            });
          }),
        ).toBe(true);
        await rail.focus();
        await reader.keyboard.press('ArrowRight');
        await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await rail.evaluate((element) => {
          element.scrollLeft = 0;
        });
        await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(0);
        await rail.hover({ position: { x: 60, y: 50 } });
        const scrollY = await reader.evaluate(() => window.scrollY);
        await reader.mouse.wheel(0, 160);
        await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        expect(await reader.evaluate(() => window.scrollY)).toBe(scrollY);
        await reader.mouse.move(0, 0);
        await rail.evaluate((element) => {
          element.scrollLeft = 0;
        });
        await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(0);
      }
      await reader.screenshot({ path: `${EVIDENCE}/sp01-home-${width}.png`, fullPage: true });
      await community.screenshot({ path: `${EVIDENCE}/sp01-home-community-${width}.png` });
      await homeCard.locator('.public-project-card-link').click();
      await expect(reader).toHaveURL(new RegExp(`#/public-projects/${published.publicationId}$`));
      await expect(reader.getByTestId('public-project-title')).toHaveText(title);

      await reader.goto(`/#/explore?search=${encodeURIComponent(prefix)}`);
      const catalogCard = cardFor(published.publicationId);
      await checkCard(catalogCard, 'H2');
      await expect(
        cardFor(zero.publicationId).getByLabel('0 нравится', { exact: true }),
      ).toBeVisible();
      await expectNoOverflow(reader);
      const catalogHeader = (await reader.locator('.portal-header').boundingBox())!;
      expect(catalogHeader.width).toBeCloseTo(headerBefore.width, 1);
      expect(catalogHeader.height).toBeCloseTo(headerBefore.height, 1);
      await reader.screenshot({ path: `${EVIDENCE}/sp01-catalogue-${width}.png`, fullPage: true });
    }

    // A missing preview cannot be published (preview_required). Exercise the
    // real image-error path instead of fabricating a successful preview:null DTO.
    const coverUrl = new URL(expected.preview.url, origin(reader)).href;
    const failedCover = (url: URL) => url.href === coverUrl;
    await reader.route(failedCover, (route) => route.abort('failed'));
    for (const width of [1440, 1024, 390, 320]) {
      await reader.setViewportSize({ width, height: 900 });
      for (const surface of ['home', `explore?search=${encodeURIComponent(prefix)}`]) {
        await reader.mouse.move(0, 0);
        await reader.goto(`/#/${surface}`);
        if (surface === 'home')
          await reader.locator('.home-community-shelf').scrollIntoViewIfNeeded();
        const card = cardFor(published.publicationId);
        await card.scrollIntoViewIfNeeded();
        const fallback = card.getByTestId('public-project-preview-unavailable');
        await expect(fallback).toHaveText('Изображение не загрузилось');
        await expect(card.getByTestId('public-project-card-title')).toHaveText(title);
        const geometry = await fallback.evaluate((element) => {
          const card = element.closest('.public-project-card')!;
          const preview = element.closest('.publication-preview')!;
          const previewBounds = preview.getBoundingClientRect();
          const previewStyle = getComputedStyle(preview);
          const top = card.querySelector('.public-project-card-topline')!.getBoundingClientRect();
          const footer = card.querySelector('.public-project-card-body')!.getBoundingClientRect();
          const text = document.createRange();
          text.selectNodeContents(element);
          const bounds = text.getBoundingClientRect();
          const textNode = element.firstChild;
          if (!textNode || textNode.nodeType !== Node.TEXT_NODE)
            throw new Error('The image error must contain readable text');
          const words = [...(textNode.textContent ?? '').matchAll(/\S+/gu)].map((match) => {
            const word = document.createRange();
            word.setStart(textNode, match.index!);
            word.setEnd(textNode, match.index! + match[0].length);
            return { text: match[0], lines: word.getClientRects().length };
          });
          return {
            text: {
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
              left: bounds.left,
            },
            content: {
              top: previewBounds.top + parseFloat(previewStyle.paddingTop),
              right: previewBounds.right - parseFloat(previewStyle.paddingRight),
              bottom: previewBounds.bottom - parseFloat(previewStyle.paddingBottom),
              left: previewBounds.left + parseFloat(previewStyle.paddingLeft),
            },
            topOverlayBottom: top.bottom,
            footerTop: footer.top,
            words,
          };
        });
        expect(
          geometry.text.top,
          `${surface} ${width}: text below avatar/module overlay`,
        ).toBeGreaterThanOrEqual(geometry.topOverlayBottom + 2);
        expect(
          geometry.text.bottom,
          `${surface} ${width}: text above title/count overlay`,
        ).toBeLessThanOrEqual(geometry.footerTop - 2);
        expect(geometry.text.top).toBeGreaterThanOrEqual(geometry.content.top);
        expect(geometry.text.bottom).toBeLessThanOrEqual(geometry.content.bottom);
        expect(geometry.text.left).toBeGreaterThanOrEqual(geometry.content.left);
        expect(geometry.text.right).toBeLessThanOrEqual(geometry.content.right);
        expect(geometry.words).toEqual([
          { text: 'Изображение', lines: 1 },
          { text: 'не', lines: 1 },
          { text: 'загрузилось', lines: 1 },
        ]);
        await expectNoOverflow(reader);
        const sizeSuffix = width === 320 ? '' : `-${width}`;
        await reader.screenshot({
          path: `${EVIDENCE}/sp01-${surface === 'home' ? 'home' : 'catalogue'}-image-error${sizeSuffix}.png`,
          fullPage: true,
        });
      }
    }
    await reader.unroute(failedCover);
    expect(errors).toEqual([]);
  } finally {
    await admin.query(
      'UPDATE publication_acquisition_settings SET enabled=$1 WHERE singleton_key',
      [acquisitionBefore.rows[0]!.enabled],
    );
    for (const source of sources) {
      await page.request.delete(`/api/projects/${source}/publication`, {
        headers: { origin: origin(page) },
      });
    }
    await readerContext.close();
  }
});

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
  // Native card captures exclude the workplane/selection helpers on a white
  // background; the live authoring document must still keep its grid enabled.
  const snapshotCorners = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [
      [3, 3],
      [canvas.width - 4, 3],
      [3, canvas.height - 4],
      [canvas.width - 4, canvas.height - 4],
    ].map(([x, y]) => [...context.getImageData(x!, y!, 1, 1).data]);
  }, `/api/projects/${projectId}/snapshot`);
  expect(
    snapshotCorners.every(
      (rgba) => rgba.slice(0, 3).every((value) => value >= 250) && rgba[3] === 255,
    ),
  ).toBe(true);
  expect(
    (await (await page.request.get(`/api/projects/${projectId}`)).json()).draft.document.grid
      .visible,
  ).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: 'Публикация', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Публикация проекта', exact: true });
  await expect(dialog).toBeVisible();
  const publicationSnapshot = await page.request.get(`/api/projects/${projectId}/snapshot`);
  await ok(publicationSnapshot);
  const sourceHash = createHash('sha256')
    .update(await publicationSnapshot.body())
    .digest('hex');
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
    const privateReads: string[] = [];
    guest.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/projects/'))
        privateReads.push(request.url());
    });
    await guest.goto('/#/explore');
    const publicCard = guest.getByTestId('public-project-card').filter({ hasText: title });
    await expect(publicCard).toBeVisible();
    await expect(guest.locator('.three-d-hover-live canvas')).toHaveCount(0);
    await publicCard.hover();
    await expect(publicCard.locator('.three-d-hover-live')).toHaveClass(/is-ready/);
    const hoverCanvas = publicCard.locator('.three-d-hover-live canvas');
    const hoverBefore = createHash('sha256')
      .update(await hoverCanvas.screenshot())
      .digest('hex');
    const bounds = (await publicCard.boundingBox())!;
    await guest.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.3);
    await expect
      .poll(async () =>
        createHash('sha256')
          .update(await hoverCanvas.screenshot())
          .digest('hex'),
      )
      .not.toBe(hoverBefore);
    await guest.mouse.move(0, 0);
    await expect(guest.locator('.three-d-hover-live canvas')).toHaveCount(0);
    expect(privateReads).toEqual([]);
    await guest.getByRole('link', { name: `Открыть проект «${title}»` }).click();
    await expect(guest).toHaveURL(new RegExp(`#/public-projects/${publicationId}$`));
    await expect(guest.getByTestId('public-project-title')).toHaveText(title);
    const liveModel = guest.getByTestId('public-three-d-viewer');
    await expect(liveModel.locator('.public-three-d-stage')).toHaveAttribute('data-ready', 'true');
    const canvas = liveModel.locator('canvas');
    const cameraBefore = createHash('sha256')
      .update(await canvas.screenshot())
      .digest('hex');
    await guest.getByRole('button', { name: 'Повернуть модель вправо', exact: true }).click();
    await expect
      .poll(async () =>
        createHash('sha256')
          .update(await canvas.screenshot())
          .digest('hex'),
      )
      .not.toBe(cameraBefore);
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
  const before = (await (await page.request.get(`/api/projects/${projectId}`)).json()).draft;
  const writes: string[] = [];
  page.on('request', (request) => {
    if (
      ['PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith('/api/projects/')
    )
      writes.push(request.url());
  });
  const frozenPublication = await publication(page, publicationId);
  const artifactPath = `/api/public-projects/${publicationId}/artifact`;
  const publicArtifactReads: string[] = [];
  const recordPublicArtifact = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname === artifactPath) publicArtifactReads.push(request.url());
  };
  page.on('request', recordPublicArtifact);
  await page.mouse.move(0, 0);
  await page.goto('/#/home');
  await page.locator('.home-community-shelf').scrollIntoViewIfNeeded();
  const homePublicCard = page
    .locator('.home-community-shelf')
    .getByTestId('public-project-card')
    .filter({
      has: page.locator(`a[href="/#/public-projects/${publicationId}"]`),
    });
  await homePublicCard.scrollIntoViewIfNeeded();
  await expect(homePublicCard).toBeVisible();
  await page.waitForTimeout(250);
  expect(publicArtifactReads).toEqual([]);
  await expect(page.locator('.three-d-hover-live canvas')).toHaveCount(0);
  const publicArtifactResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === artifactPath &&
      url.searchParams.get('revisionId') === frozenPublication.revisionId
    );
  });
  await homePublicCard.hover();
  const artifactResponse = await publicArtifactResponse;
  expect(artifactResponse.status()).toBe(200);
  expect((await artifactResponse.json()).artifact.provenance).toMatchObject({
    publicationId,
    revisionNumber: frozenPublication.revisionNo,
  });
  await expect(homePublicCard.locator('.three-d-hover-live')).toHaveClass(/is-ready/);
  await expect(page.locator('.three-d-hover-live canvas')).toHaveCount(1);
  expect(publicArtifactReads).toHaveLength(1);
  await page.screenshot({ path: `${EVIDENCE}/sp01-home-public-3d-active.png`, fullPage: true });
  await page.mouse.move(0, 0);
  await expect(page.locator('.three-d-hover-live canvas')).toHaveCount(0);
  await homePublicCard.hover();
  await expect(homePublicCard.locator('.three-d-hover-live')).toHaveClass(/is-ready/);
  await homePublicCard.locator('.public-project-card-link').click();
  await expect(page).toHaveURL(new RegExp(`#/public-projects/${publicationId}$`));
  await expect(page.locator('.three-d-hover-live canvas')).toHaveCount(0);
  page.off('request', recordPublicArtifact);
  for (const route of ['home', 'projects']) {
    await page.goto(`/#/${route}`);
    const card = page.getByTestId('project-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    // A hash navigation may mount the next card beneath the existing cursor;
    // leave it first so this hover necessarily generates a real pointerenter.
    await page.mouse.move(0, 0);
    await card.hover();
    await expect(card.locator('.three-d-hover-live')).toHaveClass(/is-ready/);
    const canvas = card.locator('.three-d-hover-live canvas');
    const first = createHash('sha256')
      .update(await canvas.screenshot())
      .digest('hex');
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.3);
    await expect
      .poll(async () =>
        createHash('sha256')
          .update(await canvas.screenshot())
          .digest('hex'),
      )
      .not.toBe(first);
    await expect(page.locator('.three-d-hover-live canvas')).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(page.locator('.three-d-hover-live canvas')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await card.hover();
    await page.waitForTimeout(250);
    await expect(page.locator('.three-d-hover-live canvas')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  expect((await (await page.request.get(`/api/projects/${projectId}`)).json()).draft).toEqual(
    before,
  );
  expect(writes).toEqual([]);
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
      expect(rowCount).toBe(width <= 600 ? 2 : 4);
      const searchBounds = await guest.getByRole('search').boundingBox();
      expect(searchBounds!.width).toBeLessThanOrEqual(260);
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
          aspect: Math.abs(bounds.width / bounds.height - 1),
          titleInside: footer.top >= cover.top && footer.bottom <= cover.bottom,
          fullBleed: Math.abs(cover.height - (bounds.height - 2)),
          identityFits: identity.right <= module.left && identity.left >= cover.left,
          likesInside: likes.bottom <= cover.bottom && likes.right <= cover.right,
          titleAndCounts: card.querySelector('.public-project-card-body')!.children.length === 2,
        };
      });
      expect(cardGeometry.aspect).toBeLessThan(0.025);
      expect(cardGeometry.titleInside).toBe(true);
      expect(cardGeometry.fullBleed).toBeLessThan(1);
      expect(cardGeometry.identityFits).toBe(true);
      expect(cardGeometry.likesInside).toBe(true);
      expect(cardGeometry.titleAndCounts).toBe(true);
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
          sidebar: rect('.public-project-sidebar'),
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
      expect(geometry.actions.bottom).toBeLessThanOrEqual(geometry.workspace.top);
      if (width > 1100) {
        expect(geometry.workspace.right).toBeLessThanOrEqual(geometry.sidebar.left);
        expect(Math.abs(geometry.workspace.top - geometry.sidebar.top)).toBeLessThan(2);
        expect(geometry.workspace.width).toBeGreaterThan(Math.min(width, 1180) * 0.5);
      } else {
        expect(geometry.workspace.bottom).toBeLessThanOrEqual(geometry.sidebar.top);
        expect(geometry.workspace.width).toBeGreaterThan(width * 0.8);
      }
      await expect(
        guest.getByTestId('public-project-detail').locator('aside.public-project-sidebar'),
      ).toHaveCount(1);
      await expect(guest.getByTestId('public-project-detail').locator('figure')).toHaveCount(0);
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

// SP-03 uses the built application and the same isolated PostgreSQL database as
// the publication gate. Account learners register normally; only educators use
// seedTeacher. Successful summary/auth/learning responses are never replaced.
const SP03_WIDTHS = [1440, 1024, 390, 320] as const;
const SP03_MODULES = ['three-d', 'electronics', 'blocks', 'robotics'] as const;
type Sp03Class = { id: string; title: string; joinCode: string };
type Sp03Account = Awaited<ReturnType<typeof register>>;

async function sp03Teacher(browser: Browser) {
  const identity = await seedTeacher(admin, `sp03-${randomUUID().slice(0, 8)}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginWithOrganization(page, identity);
  return { identity, context, page };
}

async function sp03Class(teacher: Page, title: string): Promise<Sp03Class> {
  const response = await teacher.request.post('/api/classrooms', {
    headers: { origin: origin(teacher), 'idempotency-key': `sp03-${randomUUID()}` },
    data: { title, ageBand: 'mixed', topicKeys: [], safeModeDefault: false },
  });
  await ok(response, 201);
  const id = (await response.json()).classroom.id as string;
  const detail = await teacher.request.get(`/api/classrooms/${id}`);
  await ok(detail);
  const classroom = (await detail.json()).classroom;
  return { id, title, joinCode: classroom.joinCode as string };
}

async function sp03Join(learner: Page, teacher: Page, group: Sp03Class): Promise<string> {
  const request = await learner.request.post('/api/class-join/account', {
    headers: { origin: origin(learner) },
    data: { code: group.joinCode },
  });
  await ok(request);
  const pending = await request.json();
  expect(pending).toMatchObject({ status: 'pending', classroom: { id: group.id } });
  expect(pending.requestId).toMatch(UUID);
  const decision = await teacher.request.post(
    `/api/class-join/requests/${group.id}/${pending.requestId}/decision`,
    { headers: { origin: origin(teacher) }, data: { decision: 'approved' } },
  );
  await ok(decision, 201);
  // Read the committed membership only after the real teacher decision receipt.
  const joined = await learner.request.post('/api/class-join/account', {
    headers: { origin: origin(learner) },
    data: { code: group.joinCode },
  });
  await ok(joined);
  const active = await joined.json();
  expect(active).toMatchObject({ status: 'active', classroom: { id: group.id } });
  expect(active.seatId).toMatch(UUID);
  return active.seatId as string;
}

async function sp03Rating(
  teacher: Page,
  groupId: string,
  periodDays: 7 | 30 | 90,
  factor: 'projects' | 'grades' | null,
): Promise<void> {
  const roster = await teacher.request.get(`/api/classrooms/${groupId}/participants`);
  await ok(roster);
  const settings = (await roster.json()).settings;
  await ok(
    await teacher.request.post(`/api/classrooms/${groupId}/participants/actions/settings`, {
      headers: { origin: origin(teacher) },
      data: {
        expectedRevision: settings.revision,
        periodDays,
        requestId: randomUUID(),
        factors: {
          projects: factor === 'projects',
          logins: false,
          days: false,
          time: false,
          grades: factor === 'grades',
        },
      },
    }),
    201,
  );
}

async function sp03Summary(page: Page, kind: 'account' | 'seat' = 'account') {
  const response = await page.request.get(
    kind === 'account' ? '/api/progress/summary' : '/api/class-join/progress/summary',
  );
  await ok(response);
  expect(response.headers()['cache-control']).toContain('no-store');
  return (await response.json()) as PersonalProgressSummaryV1;
}

function sp03Number(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

async function sp03AssertGroup(page: Page, expected: OwnProgressGroupV1) {
  // Use the UUID on the article itself; no learner roster names are selectors.
  const article = page.locator(
    `[data-testid="own-progress-group"][data-group-id="${expected.groupId}"]`,
  );
  await expect(article).toBeVisible();
  await expect(article.getByRole('heading', { level: 3 })).toHaveText(expected.title);
  await expect(article.locator('header > span')).toHaveText(`${expected.periodDays} дней`);
  for (const [field, testId] of [
    ['rank', 'own-progress-rank'],
    ['score', 'own-progress-score'],
  ] as const) {
    if (expected.own[field] === null) await expect(article.getByTestId(testId)).toHaveCount(0);
    else await expect(article.getByTestId(testId)).toHaveText(sp03Number(expected.own[field]));
  }
  if (expected.own.availability === 'unavailable')
    await expect(article).toContainText('Учебный профиль нужно уточнить у преподавателя.');
  else if (expected.own.score === null && expected.own.rank === null)
    await expect(article).toContainText('Рейтинг выключен');
}

async function sp03Geometry(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const progress = page.getByTestId('personal-progress');
  await expect(progress).not.toContainText(/из\s+\d|\/\s*100|99\+/);
  const results = await progress.locator('.personal-progress-group').evaluateAll((groups) =>
    groups.map((group) => {
      const avatar = group.querySelector<HTMLElement>('.personal-progress-group-avatar')!;
      const a = avatar.getBoundingClientRect();
      const g = group.getBoundingClientRect();
      const styles = getComputedStyle(avatar);
      const rankRect = group
        .querySelector('[data-testid="own-progress-rank"]')
        ?.getBoundingClientRect();
      const scoreRect = group
        .querySelector('[data-testid="own-progress-score"]')
        ?.getBoundingClientRect();
      // Both badges intentionally overlap the avatar, but never each other.
      const badgesDisjoint =
        !rankRect ||
        !scoreRect ||
        rankRect.right <= scoreRect.left ||
        scoreRect.right <= rankRect.left ||
        rankRect.bottom <= scoreRect.top ||
        scoreRect.bottom <= rankRect.top;
      const badges = ['rank', 'score']
        .map((kind) => {
          const badge = group.querySelector<HTMLElement>(`[data-testid="own-progress-${kind}"]`);
          if (!badge) return null;
          const r = badge.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(badge);
          const text = range.getBoundingClientRect();
          return {
            kind,
            correctCorner:
              kind === 'rank'
                ? r.left + r.width / 2 < a.left + a.width / 2 &&
                  r.top + r.height / 2 < a.top + a.height / 2
                : r.left + r.width / 2 > a.left + a.width / 2 &&
                  r.top + r.height / 2 > a.top + a.height / 2,
            textInside:
              text.left >= r.left - 1 &&
              text.right <= r.right + 1 &&
              text.top >= r.top - 1 &&
              text.bottom <= r.bottom + 1,
            insideGroup:
              r.left >= g.left && r.right <= g.right && r.top >= g.top && r.bottom <= g.bottom,
            fontSize: Number.parseFloat(getComputedStyle(badge).fontSize),
          };
        })
        .filter((badge) => badge !== null);
      const unclipped = [
        ...group.querySelectorAll('h3,.personal-progress-group-note,.personal-progress-you'),
      ].every((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()].every(
          (r) =>
            r.left >= g.left - 1 &&
            r.right <= g.right + 1 &&
            r.top >= g.top - 1 &&
            r.bottom <= g.bottom + 1,
        );
      });
      return {
        badges,
        badgesDisjoint,
        unclipped,
        circle: Math.abs(a.width - a.height) < 1,
        ring:
          styles.borderTopColor === 'rgb(8, 119, 179)' &&
          Number.parseFloat(styles.borderTopWidth) >= 2 &&
          styles.boxShadow !== 'none',
      };
    }),
  );
  for (const result of results) {
    expect(result.circle).toBe(true);
    expect(result.ring).toBe(true);
    expect(result.badgesDisjoint).toBe(true);
    expect(result.unclipped).toBe(true);
    for (const badge of result.badges) {
      expect(badge.correctCorner).toBe(true);
      expect(badge.textInside).toBe(true);
      expect(badge.insideGroup).toBe(true);
      expect(badge.fontSize).toBeGreaterThanOrEqual(11);
    }
  }
  await expectNoOverflow(page);
}

async function sp03Shell(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  return page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      header: rect(document.querySelector('.portal-header')),
      sidebar: rect(document.querySelector('[aria-label="Основная навигация"]')),
      search: rect(document.querySelector('.portal-header input[type="search"]')),
    };
  });
}

async function sp03Directions(page: Page) {
  for (const module of SP03_MODULES) {
    const section = page.locator(`.creator-module-section[data-module="${module}"]`);
    await expect(section).toBeVisible();
    await expect(section.locator(`h2#creator-module-${module}`)).toBeVisible();
    await expect(section.locator('.home-create-button')).toBeVisible();
  }
}

async function sp03SeatLogin(page: Page, teacher: Page, group: Sp03Class, existingSeatId?: string) {
  let seatId = existingSeatId;
  if (!seatId) {
    const response = await teacher.request.post(`/api/classrooms/${group.id}/seats`, {
      headers: { origin: origin(teacher) },
      data: { displayLabel: 'Ученик по коду SP03', safeMode: false },
    });
    await ok(response, 201);
    seatId = (await response.json()).student.id as string;
  }
  const issued = await teacher.request.post(`/api/classrooms/${group.id}/seats/${seatId}/code`, {
    headers: { origin: origin(teacher) },
    data: { requestId: randomUUID() },
  });
  await ok(issued, 201);
  const { studentCode } = await issued.json();
  await page.goto(`/#/join-class?code=${encodeURIComponent(group.joinCode)}`);
  await page.getByLabel('Код ученика', { exact: true }).fill(studentCode);
  const loggedIn = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/class-join/studentseat' &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await loggedIn).status()).toBe(200);
  await openPortalSection(page, 'Главная');
  return seatId;
}

test('SP-03 ordinary Account joins three real groups and sees canonical own ranks, periods and responsive Home/Learning geometry', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const account = await register(
    page,
    'Александра — самостоятельный участник нескольких учебных групп',
  );
  const teacher = await sp03Teacher(browser);
  try {
    const groups: Sp03Class[] = [];
    const seats = new Map<string, string>();
    for (let index = 0; index < 3; index++) {
      const group = await sp03Class(
        teacher.page,
        `${index + 1}. Исследовательская группа ${'Длинноеназвание'.repeat(5)}`,
      );
      groups.push(group);
      seats.set(group.id, await sp03Join(page, teacher.page, group));
    }
    const initial = await sp03Summary(page);
    expect(initial.scope).toEqual({ kind: 'account', accountId: account.accountId });
    expect(initial.groups.items).toHaveLength(3);
    // Follow the server's bounded ordering; the selected UI tab is never a score context.
    const ordered = initial.groups.items!.map((item) =>
      groups.find((group) => group.id === item.groupId)!,
    );
    const fractionalGroup = ordered[0]!;
    await sp03Rating(teacher.page, fractionalGroup.id, 90, 'grades');
    await sp03Rating(teacher.page, ordered[1]!.id, 7, 'grades');
    await sp03Rating(teacher.page, ordered[2]!.id, 30, null);
    // Real journal inputs produce a five-character 68,25 score and SQL rank()
    // produces place 101. New isolated peers have a single hundred-scale grade;
    // canonical journal commands preserve revisions, links and notifications.
    // No rank/score DTO, existing lineage, or scoring function is overwritten.
    const peers = await admin.query<{ id: string }>(
      `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
       SELECT $1,$2,'Скрытое имя одногруппника '||n,'sp03peer'||n,'sp03peer'||n,false,'active',$3
       FROM generate_series(1,100) n RETURNING id`,
      [teacher.identity.tenantId, fractionalGroup.id, teacher.identity.teacherId],
    );
    expect(peers.rows).toHaveLength(100);
    await admin.query(
      'SELECT learning_audience_ensure_seat_identity(id) FROM unnest($1::uuid[]) id',
      [peers.rows.map((row) => row.id)],
    );
    await admin.query('SELECT student_seat_principal(id) FROM unnest($1::uuid[]) id', [
      peers.rows.map((row) => row.id),
    ]);
    const journalActor = await admin.query<{ principal_id: string; today: string }>(
      "SELECT principal_id,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') today FROM legacy_user_account_links WHERE user_id=$1",
      [teacher.identity.teacherId],
    );
    expect(journalActor.rows).toHaveLength(1);
    const journalWrite = async (action: string, input: Record<string, unknown>) => {
      const result = await admin.query<{ value: Record<string, unknown> }>(
        'SELECT classroom_journal_write($1,$2,$3,$4::jsonb) AS value',
        [
          journalActor.rows[0]!.principal_id,
          fractionalGroup.id,
          action,
          JSON.stringify({ requestId: randomUUID(), ...input }),
        ],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.value).not.toHaveProperty('error');
      return result.rows[0]!.value;
    };
    expect(await journalWrite('scale', { preset: 'hundred', expectedRevision: 0 })).toEqual({
      preset: 'hundred',
      version: 1,
    });
    const gradeColumns: string[] = [];
    for (const [index, value] of [68, 68, 68, 69].entries()) {
      const column = await journalWrite('column', {
        expectedRevision: 1,
        date: journalActor.rows[0]!.today,
        category: `Проверка учебного результата SP03 ${index + 1}`,
      });
      expect(column.id).toMatch(UUID);
      gradeColumns.push(String(column.id));
      expect(
        await journalWrite('grade', {
          expectedRevision: 0,
          columnId: column.id,
          seatId: seats.get(fractionalGroup.id),
          value,
          reason: null,
        }),
      ).toMatchObject({ value, revision: 1, seatId: seats.get(fractionalGroup.id) });
    }
    const peerGrades = await admin.query<{ value: { value: number; revision: number } }>(
      `SELECT classroom_journal_write($1,$2,'grade',jsonb_build_object(
         'requestId',gen_random_uuid()::text,'expectedRevision',0,'columnId',$3::text,
         'seatId',seat_id::text,'value',100,'reason',NULL)) AS value
       FROM unnest($4::uuid[]) seat_id`,
      [
        journalActor.rows[0]!.principal_id,
        fractionalGroup.id,
        gradeColumns[0],
        peers.rows.map((row) => row.id),
      ],
    );
    expect(peerGrades.rows).toHaveLength(100);
    for (const grade of peerGrades.rows)
      expect(grade.value).toMatchObject({ value: 100, revision: 1 });
    const summary = await sp03Summary(page);
    const items = summary.groups.items!;

    // SP-04: one genuine SQL rating for the same authenticated Account/group;
    // do not assert against mocked JSON, hidden roster or teacher projection.
    const ratingUrl = `/api/progress/groups/${fractionalGroup.id}/rating`;
    const bounded = await page.request.get(`${ratingUrl}?view=preview&limit=5`);
    await ok(bounded);
    expect(bounded.headers()['cache-control']).toContain('no-store');
    const previewRating = (await bounded.json()) as GroupRatingPageV1;
    expect(previewRating.groupId).toBe(fractionalGroup.id);
    expect(previewRating.own).toEqual({
      availability: 'available',
      score: 68.25,
      rank: 101,
      isSelf: true,
    });
    expect(previewRating.periodDays).toBe(90);
    expect(previewRating.peers).toHaveLength(5);
    expect(previewRating.peers.every((peer) => peer.score === 100 && peer.rank === 1)).toBe(true);
    for (const peer of previewRating.peers) {
      expect(Object.keys(peer).sort()).toEqual(
        ['peerKey', 'avatarSrc', 'avatarTicket', 'score', 'rank', 'isSelf'].sort(),
      );
      expect(peer.isSelf).toBe(false);
      expect(peer.peerKey.length).toBe(27);
      expect(peer.avatarSrc).toMatch(/^\/assets\/avatars\/default\/avatar-\d{2}\.webp$/);
    }
    const serialized = JSON.stringify(previewRating);
    for (const row of peers.rows) expect(serialized).not.toContain(row.id);
    expect(serialized).not.toMatch(
      /"(?:displayName|displayLabel|studentCode|email|lastActiveAt|grades|factors|sources|seatId|tenantId|teacherRoster|totalWorks)"\s*:/,
    );
    let cursor: string | null = null;
    const seenPeers = new Set<string>();
    let pages = 0;
    let firstFull: GroupRatingPageV1 | null = null;
    do {
      const url = `${ratingUrl}?view=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await page.request.get(url);
      await ok(response);
      expect(response.headers()['cache-control']).toContain('no-store');
      const next = (await response.json()) as GroupRatingPageV1;
      firstFull ??= next;
      expect(next.version).toBe(previewRating.version);
      expect(next.own.rank).toBe(101);
      expect(next.peers.length).toBeGreaterThan(0);
      expect(next.peers.length).toBeLessThanOrEqual(20);
      for (const peer of next.peers) {
        expect(seenPeers.has(peer.peerKey)).toBe(false);
        seenPeers.add(peer.peerKey);
      }
      cursor = next.nextCursor;
      expect(next.hasMore).toBe(cursor !== null);
      if (cursor) {
        expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(Buffer.from(cursor, 'base64url').toString('utf8')).not.toContain(peers.rows[0]!.id);
      }
      pages += 1;
      expect(pages).toBeLessThanOrEqual(6);
    } while (cursor);
    expect(pages).toBe(5);
    expect(seenPeers.size).toBe(100);
    expect(firstFull!.peers.map((peer) => peer.peerKey).slice(0, 5)).toEqual(
      previewRating.peers.map((peer) => peer.peerKey),
    );
    const foreignGroup = await page.request.get(
      `/api/progress/groups/${randomUUID()}/rating?view=preview`,
    );
    expect(foreignGroup.status()).toBe(403);
    const badTicket = await page.request.post(
      `/api/progress/groups/${fractionalGroup.id}/avatars`,
      {
        headers: { origin: origin(page) },
        data: { tickets: [Buffer.from(peers.rows[0]!.id).toString('base64url')] },
      },
    );
    expect(badTicket.status()).toBe(400);
    const anonymous = await browser.newContext({ baseURL: origin(page) });
    try {
      expect((await anonymous.request.get(`${ratingUrl}?view=preview`)).status()).toBe(401);
    } finally {
      await anonymous.close();
    }
    expect(items[0]!.own).toEqual({ availability: 'available', score: 68.25, rank: 101 });
    expect(sp03Number(items[0]!.own.score!)).toBe('68,25');
    expect(items[1]!.own).toEqual({ availability: 'available', score: 0, rank: 1 });
    expect(items[2]!.own).toEqual({ availability: 'available', score: null, rank: null });
    for (const group of items) {
      const canonical = await admin.query<{ item: { score: number | null; rank: number | null } }>(
        "SELECT item FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2",
        [group.groupId, seats.get(group.groupId)],
      );
      expect(group.own).toMatchObject({
        score: canonical.rows[0]!.item.score,
        rank: canonical.rows[0]!.item.rank,
      });
    }
    for (const width of SP03_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/home');
      await expect(page.getByTestId('own-progress-group')).toHaveCount(2);
      for (const group of items.slice(0, 2)) await sp03AssertGroup(page, group);
      await expect(page.getByTestId('personal-progress')).not.toContainText(
        'Скрытое имя одногруппника',
      );
      await sp03Geometry(page);
      // SP-04: the initial DOM contains exactly the server-bounded peer slice,
      // never a hidden 100-person roster or peer names in alt/ARIA/tooltips.
      const firstGroup = page.locator(
        `[data-testid="own-progress-group"][data-group-id="${fractionalGroup.id}"]`,
      );
      const groupWidth = await firstGroup.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      const expectedLimit = groupWidth <= 380 ? 2 : groupWidth <= 520 ? 3 : 5;
      await expect(firstGroup.locator('.personal-progress-peer')).toHaveCount(expectedLimit);
      await expect(firstGroup.getByTestId('own-progress-rank')).toHaveText('101');
      await expect(firstGroup.getByTestId('own-progress-score')).toHaveText('68,25');
      const peerDom = await firstGroup
        .locator('.personal-progress-peers')
        .evaluate((element) => element.outerHTML);
      expect(peerDom).not.toMatch(
        /displayName|displayLabel|studentCode|lastActiveAt|seatId|teacherRoster/,
      );
      for (const row of peers.rows) expect(peerDom).not.toContain(row.id);
      await page.screenshot({ path: `${EVIDENCE}/sp04-account-home-${width}.png`, fullPage: true });
      const allButton = firstGroup.getByRole('button', { name: 'Все', exact: true });
      await allButton.focus();
      await page.keyboard.press('Enter');
      const ratingDialog = page.getByRole('dialog', { name: new RegExp('Рейтинг группы') });
      await expect(ratingDialog).toBeVisible();
      await expect(
        ratingDialog.locator('.personal-progress-rating-items .personal-progress-peer'),
      ).toHaveCount(20);
      await expect(ratingDialog.locator('.personal-progress-rating-pinned')).toContainText('101');
      await expect(ratingDialog).not.toContainText('sp03peer');
      await ratingDialog.screenshot({ path: `${EVIDENCE}/sp04-account-all-${width}.png` });
      const closedByKeyboard = width === 320;
      if (closedByKeyboard) await page.keyboard.press('Escape');
      else await ratingDialog.getByRole('button', { name: 'Закрыть' }).click();
      await expect(ratingDialog).toHaveCount(0);
      await expect(allButton).toBeFocused();
      const shell = await sp03Shell(page);
      const allGroups = page
        .getByTestId('personal-progress')
        .getByRole('link', { name: 'Все группы', exact: true });
      await allGroups.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(allGroups).toBeFocused();
      const focus = await allGroups.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          visible:
            (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
            style.boxShadow !== 'none',
        };
      });
      expect(focus).toEqual({ inside: true, visible: true });
      await page.screenshot({ path: `${EVIDENCE}/sp03-account-home-${width}.png`, fullPage: true });
      await allGroups.click();
      await expect(page).toHaveURL(/#\/learning$/);
      await expect(page.getByTestId('own-progress-group')).toHaveCount(3);
      for (const group of items) await sp03AssertGroup(page, group);
      await sp03Geometry(page);
      expect(await sp03Shell(page)).toEqual(shell);
      await page.screenshot({
        path: `${EVIDENCE}/sp03-account-learning-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/#/home');
    await expect(page.getByTestId('own-progress-rank').first()).toHaveText('101');
    await expect(page.getByTestId('own-progress-score').first()).toHaveText('68,25');
    for (const width of [380, 381, 520, 521]) {
      await page.getByTestId('personal-progress').evaluate((element, size) => {
        (element as HTMLElement).style.width = `${size}px`;
      }, width);
      await expect
        .poll(
          async () =>
            (await page.locator('.personal-progress-group-avatar').first().boundingBox())?.width,
        )
        .toBe(width <= 380 ? 44 : width <= 520 ? 54 : 68);
      // A real container breakpoint changes the server request limit; CSS
      // must not conceal additional participant rows in the DOM.
      await expect(
        page.locator(
          `[data-testid="own-progress-group"][data-group-id="${fractionalGroup.id}"] .personal-progress-peers .personal-progress-peer`,
        ),
      ).toHaveCount(width <= 380 ? 2 : width <= 520 ? 3 : 5);
      await sp03Geometry(page);
      await page
        .getByTestId('personal-progress')
        .screenshot({ path: `${EVIDENCE}/sp03-progress-container-${width}.png` });
    }
    await page.getByTestId('personal-progress').evaluate((element) => {
      (element as HTMLElement).style.removeProperty('width');
    });
    // Real Chromium layout at 200% CSS zoom, explicitly not a native browser-toolbar claim.
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('2');
    await sp03Geometry(page);
    await sp03Shell(page);
    await page.screenshot({ path: `${EVIDENCE}/sp03-account-css-zoom-200.png`, fullPage: true });
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('zoom');
    });

    const learner = await admin.query<{ learner_identity_id: string }>(
      "SELECT learner_identity_id FROM learner_identity_links WHERE link_kind='student_seat' AND seat_id=$1 AND status='active' AND disabled_at IS NULL",
      [seats.get(fractionalGroup.id)],
    );
    expect(learner.rows).toHaveLength(1);
    const handle = randomUUID().slice(0, 8);
    const ambiguousSeat = await admin.query<{ id: string }>(
      `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by,account_id)
       VALUES($1,$2,'Дополнительное учебное место',$3,$3,false,'active',$4,NULL) RETURNING id`,
      [teacher.identity.tenantId, fractionalGroup.id, handle, teacher.identity.teacherId],
    );
    await admin.query(
      `INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
       VALUES(gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
      [
        teacher.identity.tenantId,
        teacher.identity.schoolId,
        learner.rows[0]!.learner_identity_id,
        ambiguousSeat.rows[0]!.id,
      ],
    );
    const partial = await sp03Summary(page);
    expect(partial.availability).toBe('partial');
    expect(partial.groups.items![0]!.own).toEqual({
      availability: 'unavailable',
      score: null,
      rank: null,
      reason: 'ambiguous_self_participant',
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.reload();
    await sp03AssertGroup(page, partial.groups.items![0]!);
    await sp03AssertGroup(page, partial.groups.items![1]!);
    await sp03Geometry(page);
    await page.screenshot({ path: `${EVIDENCE}/sp03-account-ambiguous-320.png`, fullPage: true });
  } finally {
    await teacher.context.close();
  }
});

test('SP-03 school-free Account sees durable publication feedback, complete copy provenance and four independent creation directions', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const authorLabel = 'Автор инженерной работы с полным длинным именем';
  const account = await register(page, authorLabel);
  const reader = await contextPage(browser, 'Читатель и самостоятельный создатель SP03');
  const sourceIds: string[] = [];
  const acquisition = await admin.query<{ enabled: boolean }>(
    'SELECT enabled FROM publication_acquisition_settings WHERE singleton_key',
  );
  expect(acquisition.rows).toHaveLength(1);
  try {
    await page.goto('/#/home');
    const empty = await sp03Summary(page);
    expect(empty.scope).toEqual({ kind: 'account', accountId: account.accountId });
    expect(empty.groups.items).toEqual([]);
    for (const name of ['everPublishedWorks', 'currentLikes', 'createdCopies'] as const) {
      expect(empty.metrics[name]).toEqual({ availability: 'available', value: 0 });
      await expect(page.getByTestId(`progress-${name}`).locator('dd')).toHaveText('0');
    }
    await expect(page.getByTestId('own-progress-group')).toHaveCount(0);
    await expect(
      page.getByTestId('personal-progress').getByRole('link', { name: 'Все группы' }),
    ).toHaveCount(0);
    await sp03Directions(page);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: `${EVIDENCE}/sp03-school-free-empty-320.png`, fullPage: true });

    // Drop only the first *real* committed creation response. The existing QPC
    // retry must use the same key and return the same project, not add a second.
    let lostProject: string | null = null;
    const creationKeys: string[] = [];
    let dropCreation = true;
    const creationRoute = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      creationKeys.push(route.request().headers()['idempotency-key'] ?? '');
      if (!dropCreation) return route.continue();
      dropCreation = false;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      lostProject = (await committed.json()).project.id as string;
      await route.abort('failed');
    };
    await page.route('**/api/projects', creationRoute);
    await page
      .locator('.creator-module-section[data-module="electronics"] .home-create-button')
      .click();
    await expect(page.locator('.portal-create-notice')).toContainText('Ответ сервера не получен');
    const retry = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/projects' && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Продолжить создание', exact: true }).click();
    const replay = await retry;
    expect([200, 201]).toContain(replay.status());
    expect((await replay.json()).project.id).toBe(lostProject);
    expect(creationKeys).toHaveLength(2);
    expect(creationKeys[0]).toMatch(UUID);
    expect(creationKeys[1]).toBe(creationKeys[0]);
    await page.unroute('**/api/projects', creationRoute);
    const oneProject = await page.request.get(
      '/api/projects?scope=personal&module=electronics&limit=10',
    );
    await ok(oneProject);
    expect((await oneProject.json()).items).toHaveLength(1);
    await page.goto('/#/home');
    const image = await raster(page, 'SP03');
    const sourceTitle = `Исследование ${'длинноеназваниеисточника'.repeat(6)}`;
    const source = await createProject(page, sourceTitle, image, 'three-d');
    sourceIds.push(source);
    const published = await publish(page, source, { license: 'public-domain' });
    const historical = await createProject(
      page,
      'Работа с сохранённой историей публикации SP03',
      image,
    );
    sourceIds.push(historical);
    await publish(page, historical);
    await ok(
      await page.request.delete(`/api/projects/${historical}/publication`, {
        headers: { origin: origin(page) },
      }),
    );
    await admin.query(
      'UPDATE publication_acquisition_settings SET enabled=true WHERE singleton_key',
    );
    await ok(
      await page.request.post(`/api/projects/${source}/publication/acquisition`, {
        headers: { origin: origin(page) },
        data: { allowed: true, expectedVersion: 0, expectedRevisionId: published.revisionId },
      }),
    );
    await ok(
      await reader.page.request.put(`/api/public-projects/${published.publicationId}/like`, {
        headers: { origin: origin(reader.page) },
        data: { revisionId: published.revisionId, on: true },
      }),
    );
    const copyKey = randomUUID();
    const copy = () =>
      reader.page.request.post(`/api/public-projects/${published.publicationId}/copy`, {
        headers: { origin: origin(reader.page), 'idempotency-key': copyKey },
        data: { revisionId: published.revisionId },
      });
    const first = await copy();
    expect([200, 201]).toContain(first.status());
    const copied = await first.json();
    expect(copied).toMatchObject({ moduleKey: 'three-d', created: true });
    const second = await copy();
    expect([200, 201]).toContain(second.status());
    expect(await second.json()).toMatchObject({ projectId: copied.projectId, created: false });
    const actual = await sp03Summary(page);
    expect(actual.metrics.everPublishedWorks).toEqual({ availability: 'available', value: 2 });
    expect(actual.metrics.currentLikes).toEqual({ availability: 'available', value: 1 });
    expect(actual.metrics.createdCopies).toEqual({ availability: 'available', value: 1 });
    expect(actual.metrics.activePublicWorks).toEqual({ availability: 'available', value: 1 });
    await page.reload();
    for (const [metric, value] of [
      ['everPublishedWorks', '2'],
      ['currentLikes', '1'],
      ['createdCopies', '1'],
    ] as const)
      await expect(page.getByTestId(`progress-${metric}`).locator('dd')).toHaveText(value);
    await expect(page.getByTestId('progress-createdCopies').locator('dd')).toHaveAttribute(
      'aria-label',
      'Копии ваших работ: 1',
    );
    await expect(page.getByTestId('personal-progress')).not.toContainText(/скачиван/i);
    await page.getByTestId('personal-progress').getByText('О показателях', { exact: true }).click();
    await expect(page.getByTestId('personal-progress')).toContainText(
      'Общий рейтинг ещё не рассчитывается.',
    );
    await page.screenshot({
      path: `${EVIDENCE}/sp03-real-publication-metrics-320.png`,
      fullPage: true,
    });
    const privateCopy = await reader.page.request.get(`/api/projects/${copied.projectId}`);
    await ok(privateCopy);
    expect((await privateCopy.json()).project.copiedFrom).toMatchObject({
      title: sourceTitle,
      author: authorLabel,
    });
    for (const width of [1440, 320]) {
      await reader.page.setViewportSize({ width, height: 900 });
      await reader.page.goto('/#/home');
      const provenance = reader.page.locator(
        '.creator-module-section[data-module="three-d"] .project-card-origin',
      );
      await expect(provenance).toHaveText(`Копия работы «${sourceTitle}», автор ${authorLabel}`);
      expect(
        await provenance.evaluate((element) => {
          const r = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()].every(
            (text) =>
              text.left >= r.left - 1 &&
              text.right <= r.right + 1 &&
              text.top >= r.top - 1 &&
              text.bottom <= r.bottom + 1,
          );
        }),
      ).toBe(true);
      await expectNoOverflow(reader.page);
      await reader.page.screenshot({
        path: `${EVIDENCE}/sp03-copy-provenance-${width}.png`,
        fullPage: true,
      });
    }

    // Negative network faults only: the app must retain four directions and
    // distinguish an unavailable count from the genuine zero checked above.
    const fail = (route: import('@playwright/test').Route) => route.abort('failed');
    await page.route('**/api/progress/summary*', fail);
    await page.route('**/api/account/avatar', fail);
    await page.route('**/api/modules', fail);
    await page.route('**/api/projects?*', fail);
    await page.reload();
    await expect(page.getByTestId('personal-progress')).toContainText(
      'Не удалось загрузить прогресс.',
    );
    for (const metric of ['everPublishedWorks', 'currentLikes', 'createdCopies'])
      await expect(page.getByTestId(`progress-${metric}`).locator('dd')).toHaveText('—');
    await sp03Directions(page);
    await expect(page.locator('.creator-module-section .home-module-error')).toHaveCount(4);
    await expect(page.locator('.creator-module-section .home-create-button:disabled')).toHaveCount(
      4,
    );
    const fallback = page.locator('.personal-progress-hero-avatar img');
    await expect(fallback).toHaveAttribute('src', /^\/assets\/avatars\/default\/avatar-\d+\.webp$/);
    await expect
      .poll(() =>
        fallback.evaluate(
          (image) =>
            (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `${EVIDENCE}/sp03-independent-errors-avatar-fallback-320.png`,
      fullPage: true,
    });
    await page.unroute('**/api/projects?*', fail);
    for (const section of await page.locator('.creator-module-section').all())
      await section.locator('.home-module-error button').click();
    await expect(page.locator('.creator-module-section .home-module-error')).toHaveCount(0);
    await expect(page.locator('.creator-module-section[data-module="three-d"]')).toContainText(
      sourceTitle,
    );
    await expect(page.locator('.creator-module-section .home-create-button:disabled')).toHaveCount(
      4,
    );
    await page.screenshot({
      path: `${EVIDENCE}/sp03-own-projects-creation-unavailable-320.png`,
      fullPage: true,
    });
    await page.unroute('**/api/progress/summary*', fail);
    await page.unroute('**/api/account/avatar', fail);
    await page.unroute('**/api/modules', fail);
    await page.getByRole('button', { name: 'Повторить загрузку прогресса', exact: true }).click();
    await page
      .locator('.portal-create-notice')
      .getByRole('button', { name: 'Повторить', exact: true })
      .click();
    await expect(page.getByTestId('progress-createdCopies').locator('dd')).toHaveText('1');
    await expect(
      page.locator('.creator-module-section[data-module="electronics"] .home-create-button'),
    ).toBeEnabled();
    await sp03Directions(page);
  } finally {
    for (const id of sourceIds)
      await page.request.delete(`/api/projects/${id}/publication`, {
        headers: { origin: origin(page) },
      });
    await admin.query(
      'UPDATE publication_acquisition_settings SET enabled=$1 WHERE singleton_key',
      [acquisition.rows[0]!.enabled],
    );
    await reader.context.close();
  }
});

test('SP-03 StudentSeat code login shows only Seat progress and preserves existing work when creation availability fails', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const teacher = await sp03Teacher(browser);
  const linked = await contextPage(browser, 'Личный аккаунт с отдельной публичной работой');
  let accountSource: string | null = null;
  try {
    const group = await sp03Class(teacher.page, 'Учебная группа входа по коду SP03');
    const seatId = await sp03Join(linked.page, teacher.page, group);
    await sp03Rating(teacher.page, group.id, 7, 'grades');
    accountSource = await createProject(
      linked.page,
      'Работа только личного аккаунта',
      await raster(linked.page, 'PRIVATE ACCOUNT'),
    );
    await publish(linked.page, accountSource);
    expect((await sp03Summary(linked.page)).metrics.everPublishedWorks).toEqual({
      availability: 'available',
      value: 1,
    });
    const forbiddenAccountReads: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/progress/summary')
        forbiddenAccountReads.push(request.method());
    });
    expect(await sp03SeatLogin(page, teacher.page, group, seatId)).toBe(seatId);
    const summary = await sp03Summary(page, 'seat');
    expect(summary.scope).toEqual({ kind: 'seat', seatId, classroomId: group.id });
    expect(summary.groups.items).toHaveLength(1);
    expect(summary.groups.items![0]!.own).toEqual({ availability: 'available', score: 0, rank: 1 });
    // SP-04: StudentSeat has its own authenticated route and never adopts
    // linked Account privileges even if the Account owns private publications.
    const seatRatingResponse = await page.request.get(
      `/api/class-join/progress/groups/${group.id}/rating?view=preview&limit=5`,
    );
    await ok(seatRatingResponse);
    expect(seatRatingResponse.headers()['cache-control']).toContain('no-store');
    const seatRating = (await seatRatingResponse.json()) as GroupRatingPageV1;
    expect(seatRating.groupId).toBe(group.id);
    expect(seatRating.periodDays).toBe(7);
    expect(seatRating.own).toEqual({
      availability: 'available',
      score: 0,
      rank: 1,
      isSelf: true,
    });
    expect(seatRating.peers).toEqual([]);
    expect((await page.request.get(`/api/progress/groups/${group.id}/rating`)).status()).toBe(401);
    expect(
      (
        await page.request.get(
          `/api/class-join/progress/groups/${randomUUID()}/rating?view=preview`,
        )
      ).status(),
    ).toBe(403);
    for (const name of ['everPublishedWorks', 'currentLikes', 'createdCopies'] as const)
      expect(summary.metrics[name]).toEqual({ availability: 'available', value: 0 });
    for (const width of SP03_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/home');
      await sp03AssertGroup(page, summary.groups.items![0]!);
      await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('0');
      await expect(page.locator('.creator-module-feed')).not.toContainText(
        'Работа только личного аккаунта',
      );
      await sp03Directions(page);
      await sp03Geometry(page);
      await sp03Shell(page);
      await page.screenshot({ path: `${EVIDENCE}/sp03-seat-home-${width}.png`, fullPage: true });
      await page.goto('/#/learning');
      await expect(page.getByTestId('own-progress-group')).toHaveCount(1);
      await sp03AssertGroup(page, summary.groups.items![0]!);
      await expect(page.getByTestId('personal-progress')).toHaveAccessibleName(
        'Прогресс в группах',
      );
      await sp03Geometry(page);
      await sp03Shell(page);
      await page.screenshot({
        path: `${EVIDENCE}/sp03-seat-learning-${width}.png`,
        fullPage: true,
      });
    }
    await page.goto('/#/home');
    const seatTitle = 'Сохранённая собственная схема ученика SP03';
    await createProject(page, seatTitle, await raster(page, 'SEAT'));
    await sp03Rating(teacher.page, group.id, 30, null);
    const disabled = await sp03Summary(page, 'seat');
    expect(disabled.groups.items![0]!.own).toEqual({
      availability: 'available',
      score: null,
      rank: null,
    });
    await page.route('**/api/modules', (route) => route.abort('failed'));
    await page.reload();
    await sp03AssertGroup(page, disabled.groups.items![0]!);
    await expect(page.locator('.creator-module-section[data-module="electronics"]')).toContainText(
      seatTitle,
    );
    await expect(page.locator('.creator-module-section .home-create-button:disabled')).toHaveCount(
      4,
    );
    await expect(page.locator('.creator-module-feed')).not.toContainText(
      'Работа только личного аккаунта',
    );
    await sp03Directions(page);
    expect(forbiddenAccountReads).toEqual([]);
    await page.screenshot({
      path: `${EVIDENCE}/sp03-seat-disabled-rating-existing-work-320.png`,
      fullPage: true,
    });
  } finally {
    if (accountSource)
      await linked.page.request.delete(`/api/projects/${accountSource}/publication`, {
        headers: { origin: origin(linked.page) },
      });
    await linked.context.close();
    await teacher.context.close();
  }
});

async function sp03SignIn(page: Page, account: Sp03Account) {
  // Hash navigation preserves the mounted document and its retired caches.
  await page.evaluate(() => {
    location.hash = '#/sign-in';
  });
  await page.getByLabel('Почта или логин').fill(account.email);
  await page.getByLabel('Пароль', { exact: true }).fill(account.password);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const login = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await login).status()).toBe(200);
  expect((await (await page.request.get('/api/auth/me')).json()).user.id).toBe(account.accountId);
}

async function sp03Logout(page: Page) {
  await openAccountMenu(page);
  await accountMenu(page).getByRole('button', { name: 'Выход', exact: true }).click();
  await expect(page.getByTestId('personal-progress')).toHaveCount(0);
  await expect(page.locator('.creator-module-feed')).toHaveCount(0);
}

async function sp03HoldPrivateResponses(page: Page) {
  // CDP pauses the existing server response; continueResponse forwards the
  // exact original bytes. This never manufactures a successful DTO or auth.
  const cdp = await page.context().newCDPSession(page);
  const held: Array<{ id: string; path: string }> = [];
  let holding = true;
  const errors: string[] = [];
  const resume = async (id: string) => {
    try {
      await cdp.send('Fetch.continueResponse', { requestId: id });
    } catch (error) {
      // A retired AbortController can legitimately cancel a paused response.
      if (
        !/Invalid InterceptionId|Invalid interception|Invalid requestId|No resource with given identifier/i.test(
          String(error),
        )
      )
        errors.push(String(error));
    }
  };
  cdp.on('Fetch.requestPaused', (event) => {
    if (holding && event.request.method === 'GET')
      held.push({ id: event.requestId, path: new URL(event.request.url).pathname });
    else void resume(event.requestId);
  });
  await cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*/api/progress/summary*', requestStage: 'Response' },
      { urlPattern: '*/api/projects?*', requestStage: 'Response' },
      { urlPattern: '*/api/account/avatar', requestStage: 'Response' },
    ],
  });
  return {
    ready: async () => {
      await expect
        .poll(() => held.some((item) => item.path === '/api/progress/summary'))
        .toBe(true);
    },
    release: async () => {
      holding = false;
      for (const item of held) await resume(item.id);
      await cdp.send('Fetch.disable');
      await cdp.detach();
      expect(errors).toEqual([]);
    },
  };
}

async function sp03HoldOldSummary(page: Page, expectedAccountId: string) {
  // A response-stage event alone is not proof of an available HTTP body:
  // Chromium may already have aborted the speculative first summary request.
  // Keep only the first response whose *original intercepted bytes* were read
  // successfully and whose account scope matches the old logged-in actor.
  const cdp = await page.context().newCDPSession(page);
  type HeldSummary = {
    id: string;
    networkId: string;
    status: number;
    body: PersonalProgressSummaryV1;
  };
  let held: HeldSummary | null = null;
  const terminal = new Map<string, 'delivered' | 'transport_aborted'>();
  const errors: string[] = [];
  const bodyFailures: { networkId: string | undefined; message: string }[] = [];
  const continuationFailures: { networkId: string | undefined; message: string }[] = [];
  const pendingBodies: Promise<void>[] = [];
  const pendingContinuations: Promise<void>[] = [];
  const invalidInterception =
    /Invalid InterceptionId|Invalid interception|Invalid requestId|No resource with given identifier/i;

  const continueUnselected = (id: string, networkId: string | undefined) => {
    const continuation = cdp.send('Fetch.continueResponse', { requestId: id }).then(
      () => undefined,
      (error: unknown) => {
        continuationFailures.push({ networkId, message: String(error) });
      },
    );
    pendingContinuations.push(continuation);
  };
  cdp.on('Network.loadingFinished', (event) => terminal.set(event.requestId, 'delivered'));
  cdp.on('Network.loadingFailed', (event) => {
    if (event.canceled || event.errorText === 'net::ERR_ABORTED')
      terminal.set(event.requestId, 'transport_aborted');
  });
  cdp.on('Fetch.requestPaused', (event) => {
    if (held || event.request.method !== 'GET' || event.responseStatusCode !== 200) {
      continueUnselected(event.requestId, event.networkId);
      return;
    }
    const id = event.requestId;
    const networkId = event.networkId;
    // Multiple real GETs can be in flight at the same time. Read each
    // response-stage body at once and select only the first valid result.
    // Do not claim that an already canceled interception was ever held.
    const bodyAttempt = cdp.send('Fetch.getResponseBody', { requestId: id }).then(
      (body) => {
        try {
          const summary = JSON.parse(
            body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body,
          ) as PersonalProgressSummaryV1;
          if (
            !networkId ||
            summary.scope.kind !== 'account' ||
            summary.scope.accountId !== expectedAccountId
          ) {
            errors.push('An intercepted response did not belong to the verified old Account');
            continueUnselected(id, networkId);
            return;
          }
          if (held) {
            continueUnselected(id, networkId);
          } else {
            held = { id, networkId, status: event.responseStatusCode!, body: summary };
          }
        } catch (error) {
          errors.push(String(error));
          continueUnselected(id, networkId);
        }
      },
      (error: unknown) => {
        bodyFailures.push({ networkId, message: String(error) });
        continueUnselected(id, networkId);
      },
    );
    pendingBodies.push(bodyAttempt);
  });
  await cdp.send('Network.enable');
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/progress/summary*', requestStage: 'Response' }],
  });
  return {
    ready: async () => {
      await expect.poll(() => held !== null).toBe(true);
      const response = held!;
      expect(response.status).toBe(200);
      expect(response.networkId).toBeTruthy();
      expect(response.body.scope).toEqual({ kind: 'account', accountId: expectedAccountId });
      return response.body;
    },
    release: async () => {
      try {
        await Promise.all(pendingBodies);
        if (!held) throw new Error('No genuine readable old Account response was intercepted');
        const response = held;
        try {
          await cdp.send('Fetch.continueResponse', { requestId: response.id });
        } catch (error) {
          // An invalid interception ID alone is not proof of cancellation.
          // Require the *same* Network request's canceled terminal event.
          if (!invalidInterception.test(String(error))) throw error;
          await expect.poll(() => terminal.get(response.networkId)).toBe('transport_aborted');
        }
        await expect.poll(() => terminal.has(response.networkId)).toBe(true);
        await Promise.all(pendingContinuations);
        for (const failure of [...bodyFailures, ...continuationFailures]) {
          if (invalidInterception.test(failure.message) && failure.networkId) {
            await expect.poll(() => terminal.get(failure.networkId!)).toBe('transport_aborted');
          } else {
            errors.push(failure.message);
          }
        }
        expect(errors).toEqual([]);
        return terminal.get(response.networkId)!;
      } finally {
        await cdp.send('Fetch.disable');
        await cdp.detach();
      }
    },
  };
}

test('SP-03 private Home clears across workspace, actor and same-ID logout/relogin before real fresh responses arrive', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await register(page, 'Первый личный автор SP03');
  const other = await contextPage(browser, 'Второй личный автор SP03');
  const title = `Личная работа первого автора ${randomUUID().slice(0, 8)}`;
  const source = await createProject(page, title, await raster(page, 'FIRST'));
  await publish(page, source);
  let pending: Awaited<ReturnType<typeof sp03HoldPrivateResponses>> | null = null;
  let oldResponse: Awaited<ReturnType<typeof sp03HoldOldSummary>> | null = null;
  try {
    // A real second workspace uses the existing account-c1 fixture shape.
    const tenant = await admin.query<{ id: string }>(
      'INSERT INTO tenants(title,workspace_slug) VALUES($1,$2) RETURNING id',
      ['Организация SP03', `sp03-${randomUUID()}`],
    );
    const workspace = await admin.query<{ id: string }>(
      "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization','Рабочая группа SP03') RETURNING id",
      [tenant.rows[0]!.id],
    );
    await admin.query(
      "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'educator')",
      [account.accountId, workspace.rows[0]!.id],
    );
    await page.goto('/#/home');
    await page.reload();
    await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('1');
    await expect(page.locator('.creator-module-feed')).toContainText(title);
    const stamp = randomUUID();
    await page.evaluate((value) => {
      (window as Window & { sp03Document?: string }).sp03Document = value;
    }, stamp);
    pending = await sp03HoldPrivateResponses(page);
    await switchWorkspace(page, 'Рабочая группа SP03');
    await pending.ready();
    await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('—');
    await expect(page.locator('.creator-module-feed')).not.toContainText(title);
    await page.screenshot({
      path: `${EVIDENCE}/sp03-workspace-private-pending-1440.png`,
      fullPage: true,
    });
    await pending.release();
    pending = null;
    // Account-wide publication history may legitimately survive a workspace
    // switch, but only from a fresh, verified response; project lists may not.
    await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('1');
    await expect(page.locator('.creator-module-feed')).not.toContainText(title);
    await switchWorkspace(page, PERSONAL_WORKSPACE);
    await expect(page.locator('.creator-module-feed')).toContainText(title);
    await sp03Logout(page);
    pending = await sp03HoldPrivateResponses(page);
    await sp03SignIn(page, account);
    await pending.ready();
    expect(
      await page.evaluate(() => (window as Window & { sp03Document?: string }).sp03Document),
    ).toBe(stamp);
    await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('—');
    await expect(page.locator('.creator-module-feed')).not.toContainText(title);
    await page.screenshot({
      path: `${EVIDENCE}/sp03-same-account-new-lifetime-pending-1440.png`,
      fullPage: true,
    });
    await pending.release();
    pending = null;
    await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('1');
    await expect(page.locator('.creator-module-feed')).toContainText(title);

    oldResponse = await sp03HoldOldSummary(page, account.accountId);
    await page.evaluate(() => {
      location.hash = '#/learning';
    });
    const oldSummary = await oldResponse.ready();
    expect(oldSummary.scope).toEqual({ kind: 'account', accountId: account.accountId });
    expect(oldSummary.metrics.everPublishedWorks).toEqual({
      availability: 'available',
      value: 1,
    });
    // Logout happens only after the old response exists. New login responses
    // pass unchanged while those actual old bytes remain paused (or are aborted).
    await sp03Logout(page);
    await sp03SignIn(page, other.account!);
    await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('0');
    await expect(page.locator('.creator-module-feed')).not.toContainText(title);
    await expect(page.locator('.personal-progress-person')).toHaveText('Второй личный автор SP03');
    const freshSummary = await sp03Summary(page);
    expect(freshSummary.scope).toEqual({ kind: 'account', accountId: other.account!.accountId });
    expect(freshSummary.metrics.everPublishedWorks).toEqual({
      availability: 'available',
      value: 0,
    });
    const retiringResponse = oldResponse;
    oldResponse = null;
    const retirement = await retiringResponse.release();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByTestId('progress-everPublishedWorks').locator('dd')).toHaveText('0');
    await expect(page.locator('.creator-module-feed')).not.toContainText(title);
    await expect(page.locator('.personal-progress-person')).toHaveText('Второй личный автор SP03');
    await test.info().attach('sp03-old-summary-retirement', {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          oldActorVerifiedBeforeLogout: true,
          newActorVerifiedBeforeRelease: true,
          retirement,
        }),
      ),
    });
    await page.screenshot({
      path: `${EVIDENCE}/sp03-old-response-retired-1440.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => (window as Window & { sp03Document?: string }).sp03Document),
    ).toBe(stamp);
  } finally {
    if (pending) await pending.release();
    if (oldResponse) await oldResponse.release();
    await admin.query(
      "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=$1",
      [source],
    );
    await other.context.close();
  }
});

async function sp03Activity(
  teacher: Page,
  group: Sp03Class,
  seatId: string,
  title: string,
  quizVersionId?: string,
) {
  const policies = {
    attemptPolicy: { maxAttempts: 2 },
    resultSelectionPolicy: { mode: 'latest' },
    completionPolicy: { mode: 'submission' },
    latePolicy: { mode: 'allow_mark_late' },
    assessmentPolicy: quizVersionId
      ? { mode: 'automatic', passThresholdBasisPoints: 6000 }
      : { mode: 'manual' },
    feedbackReleasePolicy: { mode: quizVersionId ? 'score_only' : 'after_review' },
  };
  const created = await teacher.request.post('/api/learning/activities', {
    headers: { origin: origin(teacher) },
    data: {
      scope: 'school',
      visibility: 'private',
      kind: quizVersionId ? 'quiz' : 'project',
      title,
      instructions: 'Выполните назначенную учебную работу.',
      resultMode: quizVersionId ? 'graded' : 'completion',
      maxPoints: quizVersionId ? 3 : null,
      policies,
      moduleKey: quizVersionId ? null : 'electronics',
      quizVersionId: quizVersionId ?? null,
      requestId: randomUUID(),
    },
  });
  await ok(created, 201);
  const draft = await created.json();
  const published = await teacher.request.post(`/api/learning/activities/${draft.id}/publish`, {
    headers: { origin: origin(teacher) },
    data: { expectedRevision: draft.draftRevision, requestId: randomUUID() },
  });
  await ok(published, 201);
  const assigned = await teacher.request.post(
    `/api/classrooms/${group.id}/learning/activity-runs`,
    {
      headers: { origin: origin(teacher) },
      data: {
        activityVersionId: (await published.json()).id,
        audienceType: 'named_learners',
        seatIds: [seatId],
        dueAt: null,
        requestId: randomUUID(),
      },
    },
  );
  await ok(assigned, 201);
  const run = await assigned.json();
  expect(run.assignedCount).toBe(1);
  return run as { assignmentId: string; activityRunId: string };
}

async function sp03QuizVersion(teacher: SeededTeacher): Promise<string> {
  const identity = await admin.query<{ principal_id: string }>(
    'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  const principal = identity.rows[0]!.principal_id;
  // Existing canonical authoring functions, same fixture as the convergence PG
  // test. Browser readers still receive only real server projections.
  const question = await admin.query<{ question_version_id: string }>(
    `SELECT * FROM question_version_create($1,$2,'school','boolean',
     '[{"type":"paragraph","text":"Замкнутая цепь проводит ток?"}]'::jsonb,
     '{}'::jsonb,'{"value":true}'::jsonb,3,'Science','10-12',ARRAY['m1'])`,
    [principal, teacher.tenantId],
  );
  const quiz = await admin.query<{ quiz_version_id: string }>(
    "SELECT * FROM quiz_version_create($1,$2,'Самостоятельный учебный тест SP03','Проверка следующего действия',$3::jsonb,2,15,6000,'score_only')",
    [principal, teacher.tenantId, JSON.stringify([question.rows[0]!.question_version_id])],
  );
  expect(quiz.rows[0]!.quiz_version_id).toMatch(UUID);
  return quiz.rows[0]!.quiz_version_id;
}

test('SP-03 next learning action follows real canonical project and quiz states without automatically starting an attempt', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await register(page, 'Участник учебного маршрута SP03');
  const teacher = await sp03Teacher(browser);
  try {
    const group = await sp03Class(teacher.page, 'Самостоятельный учебный маршрут SP03');
    const seatId = await sp03Join(page, teacher.page, group);
    const title = 'Исследовать электрическую цепь SP03';
    const run = await sp03Activity(teacher.page, group, seatId, title);
    const assignments = async () => {
      const response = await page.request.get('/api/class-join/account/assignments');
      await ok(response);
      return (await response.json()).items as Array<{
        id: string;
        status: string;
        activityKind: string;
        activityRunId: string | null;
        projectId: string | null;
        submittedAt: string | null;
        canonicalState: { workflowState: string } | null;
      }>;
    };
    const attempts = async (assignmentId: string) =>
      (
        await admin.query<{ n: number }>(
          'SELECT count(*)::int n FROM learning_attempts WHERE classroom_assignment_id=$1 AND seat_id=$2',
          [assignmentId, seatId],
        )
      ).rows[0]!.n;
    expect((await assignments()).find((item) => item.id === run.assignmentId)).toMatchObject({
      status: 'open',
      moduleKey: 'electronics',
      activityRunId: run.activityRunId,
      projectId: null,
      submittedAt: null,
      canonicalState: null,
    });
    await page.goto('/#/home');
    const next = page.locator('.personal-progress-next');
    await expect(next.getByRole('link')).toHaveText(`Начать: ${title}`);
    await expect(next.getByRole('link')).toHaveAttribute(
      'href',
      `/#/learning?assignment=${run.assignmentId}`,
    );
    expect(await attempts(run.assignmentId)).toBe(0);
    await next.getByRole('link').click();
    await expect(page).toHaveURL(
      new URL(`/#/learning?assignment=${run.assignmentId}`, origin(page)).href,
    );
    await expect(page.getByRole('heading', { name: 'Моё обучение', exact: true })).toBeVisible();
    await expect(
      page.getByTestId('attended-assignments').getByRole('button', { name: title, exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    // Resolving the suggested destination is a read, not consent to create work.
    expect(await attempts(run.assignmentId)).toBe(0);

    const started = await page.request.post(`/api/learning/work/runs/${run.activityRunId}/start`, {
      headers: { origin: origin(page) },
      data: { requestId: randomUUID() },
    });
    await ok(started);
    const work = await started.json();
    expect(work).toMatchObject({ state: 'in_progress', reused: false });
    expect(
      (await assignments()).find((item) => item.id === run.assignmentId)?.canonicalState
        ?.workflowState,
    ).toBe('in_progress');
    await page.goto('/#/home');
    await expect(next.getByRole('link')).toHaveText(`Продолжить: ${title}`);
    expect(await attempts(run.assignmentId)).toBe(1);
    const opened = await page.request.get(`/api/projects/${work.projectId}`);
    await ok(opened);
    const document = await opened.json();
    const changed = structuredClone(document.draft.document);
    changed.viewport = { ...(changed.viewport ?? {}), x: 17, y: 23, zoom: 1.2 };
    const saved = await page.request.put(`/api/projects/${work.projectId}/draft`, {
      headers: { origin: origin(page) },
      data: { document: changed, baseRevision: document.draft.revision, mutationId: randomUUID() },
    });
    await ok(saved);
    const submitted = await page.request.post(`/api/learning/projects/${work.projectId}/submit`, {
      headers: { origin: origin(page) },
      data: {
        clientRequestId: randomUUID(),
        expectedRevision: (await saved.json()).draft.revision,
      },
    });
    await ok(submitted);
    const submission = await submitted.json();
    expect(submission.state).toBe('submitted');
    expect(
      (await assignments()).find((item) => item.id === run.assignmentId)?.canonicalState
        ?.workflowState,
    ).toBe('submitted');
    await page.reload();
    await expect(next.getByRole('link')).toHaveText('Открыть обучение');
    await expect(next).not.toContainText(title);
    const reviewed = await teacher.page.request.post(
      `/api/classrooms/${group.id}/attempts/${submission.attemptId}/review`,
      {
        headers: { origin: origin(teacher.page) },
        data: {
          decision: 'accepted',
          points: null,
          feedback: 'Учебная работа принята.',
          reason: 'Проверка завершена.',
          expectedResultId: null,
          requestId: randomUUID(),
        },
      },
    );
    await ok(reviewed, 201);
    expect(
      (await assignments()).find((item) => item.id === run.assignmentId)?.canonicalState
        ?.workflowState,
    ).toBe('completed');
    await page.reload();
    await expect(next.getByRole('link')).toHaveText('Открыть обучение');
    expect(await attempts(run.assignmentId)).toBe(1);

    const quizTitle = 'Ответить на учебный вопрос SP03';
    const quizRun = await sp03Activity(
      teacher.page,
      group,
      seatId,
      quizTitle,
      await sp03QuizVersion(teacher.identity),
    );
    const quizzes = await page.request.get('/api/class-join/account/quizzes');
    await ok(quizzes);
    const legacyQuiz = (await quizzes.json()).items.find(
      (item: { assignmentId: string }) => item.assignmentId === quizRun.assignmentId,
    );
    expect(legacyQuiz).toBeUndefined();
    const directQuizShape = {
      status: 'open',
      activityKind: 'quiz',
      activityRunId: quizRun.activityRunId,
      projectId: null,
      submittedAt: null,
      canonicalState: null,
    };
    expect((await assignments()).find((item) => item.id === quizRun.assignmentId)).toMatchObject(
      directQuizShape,
    );
    const readQuiz = async () => {
      const response = await page.request.get(`/api/learning/quiz/runs/${quizRun.activityRunId}`);
      await ok(response);
      return response.json();
    };
    const freshQuiz = await readQuiz();
    expect(freshQuiz).toMatchObject({ attempt: null, canStart: true });
    expect(freshQuiz.participationId).toMatch(UUID);
    await page.reload();
    await expect(next.getByRole('link')).toHaveText(`Начать: ${quizTitle}`);
    await expect(next.getByRole('link')).toHaveAttribute(
      'href',
      `/#/learning?assignment=${quizRun.assignmentId}`,
    );
    expect(await attempts(quizRun.assignmentId)).toBe(0);
    await page.setViewportSize({ width: 320, height: 900 });
    await sp03Shell(page);
    await page.screenshot({
      path: `${EVIDENCE}/sp03-canonical-quiz-next-action-320.png`,
      fullPage: true,
    });
    await next.getByRole('link').click();
    await expect(page).toHaveURL(
      new URL(`/#/learning?assignment=${quizRun.assignmentId}`, origin(page)).href,
    );
    await expect(
      page
        .getByTestId('attended-assignments')
        .getByRole('button', { name: quizTitle, exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    // This positive assertion deliberately requires the real Direct Quiz
    // player for ordinary Accounts, not just a successful Learning navigation.
    // The existing Seat player starts only after its explicit Start control.
    const player = page.getByRole('region', { name: 'Прохождение теста', exact: true });
    await expect(player.getByRole('button', { name: 'Начать тест', exact: true })).toBeVisible();
    expect(await attempts(quizRun.assignmentId)).toBe(0);
    const explicitStart = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/learning/activity-participations/${freshQuiz.participationId}/attempts`,
    );
    await player.getByRole('button', { name: 'Начать тест', exact: true }).click();
    const startedQuiz = await explicitStart;
    expect(startedQuiz.status()).toBe(200);
    const quizStart = await startedQuiz.json();
    expect(quizStart).toMatchObject({ reused: false, attempt: { state: 'in_progress' } });
    const quizAttemptId = quizStart.attempt.attemptId as string;
    expect(quizAttemptId).toMatch(UUID);
    expect(await attempts(quizRun.assignmentId)).toBe(1);
    await expect(player).toContainText('Замкнутая цепь проводит ток?');
    expect((await assignments()).find((item) => item.id === quizRun.assignmentId)).toMatchObject(
      directQuizShape,
    );
    expect(await readQuiz()).toMatchObject({
      attempt: { attemptId: quizAttemptId, state: 'in_progress' },
    });
    await page.screenshot({
      path: `${EVIDENCE}/sp03-account-direct-quiz-player-320.png`,
      fullPage: true,
    });
    await openPortalSection(page, 'Главная');
    await expect(next.getByRole('link')).toHaveText(`Продолжить: ${quizTitle}`);
    await expect(next.getByRole('link')).toHaveAttribute(
      'href',
      `/#/learning?assignment=${quizRun.assignmentId}`,
    );
    expect(await attempts(quizRun.assignmentId)).toBe(1);
    await next.getByRole('link').click();
    await expect(player).toContainText('Замкнутая цепь проводит ток?');
    expect((await readQuiz()).attempt.attemptId).toBe(quizAttemptId);
    expect(await attempts(quizRun.assignmentId)).toBe(1);

    // The real player's existing autosave submits the selected boolean answer.
    // Await its actual PATCH instead of racing the 700ms autosave with a click
    // on a Save button that correctly disables after that save completes.
    const answerSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/learning/attempts/${quizAttemptId}/quiz-answers`,
    );
    await player.getByRole('radio', { name: 'Верно', exact: true }).check();
    const savedAnswer = await answerSaved;
    expect(savedAnswer.status()).toBe(200);
    const savedRevision = (await savedAnswer.json()).version as number;
    const answered = await readQuiz();
    expect(answered.attempt).toMatchObject({
      attemptId: quizAttemptId,
      state: 'in_progress',
      version: savedRevision,
    });
    expect(answered.attempt.answers).toEqual({
      [answered.attempt.questions[0].id]: { value: true },
    });
    const quizSubmitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/learning/attempts/${quizAttemptId}/submit`,
    );
    await player.getByRole('button', { name: 'Сдать тест', exact: true }).click();
    const submittedQuiz = await quizSubmitted;
    expect(submittedQuiz.status()).toBe(200);
    expect(await submittedQuiz.json()).toMatchObject({
      attempt: {
        attemptId: quizAttemptId,
        state: 'closed',
        result: { points: 3, maxPoints: 3, provisional: false },
      },
    });
    await expect(player).toContainText('Попытка завершена');
    expect(await readQuiz()).toMatchObject({
      attempt: { attemptId: quizAttemptId, state: 'closed' },
    });
    // The assignment projection remains null: the quiz read is authoritative.
    // canStart may still describe another allowed attempt, never a next action.
    expect((await assignments()).find((item) => item.id === quizRun.assignmentId)).toMatchObject(
      directQuizShape,
    );
    const completedHomeProof = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === `/api/learning/quiz/runs/${quizRun.activityRunId}`,
    );
    await openPortalSection(page, 'Главная');
    const completedRead = await completedHomeProof;
    expect(completedRead.status()).toBe(200);
    expect(await completedRead.json()).toMatchObject({
      attempt: { attemptId: quizAttemptId, state: 'closed' },
    });
    await expect(next.getByRole('status')).toHaveCount(0);
    await expect(next.getByRole('link')).toHaveText('Открыть обучение');
    await expect(next).not.toContainText(quizTitle);
    expect(await attempts(quizRun.assignmentId)).toBe(1);
    await page.screenshot({
      path: `${EVIDENCE}/sp03-completed-quiz-no-repeat-320.png`,
      fullPage: true,
    });
    // waiting_review/invalidated exclusions are exhaustively covered by the
    // adapter tests; no unsupported invalidation command or row rewrite here.
  } finally {
    await teacher.context.close();
  }
});
