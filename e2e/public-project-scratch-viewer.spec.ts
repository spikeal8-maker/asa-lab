import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  publicScratchFixture,
  persistPublicScratchFixture,
} from '../apps/api/src/testing/fixtures/public-scratch';
import { e2eAdminPool, seedTeacher } from './seed';
const EVIDENCE = 'reports/blocks/public-player';
async function nativeHost(context: BrowserContext) {
  const upstream = process.env['ASA_BLOCKS_UPSTREAM_ORIGIN'];
  if (!upstream || new URL(upstream).origin !== upstream)
    throw Error('Exact pinned Scratch upstream is required');
  await context.route('**/internal/blocks/**', async (route) => {
    const url = new URL(route.request().url());
    const headers = { ...route.request().headers() };
    delete headers.cookie;
    delete headers.authorization;
    const response = await route.fetch({
      url: upstream + url.pathname.replace(/^\/internal\/blocks/, '') + url.search,
      headers,
    });
    const responseHeaders = { ...response.headers() };
    delete responseHeaders['set-cookie'];
    // Transparent native-host bytes/headers, no VM, storage or API stubs and no CSP bypass.
    await route.fulfill({ response, headers: responseHeaders });
  });
}
function receipts(page: Page) {
  const requests: { method: string; path: string }[] = [];
  page.on('request', (r) => requests.push({ method: r.method(), path: new URL(r.url()).pathname }));
  return requests;
}
test('published Scratch uses the real pinned player for guest and Seat, executes, stops, expands and preserves source', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  mkdirSync(EVIDENCE, { recursive: true });
  const metadata = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
  expect(metadata.revision).toBe(process.env['ASA_BUILD_REVISION']);
  const admin = e2eAdminPool();
  const f = publicScratchFixture();
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const seatContext = await browser.newContext({
    viewport: { width: 390, height: 900 },
    hasTouch: true,
  });
  try {
    await page.goto('/#/explore');
    const origin = new URL(page.url()).origin;
    const headers = { origin };
    const identifier = randomUUID().replaceAll('-', '');
    const registered = await page.request.post('/api/auth/register', {
      headers,
      data: {
        email: `scratch-${identifier}@isolated.test`,
        username: `scratch_${identifier.slice(0, 22)}`,
        displayName: 'Автор Scratch',
        password: `Scratch-${identifier}-Password`,
        birthDate: '1990-01-01',
        country: 'RU',
      },
    });
    expect(registered.status()).toBe(201);
    const account = await registered.json();
    const created = await page.request.post('/api/projects', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: {
        scope: 'personal',
        module: 'blocks',
        title: 'Счётчик Scratch — опубликованная программа',
      },
    });
    expect(created.status()).toBe(201);
    const project = (await created.json()).project;
    const tenant = (await admin.query('SELECT tenant_id FROM projects WHERE id=$1', [project.id]))
      .rows[0].tenant_id;
    await persistPublicScratchFixture(tenant, admin);
    const saved = await page.request.put(`/api/projects/${project.id}/draft`, {
      headers,
      data: { document: f.document, baseRevision: 1, mutationId: randomUUID() },
    });
    expect(saved.status()).toBe(200);
    const draft = (await saved.json()).draft;
    const image = new PNG({ width: 16, height: 16 });
    image.data.fill(255);
    expect(
      (
        await page.request.put(`/api/projects/${project.id}/snapshot`, {
          headers,
          data: {
            sourceRevision: draft.revision,
            imageDataUrl: `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`,
          },
        })
      ).status(),
    ).toBe(200);
    const publicProfile = await admin.query(
      "UPDATE profiles SET display_name=$2,visibility='public' WHERE account_id=$1",
      [account.account.id, 'Анна — мастерская Scratch'],
    );
    expect(publicProfile.rowCount).toBe(1);
    const published = await page.request.post(`/api/projects/${project.id}/publication`, {
      headers,
      data: {
        license: 'reserved',
        description:
          'Настоящий Scratch: зелёный флаг запускает счётчик, остановка его останавливает.',
      },
    });
    expect(published.status()).toBe(200);
    const binding = (await published.json()).publication;
    const route = `/#/public-projects/${binding.publicationId}`;
    const frozen = async () =>
      (
        await admin.query(
          'SELECT (SELECT to_jsonb(d) FROM project_drafts d WHERE project_id=$1) draft,(SELECT jsonb_agg(to_jsonb(v) ORDER BY version_no) FROM project_versions v WHERE project_id=$1) versions',
          [project.id],
        )
      ).rows;
    const before = await frozen();
    await nativeHost(guestContext);
    await nativeHost(seatContext);
    const guest = await guestContext.newPage();
    const requests = receipts(guest);
    const playerBootstrap = () =>
      guest.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          `/api/public-projects/${binding.publicationId}/scratch-player`,
      );
    const initialBootstrap = playerBootstrap();
    await guest.goto(route);
    await expect(guest.locator('.public-project-detail-author')).toHaveText(
      'Анна — мастерская Scratch',
    );
    const frame = guest.frameLocator('[data-testid="public-scratch-frame"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(frame.getByRole('button', { name: 'Start project', exact: true })).toBeVisible();
    await expect(frame.getByRole('tab', { name: 'Code', exact: true })).toHaveCount(0);
    const canvas = frame.locator('canvas').first();
    await expect(canvas).toBeVisible();
    const stage = PNG.sync.read(await canvas.screenshot());
    let red = 0;
    for (let i = 0; i < stage.data.length; i += 4)
      if (stage.data[i]! > 180 && stage.data[i + 1]! < 140 && stage.data[i + 2]! < 130) red++;
    expect(red, 'native canvas renders the actual red SVG asset').toBeGreaterThan(50);
    const counter = frame.locator('[class*="monitor_value"]').first();
    // Native player-only Scratch starts the VM (and monitor updates) on the
    // green flag, so assert the loaded source before starting the real program.
    const initialResponse = await initialBootstrap;
    expect(initialResponse.status()).toBe(200);
    expect((await initialResponse.json()).projectJson.targets[0].variables.counter[1]).toBe(0);
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-running',
      'false',
    );
    await frame.getByRole('button', { name: 'Start project', exact: true }).click();
    await expect.poll(async () => Number(await counter.innerText())).toBeGreaterThan(2);
    await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-running',
      'false',
    );
    const stopped = Number(await counter.innerText());
    // Five iterations of this real program would otherwise change the value.
    await guest.waitForTimeout(300);
    expect(Number(await counter.innerText())).toBe(stopped);
    const assertStageFits = async () => {
      const logo = frame.getByRole('img', { name: 'Scratch', exact: true });
      await expect(logo).toBeVisible();
      await expect
        .poll(async () => {
          const brand = await logo.boundingBox();
          const expand = await guest.getByTestId('public-scratch-fullscreen').boundingBox();
          return Boolean(
            brand &&
            expand &&
            (brand.x + brand.width <= expand.x ||
              expand.x + expand.width <= brand.x ||
              brand.y + brand.height <= expand.y ||
              expand.y + expand.height <= brand.y),
          );
        })
        .toBe(true);
      await expect
        .poll(async () =>
          frame.locator('[class*="stage-header_stage-menu-wrapper_"]').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.x >= 0 &&
              rect.y >= 0 &&
              rect.right <= innerWidth + 1 &&
              rect.bottom <= innerHeight + 1
            );
          }),
        )
        .toBe(true);
      await expect
        .poll(async () =>
          frame
            .locator('canvas')
            .first()
            .evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return (
                rect.x >= 0 &&
                rect.y >= 0 &&
                rect.right <= innerWidth + 1 &&
                rect.bottom <= innerHeight + 1 &&
                Math.abs(rect.width / rect.height - 4 / 3) < 0.01
              );
            }),
        )
        .toBe(true);
      await expect
        .poll(async () =>
          counter.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.x >= 0 &&
              rect.y >= 0 &&
              rect.right <= innerWidth + 1 &&
              rect.bottom <= innerHeight + 1
            );
          }),
        )
        .toBe(true);
      await expect(frame.getByRole('button', { name: 'Start project', exact: true })).toBeVisible();
      await expect(frame.getByRole('button', { name: 'Stop project', exact: true })).toBeVisible();
    };
    const layoutEvidence = [];
    for (const width of [1440, 1120, 1101, 1100, 1024, 1023, 390, 320]) {
      await guest.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await expect(frame.getByRole('button', { name: 'Start project', exact: true })).toBeVisible();
      await assertStageFits();
      const pageLayout = await guest.getByTestId('public-project-detail').evaluate((article) => {
        const rect = (selector: string) => {
          const bounds = article.querySelector(selector)!.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
          };
        };
        return {
          player: rect('[aria-label="Просмотр проекта"]'),
          sidebar: rect('aside[aria-label="Об авторе и проекте"]'),
          author: rect('.public-project-authorline'),
          notes: rect('[aria-label="О проекте"]'),
        };
      });
      layoutEvidence.push({ width, ...pageLayout });
      for (const bounds of Object.values(pageLayout)) {
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
      }
      expect(pageLayout.notes.left).toBeGreaterThanOrEqual(pageLayout.sidebar.left);
      expect(pageLayout.notes.right).toBeLessThanOrEqual(pageLayout.sidebar.right + 1);
      expect(pageLayout.notes.top).toBeGreaterThanOrEqual(pageLayout.sidebar.top);
      expect(pageLayout.notes.bottom).toBeLessThanOrEqual(pageLayout.sidebar.bottom + 1);
      // The accepted Publications workspace aligns the player with the whole
      // author/about sidebar. Description follows its author header on desktop;
      // it is not the top edge of the workspace (public-projects.spec.ts).
      expect(Math.abs(pageLayout.author.top - pageLayout.sidebar.top)).toBeLessThan(2);
      if (width > 1100) {
        expect(pageLayout.player.right).toBeLessThanOrEqual(pageLayout.sidebar.left);
        expect(Math.abs(pageLayout.player.top - pageLayout.sidebar.top)).toBeLessThan(2);
        expect(pageLayout.author.bottom).toBeLessThan(pageLayout.notes.top);
        expect(pageLayout.player.width).toBeGreaterThan(Math.min(width, 1180) * 0.5);
      } else {
        expect(pageLayout.player.bottom).toBeLessThan(pageLayout.sidebar.top);
        expect(pageLayout.player.width).toBeGreaterThan(width * 0.8);
        // The existing min-width:1024px about rule pins it to column one,
        // below the author, even inside the <=1100px two-column sidebar.
        if (width > 600 && width < 1024) {
          expect(pageLayout.author.right).toBeLessThanOrEqual(pageLayout.notes.left);
          expect(Math.abs(pageLayout.author.top - pageLayout.notes.top)).toBeLessThan(2);
        } else {
          expect(pageLayout.author.bottom).toBeLessThan(pageLayout.notes.top);
          expect(Math.abs(pageLayout.author.left - pageLayout.notes.left)).toBeLessThan(2);
        }
      }
      await expect(
        guest.getByRole('button', { name: 'Обновить публикацию', exact: true }),
      ).toHaveCount(0);
      await expect(
        guest.getByRole('link', { name: 'Открыть изображение', exact: true }),
      ).toHaveCount(0);
      await expect(
        guest.getByRole('button', { name: 'Создать свою копию', exact: true }),
      ).toHaveCount(0);
      await guest.screenshot({ path: `${EVIDENCE}/native-${width}.png`, fullPage: true });
    }
    await guest.setViewportSize({ width: 1440, height: 900 });
    await guest.getByTestId('public-scratch-fullscreen').click();
    await expect
      .poll(() => guest.evaluate(() => document.fullscreenElement?.getAttribute('data-testid')))
      .toBe('public-scratch-player');
    await expect
      .poll(async () => (await guest.getByTestId('public-scratch-player').boundingBox())!.width)
      .toBe(1440);
    await assertStageFits();
    await guest.screenshot({ path: `${EVIDENCE}/fullscreen.png` });
    await guest.getByTestId('public-scratch-fullscreen').click();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement === null)).toBe(true);
    const reopenedBootstrap = playerBootstrap();
    await guest.reload();
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    const reopenedResponse = await reopenedBootstrap;
    expect(reopenedResponse.status()).toBe(200);
    expect((await reopenedResponse.json()).projectJson.targets[0].variables.counter[1]).toBe(0);
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-running',
      'false',
    );
    expect(await frozen()).toEqual(before);
    const bootstrap = await guest.request.get(
      `/api/public-projects/${binding.publicationId}/scratch-player?revisionId=${binding.revisionId}`,
    );
    expect(bootstrap.status()).toBe(200);
    expect(bootstrap.headers()['cache-control']).toBe('no-store');
    const grant = await bootstrap.json();
    const publicPath = `/api/blocks/runtime/publications/${binding.publicationId}/revisions/${binding.revisionId}/assets/${f.ref.assetId}.svg`;
    const binary = await guest.request.get(publicPath, {
      headers: { origin, authorization: `Bearer ${grant.runtimeToken}` },
    });
    expect(binary.status()).toBe(200);
    expect(await binary.body()).toEqual(f.bytes);
    for (const path of [
      `/api/blocks/runtime/projects/${project.id}/draft`,
      `/api/blocks/runtime/projects/${project.id}/assets/${f.ref.assetId}.svg`,
    ]) {
      const denied = await guest.request.put(path, {
        headers: {
          origin,
          authorization: `Bearer ${grant.runtimeToken}`,
          'content-type': path.endsWith('/draft')
            ? 'application/vnd.asa.blocks-draft+json'
            : 'image/svg+xml',
        },
        data: path.endsWith('/draft')
          ? { document: f.document, baseRevision: draft.revision, mutationId: randomUUID() }
          : f.bytes,
      });
      expect(denied.status()).toBe(401);
      expect((await denied.json()).error.code).toBe('invalid_token');
    }
    expect(await frozen()).toEqual(before);
    // A real active StudentSeat, without an Account, has the same read-only player.
    const teacher = await seedTeacher(admin, 'public-scratch-seat');
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/#/explore');
    expect(
      (
        await teacherPage.request.post('/api/auth/login', {
          headers,
          data: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
        })
      ).status(),
    ).toBe(200);
    const classroomResponse = await teacherPage.request.post('/api/classrooms', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: { title: 'Scratch readers', ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
    });
    expect(classroomResponse.status()).toBe(201);
    const classroomId = (await classroomResponse.json()).classroom.id;
    const classroom = await teacherPage.request
      .get(`/api/classrooms/${classroomId}`)
      .then((r) => r.json());
    const seatResponse = await teacherPage.request.post(`/api/classrooms/${classroomId}/seats`, {
      headers,
      data: { displayLabel: 'Читатель Scratch', safeMode: true },
    });
    expect(seatResponse.status()).toBe(201);
    const seatId = (await seatResponse.json()).student.id;
    const code = await teacherPage.request.post(
      `/api/classrooms/${classroomId}/seats/${seatId}/code`,
      { headers, data: { requestId: randomUUID() } },
    );
    expect(code.status()).toBe(201);
    const studentCode = (await code.json()).studentCode;
    const seat = await seatContext.newPage();
    const seatRequests = receipts(seat);
    await seat.goto('/#/explore');
    expect(
      (
        await seat.request.post('/api/class-join/studentseat', {
          headers,
          data: { code: classroom.classroom.joinCode, studentCode },
        })
      ).status(),
    ).toBe(200);
    await seat.goto(route);
    const seatFrame = seat.frameLocator('[data-testid="public-scratch-frame"]');
    await expect(seatFrame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await seatFrame.getByRole('button', { name: 'Start project', exact: true }).click();
    await expect
      .poll(async () =>
        Number(await seatFrame.locator('[class*="monitor_value"]').first().innerText()),
      )
      .toBeGreaterThan(0);
    await seatFrame.getByRole('button', { name: 'Stop project', exact: true }).click();
    await seat.screenshot({ path: `${EVIDENCE}/seat-native-390.png`, fullPage: true });
    await teacherContext.close();
    await guest.goto('/#/explore');
    await expect(guest.getByTestId('public-scratch-frame')).toHaveCount(0);
    expect(guest.frames()).toHaveLength(1);
    expect(await frozen()).toEqual(before);
    expect(
      (await page.request.delete(`/api/projects/${project.id}/publication`, { headers })).status(),
    ).toBe(200);
    expect(
      (
        await guest.request.get(publicPath, {
          headers: { origin, authorization: `Bearer ${grant.runtimeToken}` },
        })
      ).status(),
    ).toBe(404);
    await seat.reload();
    await expect(seat.getByTestId('public-scratch-frame')).toHaveCount(0);
    const writes = (list: typeof requests) =>
      list.filter(
        (r) =>
          !['GET', 'HEAD', 'OPTIONS'].includes(r.method) &&
          /^\/api\/(?:projects|blocks\/runtime|public-projects)(?:\/|$)/.test(r.path),
      );
    expect(writes(requests)).toEqual([]);
    expect(writes(seatRequests)).toEqual([]);
    expect(requests.some((r) => r.path.endsWith('/scratch-gui-standalone.js'))).toBe(true);
    expect(requests.some((r) => r.path === publicPath)).toBe(true);
    writeFileSync(
      `${EVIDENCE}/receipt.json`,
      JSON.stringify(
        {
          revision: metadata.revision,
          ownerCreated: Boolean(account),
          nativeAssetSha256: f.ref.sha256,
          redPixels: red,
          requests,
          seatRequests,
          sourceUnchanged: true,
          fullscreen: true,
          writeRequests: 0,
          layout: layoutEvidence,
        },
        null,
        2,
      ),
    );
  } finally {
    await guestContext.close();
    await seatContext.close();
    await admin.end();
  }
});
