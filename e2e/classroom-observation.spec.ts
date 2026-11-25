import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Request } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import type {
  ObservationSummary,
  ObservationHistoryPage,
} from '../apps/web/src/classroom-observation-api';

// Real browser bundle/API and isolated *_test DB. No route mocks or fabricated
// successful requests. Run after A integrates the two observation components.
let admin: pg.Pool, teacher: SeededTeacher;
test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'observation');
  mkdirSync('e2e/artifacts/owner-preview/classroom-observation', { recursive: true });
});
test.afterAll(async () => {
  await admin?.end();
});
test('teacher finds and opens genuine unassigned pupil work, reads real history and consistent counts', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await loginWithOrganization(page, teacher);
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  const title = `Наблюдение ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Название класса').fill(title);
  await dialog.getByLabel('Возраст учеников').selectOption('11-12');
  await dialog.getByLabel('Электроника').check();
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: title })
    .locator('.classroom-row-title')
    .click();
  await page.getByRole('button', { name: 'Добавить ученика', exact: true }).click();
  const pupilDialog = page.getByRole('dialog');
  await pupilDialog.getByLabel('Имя в списке класса').fill('Анна Наблюдаемая');
  const savedSeat = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /^\/api\/classrooms\/[^/]+\/seats$/.test(new URL(response.url()).pathname),
  );
  await pupilDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  expect((await savedSeat).status()).toBe(201);
  await expect(pupilDialog).toBeHidden();
  const classUrl = page.url();
  const list = (await (await page.request.get('/api/classrooms')).json()) as {
    items: Array<{ id: string; title: string }>;
  };
  const classId = list.items.find((c) => c.title === title)!.id;
  // A masks credentials by default. Use authorized fixture API readback,
  // without exposing codes in UI evidence/screenshots.
  const detail = (await (await page.request.get(`/api/classrooms/${classId}`)).json()) as {
    classroom: { joinCode: string };
  };
  const roster = (await (await page.request.get(`/api/classrooms/${classId}/roster`)).json()) as {
    items: Array<{ displayLabel: string; loginHandle: string }>;
  };
  const studentCode = roster.items.find((s) => s.displayLabel === 'Анна Наблюдаемая')!.loginHandle;
  const classCode = detail.classroom.joinCode;
  const studentContext = await browser.newContext();
  try {
    const student = await studentContext.newPage();
    await student.goto(`/#/join-class?code=${encodeURIComponent(classCode)}`);
    await student.getByLabel('Код ученика', { exact: true }).fill(studentCode);
    const joined = student.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/class-join/studentseat',
    );
    await student.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await joined).ok()).toBe(true);
    const create = student.locator('.portal-header .portal-quick-create');
    await create.locator('> summary').click();
    const created = student.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/projects',
    );
    await create.getByRole('button', { name: /^3D модель/ }).click();
    const response = await created;
    expect(response.ok(), await response.text()).toBe(true);
    const project = (await response.json()).project as { id: string };
    await expect(student.getByTestId('asa3d-viewport')).toHaveAttribute(
      'data-runtime-ready',
      'true',
      { timeout: 30_000 },
    );
    const projectTitle = `Исследование электрической цепи ${randomUUID().slice(0, 8)}`;
    const titleInput = student.getByLabel('Название проекта', { exact: true });
    await titleInput.fill(projectTitle);
    const renamed = student.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/api/projects/${project.id}`,
    );
    await titleInput.press('Enter');
    expect((await renamed).ok()).toBe(true);
    const draftSave = student.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        new URL(r.url()).pathname === `/api/projects/${project.id}/draft`,
    );
    await student.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
    const savedDraft = await draftSave;
    expect(savedDraft.ok(), await savedDraft.text()).toBe(true);
    const revision = (await savedDraft.json()).draft.revision as number;
    await expect(student.locator('.asa3d-save-state')).toHaveClass(/save-saved/);
    const snapshotPath = `/api/projects/${project.id}/snapshot`;
    // Ask the real editor to capture the saved scene, as on switching tabs.
    await student.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect
      .poll(
        async () =>
          (await student.request.get(`${snapshotPath}?rev=${revision}`)).headers()['cache-control'],
        { timeout: 20_000 },
      )
      .toContain('immutable');
    const blankTitle = 'Эскиз без снимка';
    const headers = { origin: new URL(student.url()).origin };
    const blankProject = await student.request.post('/api/projects', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: { scope: 'personal', module: 'three-d', title: blankTitle },
    });
    expect(blankProject.status(), await blankProject.text()).toBe(201);
    const blankId = (await blankProject.json()).project.id as string;
    const archived = await student.request.post(`/api/projects/${blankId}/status`, {
      headers,
      data: { status: 'archived' },
    });
    expect(archived.ok(), await archived.text()).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
    const works = page.getByRole('region', { name: 'Работы учеников' });
    const workRow = works.locator('li').filter({ hasText: projectTitle });
    await expect(workRow).toContainText('Анна Наблюдаемая');
    await expect(workRow).toContainText('Без задания');
    const blankCard = works.locator('li').filter({ hasText: blankTitle });
    await expect(blankCard).toHaveCount(0);
    const showArchive = works.getByLabel('Включить архив');
    await showArchive.check();
    await expect(blankCard).toContainText('Архив');
    await expect(blankCard.getByText('Без снимка', { exact: true })).toBeVisible();
    await blankCard.getByRole('button', { name: /^Предпросмотр работы / }).click();
    const blankPreview = page.getByRole('dialog', { name: `Работа: ${blankTitle}` });
    await expect(blankPreview.getByText('Снимок недоступен', { exact: true })).toBeVisible();
    await blankPreview.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await showArchive.uncheck();
    await expect(blankCard).toHaveCount(0);
    await works.getByLabel('Редактор', { exact: true }).selectOption('three-d');
    await works.getByLabel('Название', { exact: true }).fill(projectTitle);
    await expect(workRow).toBeVisible();
    await works.getByLabel('Задание', { exact: true }).selectOption('assigned');
    await expect(works.getByText('По этим фильтрам доступных работ нет.')).toBeVisible();
    await works.getByLabel('Задание', { exact: true }).selectOption('unassigned');
    await expect(workRow).toBeVisible();
    const cardPicture = workRow.locator('img');
    await expect(cardPicture).toHaveAttribute(
      'src',
      new RegExp(`^${snapshotPath}\\?refresh=\\d+$`),
    );
    await expect(cardPicture).toHaveAttribute('loading', 'lazy');

    // A real authenticated teacher, server API and isolated PostgreSQL. At a
    // narrow CSS viewport the title must not be crushed by the Open action.
    // Keep the same project, identity and server-side permission path at every size.
    for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(workRow).toBeVisible();
      const geometry = await workRow.evaluate((row) => {
        const title = row.querySelector<HTMLElement>('.classroom-work-card-title strong')!;
        const action = row.querySelector<HTMLButtonElement>('.classroom-work-card-editor')!;
        const textNode = title.firstChild as Text;
        const brokenWords: string[] = [];
        const value = textNode.textContent ?? '';
        for (const word of value.matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(textNode, word.index);
          range.setEnd(textNode, word.index + word[0].length);
          if (range.getClientRects().length > 1) brokenWords.push(word[0]);
        }
        const textBox = title.getBoundingClientRect();
        const actionBox = action.getBoundingClientRect();
        const overlap =
          Math.min(textBox.right, actionBox.right) - Math.max(textBox.left, actionBox.left) > 1 &&
          Math.min(textBox.bottom, actionBox.bottom) - Math.max(textBox.top, actionBox.top) > 1;
        return {
          brokenWords,
          overlap,
          actionHeight: actionBox.height,
          actionWithinViewport: actionBox.left >= -1 && actionBox.right <= innerWidth + 1,
          documentWithinViewport: document.documentElement.scrollWidth <= innerWidth + 1,
        };
      });
      expect(geometry.brokenWords, `Full project words at ${width}px`).toEqual([]);
      expect(geometry.overlap, `Title/action overlap at ${width}px`).toBe(false);
      expect(geometry.actionWithinViewport, `Open action visible at ${width}px`).toBe(true);
      expect(geometry.documentWithinViewport, `No page overflow at ${width}px`).toBe(true);
      if (width <= 430) expect(geometry.actionHeight).toBeGreaterThanOrEqual(44);
      await page.screenshot({
        path: `e2e/artifacts/owner-preview/classroom-observation/projects-${width}.png`,
        fullPage: true,
      });
    }
    const previewTrigger = workRow.getByRole('button', { name: /^Предпросмотр работы / });
    const cardSize = await workRow.evaluate((element) => [
      element.clientWidth,
      element.clientHeight,
    ]);
    await previewTrigger.hover();
    expect(
      await workRow.evaluate((element) => [element.clientWidth, element.clientHeight]),
    ).toEqual(cardSize);
    const unauthorized = await browser.newContext();
    try {
      expect((await unauthorized.request.get(snapshotPath)).status()).toBe(401);
    } finally {
      await unauthorized.close();
    }

    const unexpectedPreviewRequests: string[] = [];
    const collectRequest = (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.startsWith('/api/gallery') ||
        (path.startsWith('/api/projects/') && (path !== snapshotPath || request.method() !== 'GET'))
      ) {
        unexpectedPreviewRequests.push(path);
      }
    };
    page.on('request', collectRequest);
    await previewTrigger.focus();
    await page.keyboard.press('Enter');
    const preview = page.getByRole('dialog', { name: `Работа: ${projectTitle}` });
    await expect(preview.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    const previewImage = preview.getByRole('img');
    const firstSnapshotSrc = (await cardPicture.getAttribute('src'))!;
    await expect(previewImage).toHaveAttribute('src', firstSnapshotSrc);
    await expect
      .poll(() => previewImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByTestId('asa3d-viewport')).toHaveCount(0);
    await expect(preview.getByText('Отклик на проект', { exact: true })).toHaveCount(0);
    // Republish the real scene snapshot at the same draft revision.
    const originalWidth = await previewImage.evaluate(
      (image: HTMLImageElement) => image.naturalWidth,
    );
    const replacementWidth = originalWidth === 192 ? 168 : 192;
    const replacement = await student.evaluate(
      async ({ path, width }) => {
        const image = new Image();
        image.src = path;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.max(
          16,
          Math.round((image.naturalHeight * width) / image.naturalWidth),
        );
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      },
      { path: snapshotPath, width: replacementWidth },
    );
    const savedSnapshot = await student.request.put(snapshotPath, {
      headers,
      data: { sourceRevision: revision, imageDataUrl: replacement },
    });
    expect(savedSnapshot.ok(), await savedSnapshot.text()).toBe(true);
    const refreshedProjects = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/classrooms/${classId}/observation/projects`,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await refreshedProjects).ok()).toBe(true);
    await expect(works).toHaveAttribute('aria-busy', 'false');
    await expect(preview).toBeVisible();
    await expect
      .poll(() => previewImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(replacementWidth);
    await expect
      .poll(() => cardPicture.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(replacementWidth);
    const refreshedSnapshotSrc = (await previewImage.getAttribute('src'))!;
    expect(refreshedSnapshotSrc).not.toBe(firstSnapshotSrc);
    await expect(cardPicture).toHaveAttribute('src', refreshedSnapshotSrc);
    await page.keyboard.press('Shift+Tab');
    await expect(preview.getByRole('button', { name: 'Открыть в редакторе' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(previewTrigger).toBeFocused();
    page.off('request', collectRequest);
    expect(unexpectedPreviewRequests).toEqual([]);
    // A real successful explicit logout; closing the page is never evidence.
    const logout = await student.request.post('/api/class-join/logout', { headers });
    expect(logout.ok()).toBe(true);
    await previewTrigger.click();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(preview).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'e2e/artifacts/owner-preview/classroom-observation/preview-390.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('Escape');
    await workRow.getByRole('button', { name: /^Открыть в редакторе:/ }).click();
    await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue(projectTitle);
    await page.goto(classUrl);
    await page.getByRole('button', { name: 'История', exact: true }).click();
    const history = page.getByRole('region', { name: 'История класса' });
    await expect(history).toContainText(projectTitle);
    await expect
      .poll(async () => {
        const result = await page.request.get(
          `/api/classrooms/${classId}/observation/history?category=access`,
        );
        expect(result.ok()).toBe(true);
        return ((await result.json()) as ObservationHistoryPage).items.some(
          (e) => e.action === 'seat.signed_out' && !e.byTeacher,
        );
      })
      .toBe(true);
    await history.getByRole('combobox', { name: 'Действия', exact: true }).selectOption('access');
    await expect(history).toContainText('Явный выход');
    await expect(history).toContainText('Вход по коду класса');
    const summaryResponse = await page.request.post('/api/classrooms/observation/summary', {
      headers: { origin: new URL(page.url()).origin },
      data: { classroomIds: [classId] },
    });
    expect(summaryResponse.ok()).toBe(true);
    const summary = (await summaryResponse.json()) as ObservationSummary;
    const actual = (
      await admin.query(
        "SELECT count(DISTINCT p.id)::int works FROM projects p JOIN principals owner ON owner.id=p.owner_principal_id JOIN classroom_student_seats s ON s.id=owner.seat_id WHERE s.classroom_id=$1 AND p.module_key IN('three-d','electronics','blocks') AND p.status IN('active','archived')",
        [classId],
      )
    ).rows[0].works;
    expect(summary.totals).toMatchObject({
      works: actual,
      assigned: 0,
      submitted: 0,
      waiting: 0,
      notSubmitted: 0,
    });
    expect(actual).toBe(2);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(history).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: `e2e/artifacts/owner-preview/classroom-observation/history-${width}.png`,
        fullPage: true,
      });
    }
    // Reopen a real session so removal must revoke it while the project stays in storage.
    const login = await student.request.post('/api/class-join/studentseat', {
      headers: { origin: new URL(classUrl).origin },
      data: { code: classCode, studentCode },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const { items: activeSeats } = await (
      await page.request.get(`/api/classrooms/${classId}/roster`)
    ).json();
    const removedSeatId: string = activeSeats.find(
      (seat: { displayLabel: string }) => seat.displayLabel === 'Анна Наблюдаемая',
    ).id;
    const storedProject = async () =>
      (await admin.query('SELECT id, title, status FROM projects WHERE id=$1', [project.id])).rows;
    const savedProject = await storedProject();
    expect(savedProject).toEqual([{ id: project.id, title: projectTitle, status: 'active' }]);

    await page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
    const filter = works.getByLabel('Ученик', { exact: true });
    await filter.selectOption(removedSeatId);
    await expect(workRow).toBeVisible();
    await previewTrigger.click();
    await expect(preview).toBeVisible();
    const removal = await page.request.delete(`/api/classrooms/${classId}/seats/${removedSeatId}`, {
      headers: { origin: new URL(classUrl).origin },
    });
    expect(removal.ok(), await removal.text()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(preview).toHaveCount(0);
    await expect(filter).toHaveValue('');
    await expect(filter.getByRole('option', { name: 'Анна Наблюдаемая' })).toHaveCount(0);
    await expect(workRow).toHaveCount(0);
    await expect(works.getByText('По этим фильтрам доступных работ нет.')).toBeVisible();
    expect(await storedProject()).toEqual(savedProject);
    const lostSession = await student.request.get('/api/class-join/me');
    expect(await lostSession.json()).toEqual({ authenticated: false });
    const rejectedLogin = await student.request.post('/api/class-join/studentseat', {
      headers: { origin: new URL(classUrl).origin },
      data: { code: classCode, studentCode },
    });
    expect(rejectedLogin.status()).toBe(401);
  } finally {
    await studentContext.close();
  }
});
