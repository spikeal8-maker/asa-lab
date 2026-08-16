import { mkdirSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { collectBrowserFailures } from './browser-failures';
import { openPortalSection } from './portal-navigation';

const EVIDENCE_DIR = process.env['ASA_OWNER_EVIDENCE_DIR'] ?? 'e2e/artifacts/owner-preview';

/**
 * Every module draws its own project card, and Project Core draws all of them
 * the same way. This suite proves the whole path in a real browser: the module
 * describes a figure, the server stores it on save, the list hands it back, and
 * the card renders it — for each subject, with a picture that differs by
 * subject rather than one shared placeholder.
 */

interface ProjectRef {
  readonly id: string;
  readonly title: string;
}

async function createProject(
  request: APIRequestContext,
  origin: string,
  module: string,
  title: string,
  key: string,
): Promise<ProjectRef> {
  const response = await request.post('/api/projects', {
    headers: { origin, 'idempotency-key': key },
    data: { scope: 'personal', classroomId: null, module, title },
  });
  expect(response.status(), `create ${module}`).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return { id: body.project.id, title };
}

/**
 * Reads the project's current document and saves an edited copy. Starting from
 * the real document rather than a hand-written one keeps this test honest about
 * the module's own defaults instead of freezing a copy of them here.
 */
async function editDraft(
  request: APIRequestContext,
  origin: string,
  projectId: string,
  edit: (document: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const opened = await request.get(`/api/projects/${projectId}`, { headers: { origin } });
  expect(opened.status()).toBe(200);
  const body = (await opened.json()) as { draft: { document: Record<string, unknown> } };
  const saved = await request.put(`/api/projects/${projectId}/draft`, {
    headers: { origin },
    data: { document: edit(body.draft.document) },
  });
  expect(saved.status(), 'save draft').toBe(200);
}

function cardFor(page: Page, title: string) {
  return page.locator('.project-hub-card').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
}

test('project cards show a picture of the work for every module', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByTestId('entry-sign-up').click();
  await page.getByLabel('Email').fill(`preview_${unique}@preview-e2e.test`);
  await page.getByLabel('Имя пользователя').fill(`preview_${unique}`.slice(0, 36));
  await page.getByLabel('Отображаемое имя (необязательно)').fill('Пётр Превьюев');
  await page.getByLabel('Дата рождения').fill('1990-02-11');
  await page.getByLabel('Пароль').fill(`Safe-${unique}-Password`);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/#\/home$/);

  const request = page.context().request;
  const origin = new URL(page.url()).origin;

  // Boards draw themselves from the starting position, so these two need no edit.
  const chess = await createProject(request, origin, 'chess', 'Партия Морфи', `pv-chess-${unique}`);
  const checkers = await createProject(
    request,
    origin,
    'checkers',
    'Русские шашки',
    `pv-checkers-${unique}`,
  );

  const circuit = await createProject(
    request,
    origin,
    'electronics',
    'Светодиод и резистор',
    `pv-circuit-${unique}`,
  );
  await editDraft(request, origin, circuit.id, (document) => ({
    ...document,
    components: [
      { id: 'src', kind: 'source', position: { x: 40, y: 40 }, value: 9 },
      { id: 'r1', kind: 'resistor', position: { x: 160, y: 40 }, value: 220 },
      { id: 'd1', kind: 'led', position: { x: 160, y: 170 }, value: 2 },
    ],
    connections: [
      {
        id: 'w1',
        from: { componentId: 'src', terminal: 'a' },
        to: { componentId: 'r1', terminal: 'a' },
      },
      {
        id: 'w2',
        from: { componentId: 'r1', terminal: 'b' },
        to: { componentId: 'd1', terminal: 'a' },
      },
    ],
  }));

  const scene = await createProject(request, origin, 'three-d', 'Подставка', `pv-scene-${unique}`);
  await editDraft(request, origin, scene.id, (document) => ({
    ...document,
    nodes: [
      {
        id: 'base',
        kind: 'primitive',
        primitive: 'box',
        name: 'Основание',
        operation: 'solid',
        color: '#2f7bd6',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        dimensions: { width: 60, depth: 40, height: 10 },
        sides: 24,
        bevel: 0,
        visible: true,
        locked: false,
        groupId: null,
        groupOperation: null,
      },
      {
        id: 'hole',
        kind: 'primitive',
        primitive: 'cylinder',
        name: 'Отверстие',
        operation: 'hole',
        color: '#d64f2f',
        transform: {
          position: { x: 16, y: 0, z: 6 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        dimensions: { width: 14, depth: 14, height: 20 },
        sides: 24,
        bevel: 0,
        visible: true,
        locked: false,
        groupId: null,
        groupOperation: null,
      },
    ],
  }));

  await openPortalSection(page, 'Проекты');
  await expect(page).toHaveURL(/#\/projects$/);

  const titles = [chess.title, checkers.title, circuit.title, scene.title];
  for (const title of titles) {
    const figure = cardFor(page, title).getByTestId('project-preview-figure');
    await expect(figure, `${title} card must show a figure`).toBeVisible();
    await expect(figure).toHaveAttribute('aria-label', new RegExp(title));
  }

  /**
   * The point of the feature: four cards, four different pictures. Comparing the
   * drawn markup catches the failure mode where every module ends up rendering
   * the same shared placeholder.
   */
  const drawings = await Promise.all(
    titles.map(async (title) =>
      cardFor(page, title).getByTestId('project-preview-figure').innerHTML(),
    ),
  );
  expect(new Set(drawings).size).toBe(titles.length);

  // A board is a grid of squares plus its pieces; a circuit is parts and wires.
  expect(drawings[0]).toContain('<circle');
  expect(drawings[2]).toContain('<line');

  // A figure must never reach the page carrying a request to somewhere else.
  for (const drawing of drawings) {
    expect(drawing).not.toContain('url(');
    expect(drawing).not.toContain('http');
  }

  await page.screenshot({ path: `${EVIDENCE_DIR}/01-project-cards.png`, fullPage: true });
  await openPortalSection(page, 'Главная');
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-creator-home.png`, fullPage: true });
  await openPortalSection(page, 'Проекты');

  /**
   * The snapshot path, end to end and in a real browser: the 3D editor renders
   * its own scene, Core encodes and uploads it, the list reports the revision
   * it was stored against, and the card shows the photograph instead of the
   * computed figure.
   *
   * The capture is provoked through its own trigger — the page becoming
   * hidden, which is what happens when a learner switches tab or closes a lid.
   * Waiting out the settling delay and the slow timer instead would test the
   * clock rather than the picture.
   */
  await page.goto(`/#/3d/${scene.id}?returnTo=%2Fprojects`);
  const viewport = page.getByTestId('asa3d-viewport');
  await expect(viewport).toBeVisible({ timeout: 20_000 });
  await expect(viewport).toHaveAttribute('data-runtime-ready', 'true', { timeout: 20_000 });

  const uploaded = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/projects/${scene.id}/snapshot`) &&
      response.request().method() === 'PUT',
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await uploaded).status(), 'the 3D editor must photograph its own scene').toBe(200);

  const stored = await request.get(`/api/projects/${scene.id}/snapshot`, { headers: { origin } });
  expect(stored.status()).toBe(200);
  expect(stored.headers()['content-type']).toMatch(/^image\/(png|webp)$/);
  expect(stored.headers()['x-content-type-options']).toBe('nosniff');
  const bytes = await stored.body();
  expect(bytes.byteLength).toBeGreaterThan(1000);

  await page.goto('/#/projects');
  const photographed = cardFor(page, scene.title).getByTestId('project-preview-snapshot');
  await expect(photographed).toBeVisible();
  await expect(photographed).toHaveAttribute('loading', 'lazy');
  await expect(cardFor(page, scene.title).getByTestId('project-preview-figure')).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-snapshot-card.png`, fullPage: true });

  /** A brand-new circuit has nothing to draw and falls back to the glyph. */
  const empty = await createProject(
    request,
    origin,
    'electronics',
    'Пустая схема',
    `pv-empty-${unique}`,
  );
  await page.reload();
  await expect(cardFor(page, empty.title)).toBeVisible();
  await expect(cardFor(page, empty.title).getByTestId('project-preview-figure')).toHaveCount(0);

  failures.assertEmpty();
});
