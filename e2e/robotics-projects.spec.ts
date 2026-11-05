import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { PublicRoboticsArtifact } from '@asa-lab/contracts';
import type { Project, ProjectDraft } from '../apps/web/src/api';
import type { RoboticsProject } from '../apps/web/src/robotics/robotics-project';
import type { ProjectPublicationStatus, PublicProject } from '../apps/web/src/projects-public/api';
import { collectBrowserFailures } from './browser-failures';
import { accountMenu, openAccountMenu, openPortalSection } from './portal-navigation';

// This spec uses the ordinary production entry, cookie sessions and Project Core
// against e2e/server.mjs's real isolated PostgreSQL. No request is fulfilled,
// aborted or replaced by a browser fixture; editor/source assertions use its API.
const EVIDENCE = 'e2e/artifacts/robotics-projects';
const WIDTHS = [1440, 1024, 390, 320] as const;
const PRIVATE_SOURCE = 'ROBOTICS_PRIVATE_PROGRAM_MUST_NOT_APPEAR_PUBLICLY';
const origin = (page: Page): string => new URL(page.url()).origin;
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function register(page: Page, label: string) {
  const unique = randomUUID().replaceAll('-', '');
  const credentials = {
    email: `robotics-${unique}@isolated.test`,
    password: `Robotics-${unique}-Password`,
  };
  await page.goto('/#/');
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Создать аккаунт', exact: true })
    .click();
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill(label);
  await page.getByLabel('Дата рождения', { exact: true }).fill('1991-04-18');
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
  const botCheck = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await botCheck.isVisible()) await botCheck.check();
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  return credentials;
}

async function login(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto('/#/');
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(credentials.email);
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
  const botCheck = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await botCheck.isVisible()) await botCheck.check();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
}

async function readProject(
  page: Page,
  projectId: string,
): Promise<{ project: Project; draft: ProjectDraft<RoboticsProject> }> {
  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function saved(page: Page, projectId: string) {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('robotics-account-editor')).toHaveAttribute(
    'data-server-revision',
    /^[1-9]\d*$/,
  );
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  const result = await readProject(page, projectId);
  expect(
    await page.getByTestId('robotics-account-editor').getAttribute('data-server-revision'),
  ).toBe(String(result.draft.revision));
  return result;
}

async function numberField(page: Page, label: string, value: number): Promise<void> {
  const field = page.getByRole('spinbutton', { name: label, exact: true });
  await field.fill(String(value));
  await field.press('Tab');
  await expect(field).toHaveAttribute('aria-invalid', 'false');
}

async function noOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(size.document).toBeLessThanOrEqual(size.viewport);
}

async function visibleControl(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(24);
  expect(box!.height).toBeGreaterThanOrEqual(28);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
}

async function cardPreview(page: Page, title: string): Promise<Locator> {
  const card = page
    .getByTestId('project-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  const image = card.getByTestId('project-preview-snapshot');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const picture = element as HTMLImageElement;
        return picture.complete && picture.naturalWidth === 480 && picture.naturalHeight === 360;
      }),
    )
    .toBe(true);
  const frame = await card.locator('.project-card-frame').boundingBox();
  expect(frame).not.toBeNull();
  expect(
    Math.abs(frame!.height - (frame!.width * 3) / 4),
    'a tall field must not stretch its card',
  ).toBeLessThanOrEqual(1.5);
  return card;
}

