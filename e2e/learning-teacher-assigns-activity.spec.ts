import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { openPortalSection } from './portal-navigation';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const evidenceDir = 'e2e/artifacts/learning/vs-001';
const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

let admin: pg.Pool;
let teacher: SeededTeacher;
let sequence = 0;
const keys = new Map<string, string>();
test.use({ actionTimeout: 12000 });

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'learning-vs-001-browser');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

function solidPng(red: number, green: number, blue: number): Buffer {
  const image = new PNG({ width: 3, height: 3 });
  for (let pixel = 0; pixel < 9; pixel += 1) {
    const offset = pixel * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function createPublishedProjectActivity(title: string): Promise<void> {
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  const principalId = identity.rows[0].principal_id as string;
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Соберите рабочую электрическую цепь.','electronics','private')
     RETURNING id`,
    [teacher.tenantId, principalId, title],
  );
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [teacher.tenantId]);
    const created = await client.query(
      `SELECT * FROM learning_activity_create(
        $1,$2,'school','private','project',$3,'ignored','completion',NULL,
        $4::jsonb,'electronics',NULL,NULL,$5,$6)`,
      [
        principalId,
        teacher.tenantId,
        title,
        JSON.stringify(policies),
        authored.rows[0].id,
        `vs:e2e:create:${++sequence}`,
      ],
    );
    await client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      principalId,
      teacher.tenantId,
      created.rows[0].activity_id,
      `vs:e2e:publish:${++sequence}`,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createClassWithStudents(
  page: Page,
  className: string,
  students: ReadonlyArray<{ label: string; handle: string }>,
  alreadyAuthenticated = false,
): Promise<string> {
  if (!alreadyAuthenticated) await loginWithOrganization(page, teacher);
  await openPortalSection(page, 'Классы');
  await page
    .getByRole('button', { name: /^Создать(?: новый)? класс$/ })
    .first()
    .click();
  const create = page.getByRole('dialog', { name: 'Создать класс' });
  await create.getByLabel('Название класса').fill(className);
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: className })
    .locator('.classroom-row-title')
    .click();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  for (const student of students) {
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Имя в списке класса').fill(student.label);
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dialog).toBeHidden();
    const rosterRow = page.getByRole('row').filter({ hasText: student.label });
    const studentCode = (await rosterRow.locator('.classroom-login-handle').innerText()).trim();
    expect(studentCode).toMatch(/^[2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy]{6}$/);
    keys.set(student.handle, studentCode);
  }
  return joinCode;
}

async function openAssignments(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Отдельные задания', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Задания класса' })).toBeVisible();
}

async function assignFromUi(
  page: Page,
  input: { title: string; due: string; students?: string[] },
): Promise<void> {
  await page.getByRole('button', { name: 'Назначить задание', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Назначить задание' });
  await dialog.getByLabel('Задание').selectOption({ label: input.title });
  if (input.students) {
    await dialog.getByLabel('Выбранные ученики').check();
    for (const student of input.students) await dialog.getByLabel(student).check();
  }
  await dialog.getByLabel('Срок', { exact: true }).fill(input.due + 'T18:00');
  await dialog.screenshot({
    path: `${evidenceDir}/${input.students ? 'dialog-two-learners' : 'dialog-whole-class'}.png`,
  });
  await dialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function learnerAssignments(
  browser: Browser,
  joinCode: string,
  handle: string,
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await expect(page.getByLabel('Код ученика', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toHaveCount(0);
  await page.getByLabel('Код ученика', { exact: true }).fill(keys.get(handle)!);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await openPortalSection(page, 'Моё обучение');
  return { context, page };
}

test('teacher assigns a canonical activity to the whole class and a learner sees it', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Светодиод и резистор ${++sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, '7А — Электроника', [
    { label: 'Анна', handle: 'anna-vs-whole' },
    { label: 'Борис', handle: 'boris-vs-whole' },
    { label: 'Вера', handle: 'vera-vs-whole' },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2026-09-30' });

  const teacherRow = page.getByTestId('assignment-list').locator('li').filter({ hasText: title });
  await expect(teacherRow).toContainText('Весь класс');
  await expect(teacherRow).toContainText('Срок');
  await teacherRow.screenshot({ path: `${evidenceDir}/teacher-whole-class.png` });

  const learner = await learnerAssignments(browser, joinCode, 'anna-vs-whole');
  const learnerFailures = collectBrowserFailures(learner.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  const learnerRow = learner.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: title });
  await expect(learnerRow).toContainText('Не начато');
  await expect(learnerRow).toContainText('Сдать до');
  await expect(learnerRow.getByRole('button', { name: 'Открыть', exact: true })).toBeVisible();
  await learnerRow.screenshot({ path: `${evidenceDir}/learner-whole-class.png` });

  failures.assertEmpty();
  learnerFailures.assertEmpty();
  await learner.context.close();
});

test('teacher selects two learners and the third learner cannot see the assignment', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Точная цепь ${++sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, '8Б — Практика', [
    { label: 'Галя', handle: 'galya-vs-named' },
    { label: 'Дима', handle: 'dima-vs-named' },
    { label: 'Егор', handle: 'egor-vs-named' },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2026-10-07', students: ['Галя', 'Дима'] });

  const teacherRow = page.getByTestId('assignment-list').locator('li').filter({ hasText: title });
  await expect(teacherRow).toContainText('Выбрано: 2');
  await teacherRow.screenshot({ path: `${evidenceDir}/teacher-two-learners.png` });

  for (const handle of ['galya-vs-named', 'dima-vs-named']) {
    const learner = await learnerAssignments(browser, joinCode, handle);
    await expect(
      learner.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title }),
    ).toBeVisible();
    await learner.context.close();
  }
  const excluded = await learnerAssignments(browser, joinCode, 'egor-vs-named');
  await expect(excluded.page.getByText(title, { exact: true })).toHaveCount(0);
  await expect(excluded.page.locator('.portal-nav-count')).toHaveCount(0);
  await excluded.page.screenshot({
    path: `${evidenceDir}/learner-third-excluded.png`,
    fullPage: true,
  });
  await excluded.context.close();

  failures.assertEmpty();
});

test('learner exact published task image stays pinned across v1 and v2', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const token = ++sequence;
  const title = `Exact learner image ${token}`;
  const imageA = solidPng(205, 45, 45);
  const imageB = solidPng(40, 75, 210);

  await loginWithOrganization(page, teacher);
  await page.goto('/#/challenges');
  await page.getByLabel('Название материала', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Соберите схему по точному образцу.');
  const fileInput = page.getByLabel('Файл схемы или изображения', { exact: true });
  await fileInput.setInputFiles({
    name: 'learner-exact-a.png',
    mimeType: 'image/png',
    buffer: imageA,
  });
  const publishV1 = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const v1Response = await publishV1;
  expect(v1Response.ok()).toBe(true);
  const v1 = (await v1Response.json()) as { id: string; versionNumber: number };
  expect(v1.versionNumber).toBe(1);

  const joinCodeV1 = await createClassWithStudents(
    page,
    `UX1A3 V1 ${token}`,
    [{ label: `Learner A ${token}`, handle: `ux1a3-a-${token}` }],
    true,
  );
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-09-30' });

  const learnerA = await learnerAssignments(browser, joinCodeV1, `ux1a3-a-${token}`);
  const learnerAFailures = collectBrowserFailures(learnerA.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  let rowA = learnerA.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
  const cardImageA = rowA.getByRole('img', { name: `Образец: ${title}` });
  await expect(cardImageA).toBeVisible();
  const cardSourceA = await cardImageA.getAttribute('src');
  expect(cardSourceA).toContain(`/api/assignments/activity-versions/${v1.id}/sample`);
  const cardBytesA = await learnerA.page.request.get(
    new URL(cardSourceA!, learnerA.page.url()).toString(),
  );
  expect(cardBytesA.ok()).toBe(true);
  expect(Buffer.compare(await cardBytesA.body(), imageA)).toBe(0);

  await rowA.getByRole('button', { name: title, exact: true }).click();
  const assignmentViewA = rowA.getByTestId('assignment-view');
  const detailImageA = assignmentViewA.getByRole('img', { name: `Образец: ${title}` });
  await expect(detailImageA).toBeVisible();
  await assignmentViewA.getByRole('button', { name: `Открыть образец: ${title}` }).click();
  const homeLightbox = learnerA.page.getByRole('dialog', { name: `Образец: ${title}` });
  await expect(homeLightbox).toBeVisible();
  await homeLightbox.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(homeLightbox).toHaveCount(0);

  await rowA.getByRole('button', { name: 'Открыть', exact: true }).click();
  const briefAnchor = learnerA.page.getByTestId('assignment-brief-anchor');
  await expect(briefAnchor).toBeVisible({ timeout: 60_000 });
  await briefAnchor.click();
  const brief = learnerA.page.getByTestId('assignment-brief');
  await expect(brief).toBeVisible();
  const briefImageA = brief.getByRole('img', { name: `Образец: ${title}` });
  await expect(briefImageA).toBeVisible();
  await brief.getByRole('button', { name: `Открыть образец: ${title}` }).click();
  const briefLightbox = learnerA.page.getByRole('dialog', { name: `Образец: ${title}` });
  await expect(briefLightbox).toBeVisible();
  await briefLightbox.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await page.goto('/#/challenges');
  await page.getByRole('button', { name: title, exact: true }).click();
  const replaceInput = page.getByLabel('Файл схемы или изображения', { exact: true });
  await replaceInput.setInputFiles({
    name: 'learner-exact-b.png',
    mimeType: 'image/png',
    buffer: imageB,
  });
  const saveImageB = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-sample$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const savedImageB = await saveImageB;
  expect(savedImageB.ok()).toBe(true);
  const publishV2 = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const v2Response = await publishV2;
  expect(v2Response.ok()).toBe(true);
  const v2 = (await v2Response.json()) as { id: string; versionNumber: number };
  expect(v2.versionNumber).toBe(2);
  expect(v2.id).not.toBe(v1.id);

  await learnerA.page.goto('/#/');
  await openPortalSection(learnerA.page, 'Моё обучение');
  rowA = learnerA.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
  const v1StillA = rowA.getByRole('img', { name: `Образец: ${title}` });
  await expect(v1StillA).toBeVisible();
  const v1StillASource = await v1StillA.getAttribute('src');
  expect(v1StillASource).toContain(`/api/assignments/activity-versions/${v1.id}/sample`);
  const v1StillABytes = await learnerA.page.request.get(
    new URL(v1StillASource!, learnerA.page.url()).toString(),
  );
  expect(v1StillABytes.ok()).toBe(true);
  expect(Buffer.compare(await v1StillABytes.body(), imageA)).toBe(0);

  const joinCodeV2 = await createClassWithStudents(
    page,
    `UX1A3 V2 ${token}`,
    [{ label: `Learner B ${token}`, handle: `ux1a3-b-${token}` }],
    true,
  );
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-10-07' });
  const learnerB = await learnerAssignments(browser, joinCodeV2, `ux1a3-b-${token}`);
  const learnerBFailures = collectBrowserFailures(learnerB.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  const rowB = learnerB.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: title });
  const cardImageB = rowB.getByRole('img', { name: `Образец: ${title}` });
  await expect(cardImageB).toBeVisible();
  const cardSourceB = await cardImageB.getAttribute('src');
  expect(cardSourceB).toContain(`/api/assignments/activity-versions/${v2.id}/sample`);
  const cardBytesB = await learnerB.page.request.get(
    new URL(cardSourceB!, learnerB.page.url()).toString(),
  );
  expect(cardBytesB.ok()).toBe(true);
  expect(Buffer.compare(await cardBytesB.body(), imageB)).toBe(0);

  failures.assertEmpty();
  learnerAFailures.assertEmpty();
  learnerBFailures.assertEmpty();
  await learnerA.context.close();
  await learnerB.context.close();
});
