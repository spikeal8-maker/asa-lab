import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/**
 * The gallery.
 *
 * The one place on this platform where people see each other's work, and the
 * only place reactions exist. Inside a class nobody sees a classmate's model —
 * thirty children on one task, shown each other's answers, is a copying machine
 * — so «нравится» and «ого» live here, on work that was published on purpose.
 *
 * What this asserts, in order: that a teacher can put their own work up, that a
 * second account sees it and can react to it, that the author cannot react to
 * their own, and that «выбор редакции» is something a teacher awards.
 */

const evidenceDir = 'e2e/artifacts/gallery';

// The test database is not emptied between runs and a gallery is cumulative by
// nature, so the work this run publishes carries its own name.
const TITLE = `Замок на холме ${Date.now().toString(36)}`;

// A small square the 3D editor could plausibly have drawn.
const PICTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIUlEQVR42mNkYPhfz0AEYBxVSF+FjIyMDIwMDAwMDAwMAB8wA/9K1AhVAAAAAElFTkSuQmCC';

let admin: pg.Pool;
let author: SeededTeacher;
let viewer: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  author = await seedTeacher(admin, 'gallery-author');
  viewer = await seedTeacher(admin, 'gallery-viewer');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('work is shared to the gallery, seen by another account and reacted to', async ({
  browser,
  page,
}) => {
  // Two signed-in people and one 3D editor load.
  test.setTimeout(180_000);
  const authorFailures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, author);

  // A project with a picture. The editor saves one on its own schedule, so the
  // test puts one there directly — what is being tested is the gallery, not the
  // 3D canvas, which has its own suite.
  await page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
  // Two buttons carry this name: the one in the header bar and the one on the
  // page. Either opens the same dialog; the page's is the one a person presses.
  await page.getByRole('main').getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByLabel('Название проекта').fill(TITLE);
  await page.locator('.module-tile').filter({ hasText: 'ASA 3D' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true', {
    timeout: 60_000,
  });

  const projectId = await page.evaluate(
    () => window.location.hash.replace(/^#\/3d\//, '').split(/[?#]/)[0] ?? '',
  );
  expect(projectId).not.toEqual('');
  const saved = await page.evaluate(
    async ([id, image]) => {
      const response = await fetch(`/api/projects/${id}/snapshot`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: image }),
      });
      return response.status;
    },
    [projectId, PICTURE],
  );
  expect(saved).toBe(200);

  // Sharing it, from the menu on its own card.
  await page.getByRole('button', { name: 'ASA Lab' }).first().click();
  await page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
  // The card's controls appear on hover, the way they do for a person.
  const card = page.getByTestId('project-card').filter({ hasText: TITLE });
  await card.hover();
  await page.getByLabel(`Действия с проектом ${TITLE}`).click();
  await page.getByRole('button', { name: 'Поделиться в галерее' }).click();
  await expect(page.getByText(`«${TITLE}» теперь в галерее.`)).toBeVisible();

  // On the wall, where the author sees their own work and cannot react to it.
  await page.getByRole('button', { name: 'Галерея', exact: true }).first().click();
  const mine = page.getByTestId('gallery').locator('li').filter({ hasText: TITLE });
  await expect(mine).toBeVisible();
  await expect(mine.getByRole('img')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/gallery-author.png`, fullPage: true });

  // A different account, from a different school, sees it and reacts.
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  const viewerFailures = collectBrowserFailures(viewerPage, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(viewerPage, viewer);
  await viewerPage.getByRole('button', { name: 'Галерея', exact: true }).first().click();
  const entry = viewerPage
    .getByTestId('gallery')
    .locator('li')
    .filter({ hasText: TITLE });
  await expect(entry).toBeVisible();
  // The author is named by their display name, which the seed builds from the label.
  await expect(entry).toContainText('Педагог gallery-author');

  const wow = entry.getByRole('button', { name: /^Ого/ });
  await expect(wow).toHaveAttribute('aria-pressed', 'false');
  await wow.click();
  await expect(entry.getByRole('button', { name: 'Ого: 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // «Выбор редакции» is awarded, and it survives a reload because it was saved.
  await entry.getByRole('button', { name: 'Выбор редакции' }).click();
  await expect(entry.getByText('Выбор редакции')).toBeVisible();
  await viewerPage.reload();
  const afterReload = viewerPage
    .getByTestId('gallery')
    .locator('li')
    .filter({ hasText: TITLE });
  await expect(afterReload.getByRole('button', { name: 'Ого: 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(afterReload.locator('.gallery-choice-badge')).toBeVisible();
  await viewerPage.screenshot({ path: `${evidenceDir}/gallery-viewer.png`, fullPage: true });

  // The count reached the author's copy of the page too.
  await page.reload();
  await expect(
    page.getByTestId('gallery').locator('li').filter({ hasText: TITLE }),
  ).toContainText('1');

  authorFailures.assertEmpty();
  viewerFailures.assertEmpty();
  await viewerContext.close();
});