test('Robotics uses account projects, the main portal and an immutable publication for a second user', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const failures = [
    collectBrowserFailures(page, { allowAnonymousSessionProbe: true, allowAdminAccessProbe: true }),
  ];
  const contexts: BrowserContext[] = [];
  const serverWrites: { method: string; path: string; status: number }[] = [];
  const observe = (target: Page): void => {
    target.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (
        /^\/api\/projects(?:\/|$)/.test(path) &&
        ['POST', 'PUT', 'PATCH'].includes(response.request().method())
      )
        serverWrites.push({ method: response.request().method(), path, status: response.status() });
    });
    target.on('dialog', (dialog) => {
      void dialog.accept();
    });
  };
  observe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const credentials = await register(page, 'Автор робототехники');
  const title = `Робот для исследования движения, датчика расстояния и собственного высокого поля — ${randomUUID().slice(0, 8)}`;

  await page.locator('.portal-header .portal-quick-create > summary').click();
  const createdResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/projects' &&
      response.request().method() === 'POST',
  );
  await page
    .locator('.portal-header .portal-create-options')
    .getByRole('button', { name: /^Робототехника/ })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await expect(page).toHaveURL(new RegExp(`${projectId}.*module=robotics`));
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Поле', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('textbox', { name: 'Название проекта', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Название проекта', exact: true }).press('Tab');
  const initial = await readProject(page, projectId);
  expect(initial.project.moduleKey).toBe('robotics');
  expect(initial.draft.document.schemaVersion).toBe(2);
  const initialUno = initial.draft.document.circuit.components.find((part) => part.id === 'uno')!;
  expect(initialUno.stateProperties?.['arduinoCodeMode']).toBe('blocks');
  expect(String(initialUno.stateProperties?.['arduinoWorkspace'])).toContain('blocks');

  // The supported field's tallest aspect ratio is 0.8 × 2.4 metres. Remove the
  // starter wall through the inspector before narrowing its authored geometry.
  await page.getByRole('button', { name: 'Стена · barrier', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить предмет', exact: true }).click();
  await numberField(page, 'Высота поля', 2.4);
  await numberField(page, 'Ширина поля', 0.8);
  await numberField(page, 'Шаг сетки', 0.2);
  for (const tool of ['Стена', 'Мяч', 'Зона']) {
    await page
      .getByRole('toolbar', { name: 'Инструменты поля' })
      .getByRole('button', { name: tool, exact: true })
      .click();
    await page.getByRole('button', { name: 'Добавить в свободное место', exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Робот', exact: true }).click();
  await numberField(page, 'Длина корпуса', 0.18);
  await page.getByRole('tab', { name: 'Электроника', exact: true }).click();
  await expect(page.locator('.workbench-canvas [data-component-id="uno"]')).toBeVisible();
  await page.getByRole('tab', { name: 'Программа', exact: true }).click();
  await expect(page.getByTestId('arduino-block-workspace')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Пример программы', exact: true })
    .selectOption('turn-left');
  const blocksSaved = await saved(page, projectId);
  const blockProgram = blocksSaved.draft.document.circuit.components.find(
    (part) => part.id === 'uno',
  )!.stateProperties!;
  expect(blockProgram['arduinoCodeMode']).toBe('blocks');
  expect(blockProgram['arduinoWorkspace']).not.toBe(
    initialUno.stateProperties?.['arduinoWorkspace'],
  );

  await page.locator('.arduino-mode-menu > summary').click();
  await page.getByRole('button', { name: 'Текст', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Продолжить?', exact: true })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  const code = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
  const source = `// ${PRIVATE_SOURCE}\n${await code.inputValue()}`;
  await code.fill(source);
  const confirmed = await saved(page, projectId);
  expect(confirmed.project.title).toBe(title);
  expect(confirmed.draft.document.world.field).toMatchObject({
    widthMeters: 0.8,
    heightMeters: 2.4,
    gridMeters: 0.2,
  });
  expect(confirmed.draft.document.world.field.obstacles).toHaveLength(1);
  expect(confirmed.draft.document.world.field.balls).toHaveLength(1);
  expect(confirmed.draft.document.world.field.floorMarks).toHaveLength(1);
  expect(confirmed.draft.document.world.robot.bodyLengthMeters).toBe(0.18);
  expect(
    confirmed.draft.document.circuit.components.find((part) => part.id === 'uno')!
      .stateProperties?.['arduinoSource'],
  ).toBe(source);
  expect(confirmed.draft.document.circuit.simulation.running).toBe(false);

  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect
    .poll(
      async () => Number(await page.getByTestId('robotics-time').getAttribute('data-microseconds')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(200_000);
  const duringRun = await saved(page, projectId);
  expect(duringRun.draft).toEqual(confirmed.draft);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('tab', { name: 'Поле', exact: true }).click();
    await noOverflow(page);
    for (const label of ['Поле', 'Робот', 'Электроника', 'Программа'])
      await visibleControl(page, page.getByRole('tab', { name: label, exact: true }));
    for (const label of ['Сохранить', 'Публикация', 'Аккаунт'])
      await visibleControl(page, page.getByRole('button', { name: label, exact: true }));
    await page.screenshot({ path: `${EVIDENCE}/editor-field-${width}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Программа', exact: true }).click();
    await expect(code).toBeVisible();
    await expect(code).toHaveValue(source);
    await noOverflow(page);
    await page.screenshot({ path: `${EVIDENCE}/editor-program-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', { name: 'Робототехника', exact: true })).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await cardPreview(page, title);
    await noOverflow(page);
    await page.screenshot({ path: `${EVIDENCE}/home-${width}.png`, fullPage: true });
  }
  await openPortalSection(page, 'Проекты');
  await page.getByRole('tab', { name: 'Робототехника', exact: true }).click();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await cardPreview(page, title);
    await noOverflow(page);
    await page.screenshot({ path: `${EVIDENCE}/my-projects-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAccountMenu(page);
  await accountMenu(page).getByRole('button', { name: 'Выход', exact: true }).click();
  await expect(page.locator('.public-home-header-actions')).toBeVisible();

  try {
    // A fresh context has no cookies/localStorage from the authoring device.
    const secondDevice = await browser.newContext({
      baseURL: origin(page),
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(secondDevice);
    expect((await secondDevice.storageState()).origins).toEqual([]);
    const restored = await secondDevice.newPage();
    failures.push(
      collectBrowserFailures(restored, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      }),
    );
    observe(restored);
    await login(restored, credentials);
    await openPortalSection(restored, 'Проекты');
    await (
      await cardPreview(restored, title)
    )
      .getByRole('link', { name: title, exact: true })
      .click();
    await expect(restored.getByTestId('robotics-account-editor')).toBeVisible();
    const reopened = await readProject(restored, projectId);
    expect(reopened.draft.document).toEqual(confirmed.draft.document);
    expect(reopened.draft.revision).toBe(confirmed.draft.revision);
    await restored.getByRole('tab', { name: 'Программа', exact: true }).click();
    await expect(
      restored.getByRole('textbox', { name: 'Код Arduino C++', exact: true }),
    ).toHaveValue(source);
    await restored.getByRole('tab', { name: 'Поле', exact: true }).click();
    await expect(
      restored.getByRole('spinbutton', { name: 'Высота поля', exact: true }),
    ).toHaveValue('2.4');
    await restored.getByRole('button', { name: 'Публикация', exact: true }).click();
    const publicationDialog = restored.getByRole('dialog', {
      name: 'Публикация проекта',
      exact: true,
    });
    await expect(publicationDialog).toBeVisible();
    await publicationDialog
      .getByLabel('Описание проекта', { exact: true })
      .fill('Собственное высокое поле, стена, мяч, разметка и конструкция робота.');
    await publicationDialog.getByTestId('publication-publish').click();
    await expect(publicationDialog.getByTestId('publication-status')).toContainText('Опубликовано');
    for (const width of WIDTHS) {
      await restored.setViewportSize({ width, height: 900 });
      await noOverflow(restored);
      await publicationDialog.screenshot({ path: `${EVIDENCE}/publication-${width}.png` });
    }
    const statusResponse = await restored.request.get(`/api/projects/${projectId}/publication`);
    expect(statusResponse.status()).toBe(200);
    const publication = ((await statusResponse.json()) as ProjectPublicationStatus).publication!;
    expect(publication.state).toBe('public');
    await publicationDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    const otherAccount = await browser.newContext({
      baseURL: origin(restored),
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(otherAccount);
    const viewer = await otherAccount.newPage();
    failures.push(
      collectBrowserFailures(viewer, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      }),
    );
    observe(viewer);
    await register(viewer, 'Читатель робототехники');
    await viewer.getByLabel('Основная навигация').locator('a[href="/#/explore"]').click();
    await viewer
      .getByRole('group', { name: 'Среда проекта' })
      .getByRole('button', { name: 'Робототехника', exact: true })
      .click();
    await viewer.getByRole('searchbox', { name: 'Поиск по названию и описанию' }).fill(title);
    await viewer.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect(viewer).toHaveURL(/module=robotics/);
    const publicCard = viewer.getByTestId('public-project-card').filter({ hasText: title });
    await expect(publicCard).toBeVisible();
    await viewer.screenshot({ path: `${EVIDENCE}/community-1440.png`, fullPage: true });
    await publicCard.getByRole('link', { name: `Открыть проект «${title}»`, exact: true }).click();
    const publicView = viewer.getByTestId('public-robotics-viewer');
    await expect(publicView).toBeVisible();
    await expect(publicView).toHaveAttribute(
      'data-revision-number',
      String(publication.revisionNo),
    );
    const publicResponse = await viewer.request.get(
      `/api/public-projects/${publication.publicationId}`,
    );
    expect(publicResponse.status()).toBe(200);
    const publicMetadata = (await publicResponse.json()).publication as PublicProject;
    expect(publicMetadata.capabilities).toMatchObject({ canCopy: false, downloadFormats: [] });
    const artifactPath = `/api/public-projects/${publication.publicationId}/artifact?revisionId=${publication.revisionId}`;
    const artifactResponse = await viewer.request.get(artifactPath);
    expect(artifactResponse.status()).toBe(200);
    const artifact = (await artifactResponse.json()).artifact as PublicRoboticsArtifact;
    expect(artifact).toMatchObject({
      schemaVersion: 5,
      viewerFamily: 'robotics',
      capabilities: { readOnly: true, download: false },
      world: {
        field: { widthMeters: 0.8, heightMeters: 2.4 },
        robot: { bodyLengthMeters: 0.18 },
        initialPose: confirmed.draft.document.world.initialPose,
      },
    });
    expect(JSON.stringify(artifact)).not.toMatch(
      /arduinoSource|arduinoWorkspace|bindings|circuit|ROBOTICS_PRIVATE_PROGRAM/,
    );
    expect((await viewer.request.get(`/api/projects/${projectId}`)).status()).toBe(404);
    const ownerRoute = await viewer.request.get(
      `/api/public-projects/${publication.publicationId}/editor`,
    );
    expect(ownerRoute.status()).toBe(200);
    expect(await ownerRoute.json()).toEqual({ editor: null });

    for (const width of WIDTHS) {
      await viewer.setViewportSize({ width, height: 900 });
      await noOverflow(viewer);
      await publicView.getByRole('button', { name: 'Поле', exact: true }).click();
      await publicView.getByRole('button', { name: 'Приблизить поле', exact: true }).click();
      await expect(publicView.getByLabel('Текущий масштаб')).toHaveText('125%');
      await publicView.getByRole('button', { name: 'Показать целиком', exact: true }).click();
      await expect(publicView.getByLabel('Текущий масштаб')).toHaveText('100%');
      await expect(viewer.getByTestId('public-robotics-field')).toHaveAttribute(
        'preserveAspectRatio',
        'xMidYMid meet',
      );
      await viewer.screenshot({ path: `${EVIDENCE}/viewer-field-${width}.png`, fullPage: true });
      await publicView.getByRole('button', { name: 'Конструкция', exact: true }).click();
      await noOverflow(viewer);
      await viewer.screenshot({ path: `${EVIDENCE}/viewer-assembly-${width}.png`, fullPage: true });
    }
    // Updating the private project must leave the already published revision frozen.
    await restored.setViewportSize({ width: 1440, height: 900 });
    await restored.getByRole('tab', { name: 'Поле', exact: true }).click();
    await numberField(restored, 'Шаг сетки', 0.1);
    const changed = await saved(restored, projectId);
    expect(changed.draft.revision).toBeGreaterThan(confirmed.draft.revision);
    await viewer.reload();
    await expect(publicView).toHaveAttribute(
      'data-revision-number',
      String(publication.revisionNo),
    );
    const unchanged = await viewer.request.get(artifactPath);
    expect(unchanged.status()).toBe(200);
    expect((await unchanged.json()).artifact).toEqual(artifact);
    expect(
      serverWrites.some(
        (write) => write.path === `/api/projects/${projectId}/draft` && write.status === 200,
      ),
    ).toBe(true);
    expect(
      serverWrites.some(
        (write) => write.path === `/api/projects/${projectId}/publication` && write.status === 200,
      ),
    ).toBe(true);
    for (const failure of failures) failure.assertEmpty();
    writeFileSync(
      `${EVIDENCE}/lifecycle.json`,
      JSON.stringify(
        {
          projectId,
          revisionBeforePublication: confirmed.draft.revision,
          revisionAfterPrivateEdit: changed.draft.revision,
          publicationId: publication.publicationId,
          publicationRevisionId: publication.revisionId,
          sourceDigest: digest(confirmed.draft.document),
          artifactDigest: digest(artifact),
          freshBrowserContextRestored: true,
          secondAccountPrivateAccess: 404,
          viewportWidths: WIDTHS,
          serverWrites,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
