import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import { e2eAdminPool } from './seed';
const EVIDENCE = 'e2e/artifacts/publication-likes';
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });
async function register(page: Page, label: string) {
  await page.goto('/#/explore');
  const id = randomUUID().replaceAll('-', '');
  const response = await page.request.post('/api/auth/register', {
    headers: headers(page),
    data: {
      email: `likes-${id}@isolated.test`,
      username: `likes_${id.slice(0, 24)}`,
      displayName: label,
      password: `Likes-${id}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user.id as string;
}
async function pupil(teacher: Page, reader: Page) {
  expect(
    (
      await teacher.request.post('/api/capabilities/educator/self-attest', {
        headers: headers(teacher),
        data: {},
      })
    ).status(),
  ).toBe(201);
  const made = await teacher.request.post('/api/classrooms', {
    headers: { ...headers(teacher), 'idempotency-key': randomUUID() },
    data: {
      title: 'Likes default-OFF class',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(made.status()).toBe(201);
  const id = (await made.json()).classroom.id;
  const detail = await teacher.request.get(`/api/classrooms/${id}`);
  const code = (await detail.json()).classroom.joinCode;
  const added = await teacher.request.post(`/api/classrooms/${id}/seats`, {
    headers: headers(teacher),
    data: { displayLabel: 'Ученик читатель', safeMode: true },
  });
  expect(added.status()).toBe(201);
  const student = (await added.json()).student;
  // Deliberately leave publication and download OFF; liking is independent.
  await reader.goto('/#/explore');
  const joined = await reader.request.post('/api/class-join/studentseat', {
    headers: headers(reader),
    data: { code, studentCode: student.studentCode },
  });
  expect(joined.status()).toBe(200);
}
for (const { width, seat } of [
  { width: 1440, seat: false },
  { width: 390, seat: true },
]) {
  test(`${seat ? 'Seat' : 'Account'} likes persist and admin controls work at ${width}px`, async ({
    browser,
  }) => {
    const db = e2eAdminPool();
    const contexts = await Promise.all(
      [1440, width, 1440].map((w) => browser.newContext({ viewport: { width: w, height: 1000 } })),
    );
    const [author, reader, moderator] = await Promise.all(contexts.map((c) => c.newPage()));
    let source: string | undefined;
    try {
      mkdirSync(EVIDENCE, { recursive: true });
      const build = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
      expect(build.revision).toBe(process.env.ASA_BUILD_REVISION);
      const authorId = await register(author, 'Автор без собственного лайка');
      const adminId = await register(moderator, 'Администратор реакций');
      await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
        adminId,
      ]);
      await db.query(
        "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','publication-likes-test','migration')",
        [adminId],
      );
      if (seat) await pupil(moderator, reader);
      else await register(reader, 'Читатель публикации');
      const created = await author.request.post('/api/projects', {
        headers: { ...headers(author), 'idempotency-key': randomUUID() },
        data: { scope: 'personal', module: 'three-d', title: `Like source ${randomUUID()}` },
      });
      expect(created.status()).toBe(201);
      source = (await created.json()).project.id;
      const png = new PNG({ width: 32, height: 32 });
      png.data.fill(255);
      const snapshot = await author.request.put(`/api/projects/${source}/snapshot`, {
        headers: headers(author),
        data: {
          sourceRevision: 1,
          imageDataUrl: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
        },
      });
      expect(snapshot.status()).toBe(200);
      const published = await author.request.post(`/api/projects/${source}/publication`, {
        headers: headers(author),
        data: { license: 'reserved' },
      });
      expect(published.status()).toBe(200);
      const publication = (await published.json()).publication;
      const path = `/#/public-projects/${publication.publicationId}`;
      await author.goto(path);
      await expect(author.getByTestId('publication-like-button')).toBeDisabled();
      expect(
        (
          await db.query(
            'SELECT account_id FROM principals WHERE id=(SELECT owner_principal_id FROM projects WHERE id=$1)',
            [source],
          )
        ).rows[0].account_id,
      ).toBe(authorId);
      await reader.goto(path);
      const button = reader.getByTestId('publication-like-button');
      await expect(button).toBeEnabled();
      await expect(reader.getByTestId('publication-like-count')).toHaveText('0');
      const saved = reader.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/public-projects/${publication.publicationId}/like`) &&
          r.request().method() === 'PUT',
      );
      await button.click();
      expect((await saved).status()).toBe(200);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(reader.getByTestId('publication-like-count')).toHaveText('1');
      await reader.reload();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(reader.getByTestId('publication-like-count')).toHaveText('1');
      const republished = await author.request.post(`/api/projects/${source}/publication`, {
        headers: headers(author),
        data: { title: 'Updated title; same liked work', license: 'reserved' },
      });
      expect(republished.status()).toBe(200);
      await reader.reload();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await reader.screenshot({
        path: `${EVIDENCE}/${seat ? 'seat' : 'account'}-${width}-liked.png`,
        fullPage: true,
      });
      expect(
        await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await moderator.goto('/#/admin/publications');
      // Ground this selector in the actual publication list item rather than a global dialog.
      const item = moderator
        .locator('.admin-publications-list > li')
        .filter({ hasText: 'Updated title; same liked work' });
      await expect(item).toBeVisible();
      await item.getByTestId('admin-publication-reactions').locator('summary').click();
      await expect(item.getByRole('button', { name: 'Отключить реакции' })).toBeDisabled();
      await item.getByLabel('Причина изменения реакций').fill('Reviewed test reactions');
      const disabled = moderator.waitForResponse(
        (r) =>
          r.url().endsWith(`/${publication.publicationId}/reactions`) &&
          r.request().method() === 'POST',
      );
      await item.getByRole('button', { name: 'Отключить реакции' }).click();
      expect((await disabled).ok()).toBe(true);
      await expect(item.getByTestId('admin-publication-reactions')).toContainText(
        '1 нравится · Реакции выключены',
      );
      await moderator.screenshot({
        path: `${EVIDENCE}/${seat ? 'seat' : 'account'}-admin-disabled.png`,
        fullPage: true,
      });
      await reader.reload();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(button).toBeEnabled();
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(reader.getByTestId('publication-like-count')).toHaveText('0');
      await expect(button).toBeDisabled();
      const audit = (
        await db.query(
          "SELECT reason_text FROM administrative_audit_events WHERE action='publication.reactions' AND target_id=$1",
          [publication.publicationId],
        )
      ).rows;
      expect(audit).toEqual([{ reason_text: 'Reviewed test reactions' }]);
      writeFileSync(
        `${EVIDENCE}/${seat ? 'seat' : 'account'}-receipt.json`,
        JSON.stringify(
          {
            revision: build.revision,
            width,
            seat,
            publicationId: publication.publicationId,
            retainedAfterReload: true,
            retainedAfterUpdate: true,
            disabledWithAudit: true,
            unlikeWhileDisabled: true,
          },
          null,
          2,
        ),
      );
    } finally {
      if (source)
        await db.query(
          "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=$1",
          [source],
        );
      await Promise.all(contexts.map((c) => c.close()));
      await db.end();
    }
  });
}
