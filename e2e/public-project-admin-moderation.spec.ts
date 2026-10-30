import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import { e2eAdminPool } from './seed';
import { collectBrowserFailures } from './browser-failures';
import { createEmptyThreeDDocument, createThreeDNode } from '../contexts/three-d/domain/document';

const EVIDENCE = 'e2e/artifacts/public-project-admin-moderation';
const BASE = '/api/admin/v1/publications';
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });

async function register(page: Page) {
  await page.goto('/#/explore');
  const id = randomUUID().replaceAll('-', '');
  const response = await page.request.post('/api/auth/register', {
    headers: headers(page),
    data: {
      email: `moderation-${id}@isolated.test`,
      username: `mod_${id.slice(0, 24)}`,
      displayName: 'Автор проверки модерации',
      password: `Moderation-${id}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.status()).toBe(201);
  const session = await response.json();
  expect(session.authenticated).toBe(true);
  return session.user.id as string;
}

// A real raster is setup data, never claimed as editor rendering evidence.
function raster() {
  const image = new PNG({ width: 32, height: 32 });
  image.data.fill(255);
  const bytes = PNG.sync.write(image);
  expect(PNG.sync.read(bytes).data).toEqual(image.data);
  return { bytes, imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
}

for (const width of [1440, 1024, 390, 320]) {
  test(`verified platform admin visibly hides and restores a publication at ${width}px`, async ({
    browser,
  }) => {
    const db = e2eAdminPool();
    const contexts = await Promise.all(
      // Admin and public viewer use the tested viewport; the author remains on desktop.
      [width, 1440, width].map((w) => browser.newContext({ viewport: { width: w, height: 1000 } })),
    );
    const [moderator, author, guest] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const verifyPublicViewport = async () => {
      const actual = await guest.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(actual.viewport).toBe(width);
      expect(actual.document).toBeLessThanOrEqual(width);
    };
    const failures = [moderator, author, guest].map((page) =>
      collectBrowserFailures(page, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      }),
    );
    try {
      mkdirSync(EVIDENCE, { recursive: true });
      const metadata = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
      expect(metadata.revision).toBe(process.env.ASA_BUILD_REVISION);
      writeFileSync(`${EVIDENCE}/${width}-build.json`, JSON.stringify(metadata, null, 2));
      const adminId = await register(moderator);
      const authorId = await register(author);
      await guest.goto('/#/explore');
      // Only isolated *_test fixtures receive a real verified capability.
      await db.query(
        `INSERT INTO capability_grants
        (account_id, capability, state, policy_version, granted_by)
        VALUES ($1,'platform_admin','verified','asa-lab-2026-07','migration')`,
        [adminId],
      );
      // The platform admin also needs a verified Account. This is disposable
      // *_test fixture setup, not a bypass of the production confirmation gate.
      await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
        adminId,
      ]);
      const checkedSession = await moderator.request.get('/api/auth/me');
      expect(checkedSession.status()).toBe(200);
      const adminSession = await checkedSession.json();
      expect(adminSession.verification?.required).toBe(false);
      expect(adminSession.capabilities).toEqual(
        expect.arrayContaining([{ capability: 'platform_admin', state: 'verified' }]),
      );
      // Prove the same authenticated transport can resolve the real admin scope.
      const adminProfile = await moderator.request.get('/api/admin/v1/me');
      expect(adminProfile.status()).toBe(200);
      expect((await adminProfile.json()).scopes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'platform',
            role: 'platform_admin',
          }),
        ]),
      );
      const actor = (await db.query('SELECT id FROM principals WHERE account_id=$1', [adminId]))
        .rows[0].id;
      const title = `Safety publication ${randomUUID()}`;
      const created = await author.request.post('/api/projects', {
        headers: { ...headers(author), 'idempotency-key': randomUUID() },
        data: { scope: 'personal', module: 'three-d', title },
      });
      expect(created.status()).toBe(201);
      const projectId = (await created.json()).project.id as string;
      const document = {
        ...createEmptyThreeDDocument(),
        nodes: [createThreeDNode('box', 'moderated-box')],
      };
      const saved = await author.request.put(`/api/projects/${projectId}/draft`, {
        headers: headers(author),
        data: { document, baseRevision: 1, mutationId: randomUUID() },
      });
      expect(saved.status()).toBe(200);
      const draft = (await saved.json()).draft;
      const image = raster();
      expect(
        (
          await author.request.put(`/api/projects/${projectId}/snapshot`, {
            headers: headers(author),
            data: { sourceRevision: draft.revision, imageDataUrl: image.imageDataUrl },
          })
        ).status(),
      ).toBe(200);
      const published = await author.request.post(`/api/projects/${projectId}/publication`, {
        headers: headers(author),
        data: { license: 'public-domain' },
      });
      expect(published.status()).toBe(200);
      const { publicationId, revisionId } = (await published.json()).publication;
      const publicPath = `/api/public-projects/${publicationId}`;
      const privatePath = `/api/projects/${projectId}`;
      const original = async () => {
        const response = await author.request.get(privatePath);
        expect(response.status()).toBe(200);
        return (await response.json()).draft;
      };
      const frozen = async () =>
        (
          await db.query(
            `SELECT to_jsonb(v) version FROM project_versions v
        WHERE project_id=$1 ORDER BY version_no`,
            [projectId],
          )
        ).rows;
      const draftBefore = await original();
      const versionsBefore = await frozen();
      expect(versionsBefore).toHaveLength(1);
      const projectRecord = async () =>
        (await db.query('SELECT to_jsonb(p) project FROM projects p WHERE id=$1', [projectId]))
          .rows;
      const projectBefore = await projectRecord();
      const detail = await guest.request.get(publicPath);
      expect(detail.status()).toBe(200);
      const publicImage = (await detail.json()).publication.preview.url as string;
      expect((await guest.request.get(publicImage)).status()).toBe(200);
      expect((await guest.request.get(`${BASE}?offset=0&limit=25`)).status()).toBe(401);
      expect((await guest.request.get(`${BASE}/${publicationId}/image`)).status()).toBe(401);
      for (const action of ['hide', 'restore']) {
        expect(
          (
            await guest.request.post(`${BASE}/${publicationId}/${action}`, {
              headers: headers(guest),
              data: { reason: 'Anonymous request' },
            })
          ).status(),
        ).toBe(401);
      }

      const forbidden = async () => {
        expect((await author.request.get(`${BASE}?offset=0&limit=25`)).status()).toBe(403);
        expect((await author.request.get(`${BASE}/${publicationId}/image`)).status()).toBe(403);
        for (const action of ['hide', 'restore'])
          expect(
            (
              await author.request.post(`${BASE}/${publicationId}/${action}`, {
                headers: headers(author),
                data: { reason: 'No platform authority' },
              })
            ).status(),
          ).toBe(403);
      };
      await forbidden();
      // The same ordinary Account now has a genuine organization moderator role.
      const tenant = (
        await db.query(
          "INSERT INTO tenants (workspace_slug,title) VALUES ($1,'Moderation fixture') RETURNING id",
          [`mod-${randomUUID()}`],
        )
      ).rows[0].id;
      const workspace = (
        await db.query(
          `INSERT INTO workspaces (tenant_id,kind,title)
        VALUES ($1,'organization','Moderation fixture') RETURNING id`,
          [tenant],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO workspace_memberships (account_id,workspace_id,role) VALUES ($1,$2,'moderator')",
        [authorId, workspace],
      );
      await forbidden();

      await moderator.goto('/#/admin/publications');
      // Registration used Playwright's APIRequestContext, which shares cookies
      // but does not update the already-mounted SPA session state. A hash-only
      // navigation is same-document: reload the real app to re-read that session.
      await moderator.reload();
      expect(new URL(moderator.url()).hash).toBe('#/admin/publications');
      await moderator.screenshot({
        path: `${EVIDENCE}/${width}-admin-entry.png`,
        fullPage: true,
      });
      await expect(
        moderator.getByRole('heading', { name: 'Публикации', exact: true }),
      ).toBeVisible();
      const row = moderator
        .getByRole('listitem')
        .filter({ has: moderator.getByRole('heading', { name: title, exact: true }) });
      await expect(row).toBeVisible();
      const preview = row.getByRole('img', { name: `Превью: ${title}`, exact: true });
      await expect(preview).toBeVisible();
      // Controls must not squeeze publication information into a one-letter
      // column, even before the subsequent hide/restore overflow checks.
      expect(
        await row.evaluate((element) => {
          const details = element.querySelector('.admin-publication-details');
          const preview = element.querySelector('.admin-publication-preview');
          return (
            !!details &&
            !!preview &&
            details.getBoundingClientRect().width >= preview.getBoundingClientRect().width
          );
        }),
      ).toBe(true);
      await expect
        .poll(() =>
          preview.evaluate((element) => {
            const img = element as HTMLImageElement;
            return img.complete && img.naturalWidth === 32 && img.naturalHeight === 32;
          }),
        )
        .toBe(true);
      const adminImage = await moderator.request.get(`${BASE}/${publicationId}/image`);
      expect(adminImage.status()).toBe(200);
      expect(await adminImage.body()).toEqual(image.bytes);
      await moderator.screenshot({ path: `${EVIDENCE}/${width}-visible.png`, fullPage: true });
      const audit = async () =>
        (
          await db.query(
            `SELECT * FROM administrative_audit_events
        WHERE target_type='project_publication' AND target_id=$1 ORDER BY occurred_at,id`,
            [publicationId],
          )
        ).rows;
      expect(await audit()).toEqual([]);
      const reasons = [
        'Вредоносная публикация: проверка безопасности',
        'Проверка завершена: восстановление',
      ];
      let hideAudit: Awaited<ReturnType<typeof audit>> = [];
      for (const [index, action] of ['hide', 'restore'].entries()) {
        const hiding = action === 'hide';
        await row
          .getByRole('button', { name: hiding ? 'Скрыть' : 'Восстановить', exact: true })
          .click();
        const dialog = moderator.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const confirm = dialog.getByRole('button', {
          name: hiding ? 'Подтвердить скрытие' : 'Подтвердить восстановление',
          exact: true,
        });
        await expect(confirm).toBeDisabled();
        await dialog.getByLabel('Причина (обязательно, до 500 символов)').fill(reasons[index]);
        const responsePromise = moderator.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === `${BASE}/${publicationId}/${action}`,
        );
        await confirm.click();
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        expect(response.request().postDataJSON()).toEqual({
          reason: reasons[index],
          expectedVersion: index,
          expectedRevisionId: revisionId,
        });
        expect(await response.json()).toMatchObject({ publicationId, hidden: hiding });
        await expect(dialog).not.toBeVisible();
        await expect(
          row.getByRole('button', { name: hiding ? 'Восстановить' : 'Скрыть', exact: true }),
        ).toBeVisible();
        expect(
          await moderator.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await moderator.screenshot({ path: `${EVIDENCE}/${width}-${action}.png`, fullPage: true });
        const listing = await guest.request.get('/api/public-projects?limit=48');
        expect(listing.status()).toBe(200);
        expect(
          (await listing.json()).items.some(
            (item: { publicationId: string }) => item.publicationId === publicationId,
          ),
        ).toBe(!hiding);
        for (const page of [guest, author]) {
          expect((await page.request.get(publicPath)).status()).toBe(hiding ? 404 : 200);
          const picture = await page.request.get(publicImage);
          expect(picture.status()).toBe(hiding ? 404 : 200);
          if (!hiding) expect(await picture.body()).toEqual(image.bytes);
        }
        if (hiding) {
          expect(
            (
              await author.request.post(`${publicPath}/copy`, {
                headers: { ...headers(author), 'idempotency-key': randomUUID() },
                data: { revisionId },
              })
            ).status(),
          ).toBe(404);
          const status = await author.request.get(`${privatePath}/publication`);
          expect(status.status()).toBe(200);
          expect(await status.json()).toMatchObject({ moderationReason: reasons[0] });
        }
        expect(await original()).toEqual(draftBefore);
        expect(await projectRecord()).toEqual(projectBefore);
        expect(await frozen()).toEqual(versionsBefore);
        const events = await audit();
        expect(events).toHaveLength(index + 1);
        expect(events[index]).toMatchObject({
          actor_principal_id: actor,
          actor_account_id: adminId,
          actor_role: 'platform_admin',
          scope_kind: 'platform',
          scope_id: null,
          action: `publication.${action}`,
          reason_text: reasons[index],
          result: 'succeeded',
          before_version: hiding ? '0' : '1',
          after_version: hiding ? '1' : '2',
        });
        expect(events[index].request_id.trim().length).toBeGreaterThan(0);
        if (hiding) hideAudit = events;
        else expect(events[0]).toEqual(hideAudit[0]);
      }

      // The visible editorial slice follows moderation restore. A badge selected
      // for a prior moderation state must not survive hide/restore automatically.
      expect((await guest.request.get(publicPath)).status()).toBe(200);
      const editorialListResponse = await moderator.request.get(`${BASE}?offset=0&limit=25`);
      expect(editorialListResponse.status()).toBe(200);
      const editorialSnapshot = (await editorialListResponse.json()).items.find(
        (item: { publicationId: string }) => item.publicationId === publicationId,
      ) as { lifecycleVersion: number } | undefined;
      expect(editorialSnapshot).toBeDefined();
      const lifecycleVersion = editorialSnapshot!.lifecycleVersion;
      expect(Number.isSafeInteger(lifecycleVersion)).toBe(true);

      const featureResponse = moderator.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `${BASE}/${publicationId}/featured`,
      );
      await row.getByRole('button', { name: 'Выбор редакции', exact: true }).click();
      const feature = await featureResponse;
      expect(feature.status()).toBe(200);
      expect(feature.request().postDataJSON()).toEqual({
        featured: true,
        expectedVersion: 0,
        expectedRevisionId: revisionId,
        expectedModerationVersion: 2,
        expectedLifecycleVersion: lifecycleVersion,
      });
      expect(await feature.json()).toMatchObject({
        publicationId,
        revisionId,
        featured: true,
        editorialVersion: 1,
        lifecycleVersion,
      });
      await expect(row.getByTestId('admin-publication-featured')).toContainText('Выбор редакции');

      const publishedFeatured = await guest.request.get(publicPath);
      expect(publishedFeatured.status()).toBe(200);
      expect((await publishedFeatured.json()).publication).toMatchObject({ featured: true });
      await guest.goto('/#/explore');
      await guest.reload();
      const card = guest.getByTestId('public-project-card').filter({
        has: guest.getByRole('heading', { name: title, exact: true }),
      });
      await expect(card.getByTestId('public-project-featured')).toContainText('Выбор редакции');
      await verifyPublicViewport();
      await guest.screenshot({
        path: `${EVIDENCE}/${width}-featured-catalog.png`,
        fullPage: true,
      });
      await guest.goto(`/#/public-projects/${publicationId}`);
      await guest.reload();
      await expect(guest.getByTestId('public-project-featured')).toContainText('Выбор редакции');
      await verifyPublicViewport();
      await guest.screenshot({
        path: `${EVIDENCE}/${width}-featured-detail.png`,
        fullPage: true,
      });

      const unfeatureResponse = moderator.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `${BASE}/${publicationId}/featured`,
      );
      await row.getByRole('button', { name: 'Снять отметку', exact: true }).click();
      const unfeature = await unfeatureResponse;
      expect(unfeature.status()).toBe(200);
      expect(unfeature.request().postDataJSON()).toEqual({
        featured: false,
        expectedVersion: 1,
        expectedRevisionId: revisionId,
        expectedModerationVersion: 2,
        expectedLifecycleVersion: lifecycleVersion,
      });
      expect(await unfeature.json()).toMatchObject({
        featured: false,
        editorialVersion: 2,
        lifecycleVersion,
      });
      await expect(row.getByTestId('admin-publication-featured')).toHaveCount(0);
      await guest.reload();
      await expect(guest.getByTestId('public-project-featured')).toHaveCount(0);

      const withEditorialAudit = await audit();
      expect(withEditorialAudit).toHaveLength(4);
      expect(withEditorialAudit[2]).toMatchObject({
        actor_principal_id: actor,
        action: 'publication.feature',
        before_version: '0',
        after_version: '1',
        reason_text: 'Выбор редакции',
      });
      expect(withEditorialAudit[3]).toMatchObject({
        actor_principal_id: actor,
        action: 'publication.unfeature',
        before_version: '1',
        after_version: '2',
        reason_text: 'Отметка редакции снята',
      });
      // R8-03C: pinning is an independent administrative action and survives reload.
      const pinResponse = moderator.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `${BASE}/${publicationId}/pin`,
      );
      await row.getByRole('button', { name: 'Закрепить', exact: true }).click();
      const pinReceipt = await pinResponse;
      expect(pinReceipt.status()).toBe(200);
      expect(pinReceipt.request().postDataJSON()).toEqual({
        pinned: true,
        expectedVersion: 0,
        expectedRevisionId: revisionId,
        expectedModerationVersion: 2,
        expectedLifecycleVersion: lifecycleVersion,
      });
      expect(await pinReceipt.json()).toMatchObject({ pinned: true, pinVersion: 1 });
      await expect(row.getByTestId('admin-publication-pinned')).toContainText('Закреплено');
      await guest.goto('/#/explore');
      await guest.reload();
      const pinnedCard = guest.getByTestId('public-project-card').filter({
        has: guest.getByRole('heading', { name: title, exact: true }),
      });
      await expect(pinnedCard.getByTestId('public-project-pinned')).toContainText('Закреплено');
      await verifyPublicViewport();
      await guest.screenshot({ path: `${EVIDENCE}/${width}-pinned-catalog.png`, fullPage: true });
      await guest.goto(`/#/public-projects/${publicationId}`);
      await guest.reload();
      await expect(guest.getByTestId('public-project-pinned')).toContainText('Закреплено');
      await verifyPublicViewport();
      await guest.screenshot({ path: `${EVIDENCE}/${width}-pinned-detail.png`, fullPage: true });
      const unpinResponse = moderator.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `${BASE}/${publicationId}/pin`,
      );
      await row.getByRole('button', { name: 'Открепить', exact: true }).click();
      const unpinReceipt = await unpinResponse;
      expect(unpinReceipt.status()).toBe(200);
      expect(unpinReceipt.request().postDataJSON()).toMatchObject({
        pinned: false,
        expectedVersion: 1,
        expectedRevisionId: revisionId,
        expectedModerationVersion: 2,
        expectedLifecycleVersion: lifecycleVersion,
      });
      expect(await unpinReceipt.json()).toMatchObject({ pinned: false, pinVersion: 2 });
      await guest.reload();
      await expect(guest.getByTestId('public-project-pinned')).toHaveCount(0);
      const pinnedAudit = await audit();
      expect(pinnedAudit).toHaveLength(6);
      expect(pinnedAudit[4]).toMatchObject({
        action: 'publication.pin',
        before_version: '0',
        after_version: '1',
      });
      expect(pinnedAudit[5]).toMatchObject({
        action: 'publication.unpin',
        before_version: '1',
        after_version: '2',
      });

      expect(await original()).toEqual(draftBefore);
      expect(await projectRecord()).toEqual(projectBefore);
      expect(await frozen()).toEqual(versionsBefore);

      failures.forEach((collector) => collector.assertEmpty());
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await db.end();
    }
  });
}
