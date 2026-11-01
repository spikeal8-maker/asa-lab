import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { e2eAdminPool } from './seed';

const evidence = 'e2e/artifacts/publication-comments';
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });
async function layout(page: Page, section: Locator, label: string) {
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await section.screenshot({ path: `${evidence}/${label}-${width}.png` });
  }
}
async function register(page: Page, label: string) {
  const id = randomUUID().replaceAll('-', '');
  const response = await page.request.post('/api/auth/register', {
    headers: headers(page),
    data: {
      email: `comments-${id}@isolated.test`,
      username: `comment_${id.slice(0, 20)}`,
      displayName: label,
      password: `Comments-${id}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).user.id as string;
}
test('real discussion persists, class and learner permissions are independent, owner closes and admin moderates', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  if (
    !baseURL ||
    !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname) ||
    !process.env.APP_TEST_DATABASE_URL ||
    !new URL(process.env.APP_TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw Error('Isolated local test runtime required');
  const db = e2eAdminPool();
  const contexts = await Promise.all(
    [1440, 390, 1024, 390].map((width) =>
      browser.newContext({ baseURL, viewport: { width, height: 1000 } }),
    ),
  );
  const [owner, learner, moderator, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const page of [owner, learner, moderator, guest])
    page.on('pageerror', (e) => errors.push(e.message));
  let projectId: string | undefined;
  try {
    mkdirSync(evidence, { recursive: true });
    for (const page of [owner, learner, moderator, guest]) await page.goto('/#/explore');
    await register(owner, 'Анна — автор проекта');
    const adminId = await register(moderator, 'Учитель и модератор');
    await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
      adminId,
    ]);
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','comments-e2e','migration')",
      [adminId],
    );
    expect(
      (
        await moderator.request.post('/api/capabilities/educator/self-attest', {
          headers: headers(moderator),
          data: {},
        })
      ).status(),
    ).toBe(201);
    const made = await moderator.request.post('/api/classrooms', {
      headers: { ...headers(moderator), 'idempotency-key': randomUUID() },
      data: { title: 'Класс обсуждения', ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
    });
    expect(made.status()).toBe(201);
    const classId = (await made.json()).classroom.id;
    const detail = await moderator.request.get(`/api/classrooms/${classId}`);
    const code = (await detail.json()).classroom.joinCode;
    const added = await moderator.request.post(`/api/classrooms/${classId}/seats`, {
      headers: headers(moderator),
      data: { displayLabel: 'Алексей', safeMode: true },
    });
    expect(added.status()).toBe(201);
    const seat = (await added.json()).student;
    expect(
      (
        await learner.request.post('/api/class-join/studentseat', {
          headers: headers(learner),
          data: { code, studentCode: seat.studentCode },
        })
      ).status(),
    ).toBe(200);
    const created = await owner.request.post('/api/projects', {
      headers: { ...headers(owner), 'idempotency-key': randomUUID() },
      data: { scope: 'personal', module: 'three-d', title: 'Обсуждение учебного проекта' },
    });
    expect(created.status()).toBe(201);
    projectId = (await created.json()).project.id;
    const png = new PNG({ width: 32, height: 32 });
    png.data.fill(255);
    expect(
      (
        await owner.request.put(`/api/projects/${projectId}/snapshot`, {
          headers: headers(owner),
          data: {
            sourceRevision: 1,
            imageDataUrl: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
          },
        })
      ).status(),
    ).toBe(200);
    const published = await owner.request.post(`/api/projects/${projectId}/publication`, {
      headers: headers(owner),
      data: { license: 'reserved' },
    });
    expect(published.status()).toBe(200);
    const publication = (await published.json()).publication;
    const path = `/#/public-projects/${publication.publicationId}`;
    for (const page of [owner, learner, guest]) {
      await page.goto(path);
      await page.reload();
    }
    const ownerComments = owner.getByTestId('publication-comments'),
      pupilComments = learner.getByTestId('publication-comments');
    await expect(
      guest
        .getByTestId('publication-comments')
        .getByRole('link', { name: 'Войдите, чтобы оставить комментарий' }),
    ).toBeVisible();
    await expect(pupilComments).toContainText('настройкам вашего класса');
    await moderator.goto(`/#/classrooms/${classId}`);
    await moderator.reload();
    await moderator
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    const settings = moderator.getByRole('group', { name: 'Проекты класса', exact: true });
    await expect(
      settings.getByLabel('Комментарии под публикациями', { exact: true }),
    ).not.toBeChecked();
    await settings.getByLabel('Комментарии под публикациями', { exact: true }).check();
    await settings.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expect(settings.getByRole('status')).toHaveText('Разрешения проектов сохранены.');
    await expect(settings.getByLabel('Публикация проектов', { exact: true })).not.toBeChecked();
    await layout(moderator, settings, 'class-permission');
    await moderator.setViewportSize({ width: 1024, height: 1000 });
    await learner.reload();
    await pupilComments
      .getByLabel('Ваш комментарий')
      .fill('Интересный проект! Как изменить скорость?');
    await pupilComments.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(pupilComments.getByTestId('publication-comment')).toContainText(
      'Как изменить скорость?',
    );
    await learner.reload();
    await expect(pupilComments.getByTestId('publication-comment')).toContainText(
      'Как изменить скорость?',
    );
    await ownerComments.getByRole('button', { name: 'Обновить', exact: true }).click();
    await ownerComments.getByRole('button', { name: 'Ответить', exact: true }).click();
    await ownerComments
      .getByLabel('Ваш комментарий')
      .fill('Скорость можно изменить в программе. Спасибо за вопрос!');
    await ownerComments.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(
      ownerComments.getByText('Скорость можно изменить в программе. Спасибо за вопрос!', {
        exact: true,
      }),
    ).toBeVisible();
    const ownerRoot = ownerComments
      .getByTestId('publication-comment')
      .filter({ hasText: 'Интересный проект! Как изменить скорость?' });
    await ownerRoot.getByRole('button', { name: 'Нравится комментарий', exact: true }).click();
    await expect(ownerRoot.getByRole('button', { name: 'Убрать лайк комментария' })).toHaveText(
      '1',
    );
    await owner.reload();
    await expect(
      ownerRoot.getByRole('button', { name: 'Убрать лайк комментария' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await ownerRoot.getByLabel('Действия с комментарием').click();
    await ownerRoot.getByRole('button', { name: 'Закрепить', exact: true }).click();
    await expect(ownerRoot.getByText('Закреплено', { exact: true })).toBeVisible();
    await ownerComments.getByLabel('Порядок комментариев').selectOption('popular');
    await expect(ownerRoot.getByText('Закреплено', { exact: true })).toBeVisible();
    await ownerComments.getByLabel('Обсуждение открыто').click();
    await expect(ownerComments.getByLabel('Обсуждение открыто')).not.toBeChecked();
    await expect(ownerComments).toContainText('Автор закрыл обсуждение');
    await learner.reload();
    await expect(pupilComments.getByLabel('Ваш комментарий')).toHaveCount(0);
    await expect(pupilComments).toContainText('Как изменить скорость?');
    await ownerComments.getByLabel('Обсуждение открыто').click();
    await expect(ownerComments.getByLabel('Обсуждение открыто')).toBeChecked();
    await expect(ownerComments.getByLabel('Ваш комментарий')).toBeVisible();
    // Individual deny wins over class allow; individual allow also works over class OFF.
    await moderator
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Ученики', exact: true })
      .click();
    await moderator.locator('.classroom-student-name').filter({ hasText: 'Алексей' }).click();
    await moderator.getByRole('button', { name: 'Настройки', exact: true }).click();
    await moderator.getByRole('button', { name: /Публикация и скачивание/ }).click();
    const individual = moderator.getByRole('group', { name: 'Проекты ученика', exact: true });
    await individual
      .getByLabel('Комментарии под публикациями', { exact: true })
      .selectOption('deny');
    await individual.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expect(individual.getByRole('status')).toHaveText('Разрешения проектов сохранены.');
    await learner.reload();
    await expect(pupilComments).toContainText('настройкам вашего класса');
    await individual
      .getByLabel('Комментарии под публикациями', { exact: true })
      .selectOption('allow');
    await individual.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expect(individual.getByRole('status')).toHaveText('Разрешения проектов сохранены.');
    await layout(moderator, individual, 'learner-permission');
    await moderator.setViewportSize({ width: 1024, height: 1000 });
    await learner.reload();
    await pupilComments.getByLabel('Действия с комментарием').first().click();
    await pupilComments.getByRole('button', { name: 'Пожаловаться', exact: true }).first().click();
    await pupilComments.getByLabel('Причина жалобы').fill('Проверка маршрута модерации');
    await pupilComments.getByRole('button', { name: 'Отправить жалобу', exact: true }).click();
    await expect(pupilComments).toContainText('Жалоба отправлена');
    for (const width of [1440, 1024, 768, 600, 390, 320]) {
      await learner.setViewportSize({ width, height: 1000 });
      await pupilComments.scrollIntoViewIfNeeded();
      expect(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const rect = await pupilComments.boundingBox();
      expect(rect!.width).toBeLessThanOrEqual(width);
      await pupilComments.screenshot({ path: `${evidence}/discussion-${width}.png` });
    }
    await moderator.goto('/#/admin/publications');
    await moderator.reload();
    const item = moderator
      .locator('.admin-publications-list > li')
      .filter({ hasText: 'Обсуждение учебного проекта' });
    await item.getByRole('button', { name: 'Комментарии', exact: true }).click();
    const panel = item.getByTestId('admin-publication-comments');
    await expect(panel).toContainText('Проверка маршрута модерации');
    await panel.getByLabel('Причина действия').fill('Проверка скрытия администратором');
    await panel
      .locator('.admin-publication-comment')
      .filter({ hasText: 'Интересный проект! Как изменить скорость?' })
      .getByRole('button', { name: 'Скрыть модератором', exact: true })
      .click();
    await expect(panel).toContainText('Скрыт модератором');
    await panel.getByLabel('Причина действия').fill('Обсуждение временно закрыто');
    await panel.getByRole('button', { name: 'Закрыть обсуждение администратором' }).click();
    await expect(panel.getByRole('button', { name: 'Снять запрет администратора' })).toBeVisible();
    await panel.screenshot({ path: `${evidence}/admin-moderation.png` });
    await layout(moderator, panel, 'admin-moderation');
    await learner.reload();
    await expect(pupilComments).toContainText('Обсуждение закрыто администратором');
    await expect(pupilComments).toContainText('Комментарий скрыт модератором');
    const audit = await db.query(
      "SELECT reason_text FROM administrative_audit_events WHERE action='publication.comment.hide' AND reason_text=$1",
      ['Проверка скрытия администратором'],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    writeFileSync(
      `${evidence}/receipt.json`,
      JSON.stringify(
        {
          publicationId: publication.publicationId,
          persistent: true,
          classDefaultOff: true,
          individualDeny: true,
          individualAllow: true,
          authorClose: true,
          moderationAudit: true,
          widths: [1440, 1024, 768, 600, 390, 320],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    if (projectId)
      await db.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=$1",
        [projectId],
      );
    await Promise.all(contexts.map((c) => c.close()));
    await db.end();
  }
});
