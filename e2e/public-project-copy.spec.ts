import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import type pg from 'pg';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type Browser } from '@playwright/test';
import { e2eAdminPool } from './seed';
import { collectBrowserFailures } from './browser-failures';
import { createEmptyThreeDDocument, createThreeDNode } from '../contexts/three-d/domain/document';
import { parseElectronicsDocument } from '../contexts/electronics/domain/document';
import { THREE_D_MODULE } from '../contexts/three-d/module';

const EVIDENCE = 'e2e/artifacts/public-projects-copy';
// A real encoded/decoded raster fixture for publication setup, not editor evidence.
function snapshotFixture(): string {
  const image = new PNG({ width: 32, height: 32 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 36;
    image.data[offset + 1] = 100;
    image.data[offset + 2] = 189;
    image.data[offset + 3] = 255;
  }
  const bytes = PNG.sync.write(image);
  const decoded = PNG.sync.read(bytes);
  expect(decoded.width).toBe(32);
  expect(decoded.height).toBe(32);
  expect(decoded.data).toEqual(image.data);
  expect(bytes.length).toBeGreaterThanOrEqual(64);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
async function register(page: Page, label: string) {
  await page.goto('/#/explore');
  const id = randomUUID().replaceAll('-', '');
  const response = await page.request.post('/api/auth/register', {
    headers: { origin: new URL(page.url()).origin },
    data: {
      email: `copy-${id}@isolated.test`,
      username: `copy_${id.slice(0, 24)}`,
      displayName: label,
      password: `Copy-${id}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.status()).toBe(201);
  expect((await response.json()).authenticated).toBe(true);
  await page.reload();
}
function scene(width: number) {
  const node = createThreeDNode('box', 'published-box');
  const document = {
    ...createEmptyThreeDDocument(),
    nodes: [{ ...node, dimensions: { ...node.dimensions, width } }],
  };
  expect(THREE_D_MODULE.provider?.validate(document).ok).toBe(true);
  return document;
}
async function opened(page: Page, id: string) {
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function save(page: Page, id: string, document: unknown, baseRevision: number) {
  const response = await page.request.put(`/api/projects/${id}/draft`, {
    headers: { origin: new URL(page.url()).origin },
    data: { document, baseRevision, mutationId: randomUUID() },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).draft;
}

for (const { width, seat } of [
  { width: 1440, seat: false },
  { width: 1024, seat: false },
  { width: 390, seat: false },
  { width: 320, seat: false },
  { width: 390, seat: true },
]) {
  test(`${seat ? 'StudentSeat' : 'Account B'} copies published 3D V1, edits and cookies-only reopens at ${width}px`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const admin = e2eAdminPool();
    const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const b = await browser.newContext({ viewport: { width, height: 1000 } });
    const author = await a.newPage();
    const reader = await b.newPage();
    const failures = collectBrowserFailures(reader, {
      allowAnonymousSessionProbe: true,
      allowAdminAccessProbe: true,
    });
    let sourceId: string | undefined;
    try {
      mkdirSync(EVIDENCE, { recursive: true });
      const metadata = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
      expect(metadata.revision).toBe(process.env.ASA_BUILD_REVISION);
      writeFileSync(
        `${EVIDENCE}/${seat ? 'seat-' : ''}${width}-build.json`,
        JSON.stringify(metadata, null, 2),
        'utf8',
      );
      await register(author, 'Независимый автор A');
      if (seat) await registerAllowedSeat(browser, reader);
      else await register(reader, 'Независимый автор B');
      const headers = { origin: new URL(author.url()).origin };
      const created = await author.request.post('/api/projects', {
        headers: { ...headers, 'idempotency-key': randomUUID() },
        data: { scope: 'personal', module: 'three-d', title: `Copy source ${randomUUID()}` },
      });
      expect(created.status()).toBe(201);
      const id = (await created.json()).project.id as string;
      sourceId = id;
      const v1 = await save(author, id, scene(37), 1);
      expect(
        (
          await author.request.put(`/api/projects/${id}/snapshot`, {
            headers,
            data: { sourceRevision: v1.revision, imageDataUrl: snapshotFixture() },
          })
        ).status(),
      ).toBe(200);
      const published = await author.request.post(`/api/projects/${id}/publication`, {
        headers,
        data: { license: 'public-domain' },
      });
      expect(published.status()).toBe(200);
      const publication = (await published.json()).publication;
      await admin.query(
        'UPDATE publication_acquisition_settings SET enabled=true WHERE singleton_key',
      );
      const consent = await author.request.post(`/api/projects/${id}/publication/acquisition`, {
        headers,
        data: { allowed: true, expectedVersion: 0, expectedRevisionId: publication.revisionId },
      });
      expect(consent.status()).toBe(200);
      await save(author, id, scene(83), v1.revision);
      const before = await opened(author, id);
      const frozen = async () =>
        (
          await admin.query(
            'SELECT to_jsonb(v) version FROM project_versions v WHERE project_id=$1 ORDER BY version_no',
            [id],
          )
        ).rows;
      const immutableBefore = await frozen();
      await reader.goto(`/#/public-projects/${publication.publicationId}`);
      const button = reader.getByRole('button', { name: 'Добавить в мои проекты', exact: true });
      await expect(button).toBeVisible();
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await reader.screenshot({
        path: `${EVIDENCE}/${seat ? 'seat-' : ''}${width}-public.png`,
        fullPage: true,
      });
      const detailResponse = await reader.request.get(
        `/api/public-projects/${publication.publicationId}`,
      );
      expect(detailResponse.status()).toBe(200);
      const publicDetail = (await detailResponse.json()).publication;
      const requests: string[] = [];
      reader.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith(`/${publication.publicationId}/copy`)
        )
          requests.push(request.postData() ?? '');
      });
      const copiedResponse = reader.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith(`/${publication.publicationId}/copy`),
      );
      await button.click();
      const copied = await copiedResponse;
      expect([200, 201]).toContain(copied.status());
      const target = await copied.json();
      expect(target).toMatchObject({ moduleKey: 'three-d', created: true });
      expect(target.projectId).not.toBe(id);
      const openAction = reader.getByRole('link', { name: 'Открыть мою копию', exact: true });
      await expect(openAction).toBeVisible();
      await openAction.click();
      await expect(reader).toHaveURL(new RegExp(`#/3d/${target.projectId}(?:[?]|$)`));
      await expectPrimitiveRender(reader, ['published-box']);
      expect((await opened(reader, target.projectId)).draft.document).toEqual(v1.document);
      await reader.screenshot({
        path: `${EVIDENCE}/${seat ? 'seat-' : ''}${width}-copied-v1.png`,
        fullPage: true,
      });
      const library = reader.getByRole('button', { name: 'Добавить фигуру', exact: true });
      if (await library.isVisible()) await library.click();
      const savedResponse = reader.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          new URL(response.url()).pathname === `/api/projects/${target.projectId}/draft`,
      );
      await reader.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
      const saved = await savedResponse;
      expect(saved.status()).toBe(200);
      const intended = saved.request().postDataJSON().document;
      expect(intended.nodes).toHaveLength(2);
      expect(intended.nodes.find((node: { id: string }) => node.id === 'published-box')).toEqual(
        v1.document.nodes[0],
      );
      expect((await saved.json()).draft.document).toEqual(intended);
      await expect(reader.locator('.asa3d-save-state')).toHaveClass(/save-saved/);
      expect((await opened(reader, target.projectId)).draft.document).toEqual(intended);
      const route = reader.url();
      // New context retains cookies only: no editor memory, localStorage or IndexedDB.
      const reopenedContext = await browser.newContext({ viewport: { width, height: 1000 } });
      try {
        await reopenedContext.addCookies(await b.cookies());
        const reopened = await reopenedContext.newPage();
        const reopenFailures = collectBrowserFailures(reopened, { allowAdminAccessProbe: true });
        await reopened.goto(route);
        await expectPrimitiveRender(
          reopened,
          intended.nodes.map((node: { id: string }) => node.id),
        );
        expect((await opened(reopened, target.projectId)).draft.document).toEqual(intended);
        await reopened.screenshot({
          path: `${EVIDENCE}/${seat ? 'seat-' : ''}${width}-reopened.png`,
          fullPage: true,
        });
        reopenFailures.assertEmpty();
      } finally {
        await reopenedContext.close();
      }
      expect(requests).toHaveLength(1);
      expect((await opened(author, id)).draft).toEqual(before.draft);
      expect(await frozen()).toEqual(immutableBefore);
      const publicAfter = await reader.request.get(
        `/api/public-projects/${publication.publicationId}`,
      );
      expect((await publicAfter.json()).publication.revisionId).toBe(publication.revisionId);
      await assertPrivateCopy(admin, browser, author, id, target.projectId, publicDetail);
      failures.assertEmpty();
    } finally {
      if (sourceId)
        await admin.query(
          `UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=$1 AND state IN ('public','unlisted')`,
          [sourceId],
        );
      await a.close();
      await b.close();
      await admin.end();
    }
  });
}

// Packaged inline components only; no tenant-bound uploads or generated artwork.
function electronicsCircuit(resistance: number) {
  const raw = {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Источник 3 В',
        position: { x: 230, y: 110 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2 },
      },
      {
        id: 'resistor',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'R1',
        position: { x: 520, y: 150 },
        rotation: 90,
        value: resistance,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ω', powerRatingWatt: 0.25 },
      },
      {
        id: 'led',
        kind: 'led',
        componentTypeId: 'led-5mm',
        variantId: 'led-5mm',
        name: 'LED1',
        position: { x: 800, y: 140 },
        rotation: 0,
        value: 2,
        pinIds: ['anode', 'cathode'],
        stateProperties: { ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
      },
    ],
    connections: [
      {
        id: 's-r',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'r-l',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'led', terminal: 'anode' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'l-s',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [
          { x: 860, y: 330 },
          { x: 280, y: 330 },
        ],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  const parsed = parseElectronicsDocument(raw);
  if (!parsed.ok) throw new Error(`Invalid packaged circuit: ${parsed.message}`);
  expect(parsed.document.components).toHaveLength(3);
  expect(parsed.document.connections).toHaveLength(3);
  expect(
    parsed.document.components.find((part) => part.id === 'resistor')?.stateProperties,
  ).toEqual({
    tolerancePercent: 5,
    resistanceUnit: 'Ω',
    powerRatingWatt: 0.25,
  });
  return parsed.document;
}

for (const seat of [false, true]) {
  test(`${seat ? 'StudentSeat' : 'Account B'} copies packaged Electronics V1, changes resistance in editor and cookies-only reopens exact saved circuit`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const admin = e2eAdminPool();
    const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const b = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const author = await a.newPage();
    const reader = await b.newPage();
    const failures = collectBrowserFailures(reader, {
      allowAnonymousSessionProbe: true,
      allowAdminAccessProbe: true,
    });
    let sourceId: string | undefined;
    try {
      mkdirSync(EVIDENCE, { recursive: true });
      const metadata = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
      expect(metadata.revision).toBe(process.env.ASA_BUILD_REVISION);
      writeFileSync(
        `${EVIDENCE}/${seat ? 'seat-' : ''}electronics-build.json`,
        JSON.stringify(metadata, null, 2),
        'utf8',
      );
      await register(author, 'Автор схемы A');
      if (seat) await registerAllowedSeat(browser, reader);
      else await register(reader, 'Автор схемы B');
      const headers = { origin: new URL(author.url()).origin };
      const created = await author.request.post('/api/projects', {
        headers: { ...headers, 'idempotency-key': randomUUID() },
        data: {
          scope: 'personal',
          module: 'electronics',
          title: `Packaged circuit ${randomUUID()}`,
        },
      });
      expect(created.status()).toBe(201);
      const id = (await created.json()).project.id as string;
      sourceId = id;
      const v1 = await save(author, id, electronicsCircuit(220), 1);
      expect(v1.document).toEqual(electronicsCircuit(220));
      expect(
        (
          await author.request.put(`/api/projects/${id}/snapshot`, {
            headers,
            data: { sourceRevision: v1.revision, imageDataUrl: snapshotFixture() },
          })
        ).status(),
      ).toBe(200);
      const published = await author.request.post(`/api/projects/${id}/publication`, {
        headers,
        data: { license: 'public-domain' },
      });
      expect(published.status()).toBe(200);
      const publication = (await published.json()).publication;
      await admin.query(
        'UPDATE publication_acquisition_settings SET enabled=true WHERE singleton_key',
      );
      const consent = await author.request.post(`/api/projects/${id}/publication/acquisition`, {
        headers,
        data: { allowed: true, expectedVersion: 0, expectedRevisionId: publication.revisionId },
      });
      expect(consent.status()).toBe(200);
      await save(author, id, electronicsCircuit(470), v1.revision);
      const before = await opened(author, id);
      expect(before.draft.document).toEqual(electronicsCircuit(470));
      const immutable = async () =>
        (
          await admin.query(
            `SELECT to_jsonb(r) revision,to_jsonb(v) version
      FROM project_publication_revisions r JOIN project_versions v ON v.id=r.project_version_id
      WHERE r.project_id=$1 ORDER BY r.revision_no`,
            [id],
          )
        ).rows;
      const immutableBefore = await immutable();
      await reader.goto(`/#/public-projects/${publication.publicationId}`);
      const detailResponse = await reader.request.get(
        `/api/public-projects/${publication.publicationId}`,
      );
      expect(detailResponse.status()).toBe(200);
      const publicDetail = (await detailResponse.json()).publication;
      const requests: string[] = [];
      reader.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith(`/${publication.publicationId}/copy`)
        )
          requests.push(request.postData() ?? '');
      });
      const copiedResponse = reader.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith(`/${publication.publicationId}/copy`),
      );
      await reader.getByRole('button', { name: 'Добавить в мои проекты', exact: true }).click();
      const copied = await copiedResponse;
      expect([200, 201]).toContain(copied.status());
      const target = await copied.json();
      expect(target).toMatchObject({ moduleKey: 'electronics', created: true });
      expect(target.projectId).not.toBe(id);
      const openAction = reader.getByRole('link', { name: 'Открыть мою копию', exact: true });
      await expect(openAction).toBeVisible();
      await openAction.click();
      await expect(reader).toHaveURL(
        new RegExp(`/projects/${target.projectId}/electronics/edit(?:[?]|$)`),
      );
      await expect(reader.locator('.workbench-stage')).toBeVisible();
      await expect(reader.getByTestId('schematic-component')).toHaveCount(3);
      expect((await opened(reader, target.projectId)).draft.document).toEqual(v1.document);
      const resistor = reader.locator(
        '[data-testid="schematic-component"][data-component-type="resistor-axial"] .workbench-part',
      );
      await resistor.press('Enter');
      const resistance = reader
        .locator('.workbench-inspector label')
        .filter({ hasText: 'Сопротивление' })
        .locator('input[type="number"]');
      await expect(resistance).toHaveValue('220');
      await reader.screenshot({
        path: `${EVIDENCE}/${seat ? 'seat-' : ''}electronics-copied-v1.png`,
        fullPage: true,
      });
      const intended = {
        ...v1.document,
        components: v1.document.components.map((part: { id: string }) =>
          part.id === 'resistor' ? { ...part, value: 330 } : part,
        ),
      };
      const savedResponse = reader.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          new URL(response.url()).pathname === `/api/projects/${target.projectId}/draft`,
      );
      await resistance.fill('330');
      await reader.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
      const saved = await savedResponse;
      expect(saved.status()).toBe(200);
      expect(saved.request().postDataJSON().document).toEqual(intended);
      expect((await saved.json()).draft.document).toEqual(intended);
      await expect(reader.locator('.workbench-main')).toHaveAttribute(
        'data-project-save-status',
        'saved',
      );
      expect((await opened(reader, target.projectId)).draft.document).toEqual(intended);
      const reopenedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        await reopenedContext.addCookies(await b.cookies());
        const reopened = await reopenedContext.newPage();
        const reopenFailures = collectBrowserFailures(reopened, { allowAdminAccessProbe: true });
        await reopened.goto(reader.url());
        await expect(reopened.locator('.workbench-stage')).toBeVisible();
        await expect(reopened.getByTestId('schematic-component')).toHaveCount(3);
        expect((await opened(reopened, target.projectId)).draft.document).toEqual(intended);
        await reopened
          .locator(
            '[data-testid="schematic-component"][data-component-type="resistor-axial"] .workbench-part',
          )
          .press('Enter');
        await expect(
          reopened
            .locator('.workbench-inspector label')
            .filter({ hasText: 'Сопротивление' })
            .locator('input[type="number"]'),
        ).toHaveValue('330');
        await reopened.screenshot({
          path: `${EVIDENCE}/${seat ? 'seat-' : ''}electronics-reopened-330.png`,
          fullPage: true,
        });
        reopenFailures.assertEmpty();
      } finally {
        await reopenedContext.close();
      }
      expect(requests).toHaveLength(1);
      expect((await opened(author, id)).draft).toEqual(before.draft);
      expect(await immutable()).toEqual(immutableBefore);
      await assertPrivateCopy(admin, browser, author, id, target.projectId, publicDetail);
      const lineage = await admin.query(
        `SELECT copied_from_publication_id,copied_from_revision_id,copied_from_version_id,copied_from_license
         FROM projects WHERE id=$1`,
        [target.projectId],
      );
      expect(lineage.rows[0]).toMatchObject({
        copied_from_publication_id: publication.publicationId,
        copied_from_revision_id: publication.revisionId,
        copied_from_version_id: immutableBefore[0].version.id,
        copied_from_license: 'public-domain',
      });
      failures.assertEmpty();
    } finally {
      if (sourceId)
        await admin.query(
          `UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=$1 AND state IN ('public','unlisted')`,
          [sourceId],
        );
      await a.close();
      await b.close();
      await admin.end();
    }
  });
}

async function assertPrivateCopy(
  admin: pg.Pool,
  browser: Browser,
  author: Page,
  sourceId: string,
  targetId: string,
  publication: { title: string; authorLabel: string; publicationId: string; revisionId: string },
) {
  const ownership = await admin.query(
    `SELECT id,project_scope AS scope,classroom_id,tenant_id,owner_principal_id,license,
            copied_from_project_id,copied_from_title,copied_from_author
       FROM projects WHERE id=ANY($1::uuid[])`,
    [[sourceId, targetId]],
  );
  const source = ownership.rows.find((row) => row.id === sourceId);
  const target = ownership.rows.find((row) => row.id === targetId);
  expect(source).toBeDefined();
  expect(target).toMatchObject({
    scope: 'personal',
    classroom_id: null,
    license: 'public-domain',
    copied_from_project_id: sourceId,
    copied_from_title: publication.title,
    copied_from_author: publication.authorLabel,
  });
  expect(target.tenant_id).not.toBe(source.tenant_id);
  expect(target.owner_principal_id).not.toBe(source.owner_principal_id);
  const exactOrigin = await admin.query(
    `SELECT p.copied_from_publication_id,p.copied_from_revision_id,p.copied_from_version_id,
            p.copied_from_license,r.project_version_id
       FROM projects p JOIN project_publication_revisions r ON r.id=$2 AND r.project_id=$3
      WHERE p.id=$1`,
    [targetId, publication.revisionId, sourceId],
  );
  expect(exactOrigin.rows).toHaveLength(1);
  expect(exactOrigin.rows[0]).toMatchObject({
    copied_from_publication_id: publication.publicationId,
    copied_from_revision_id: publication.revisionId,
    copied_from_version_id: exactOrigin.rows[0].project_version_id,
    copied_from_license: 'public-domain',
  });
  const publications = await admin.query(
    `SELECT (SELECT count(*)::int FROM project_publications WHERE project_id=$1) AS legacy,
            (SELECT count(*)::int FROM project_publication_state
              WHERE project_id=$1 AND state IN ('public','unlisted')) AS live`,
    [targetId],
  );
  expect(publications.rows[0]).toEqual({ legacy: 0, live: 0 });
  expect((await author.request.get(`/api/projects/${targetId}`)).status()).toBe(404);
  const anonymous = await browser.newContext();
  try {
    const denied = await anonymous.request.get(
      `${new URL(author.url()).origin}/api/projects/${targetId}`,
    );
    expect(denied.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
}

/** Ungrouped primitives are rendered directly by SceneRuntime.createNodeObject.
 * With no Boolean groups the canonical worker state is idle, not ready. Prove
 * the visible WebGL canvas and real raycast/manipulator selection as well. */
async function expectPrimitiveRender(page: Page, expectedNodeIds: readonly string[]) {
  const viewport = page.getByTestId('asa3d-viewport');
  await expect(viewport).toHaveAttribute('data-runtime-ready', 'true');
  await expect(viewport).toHaveAttribute('data-geometry-worker-state', 'idle');
  await expect(viewport).toHaveAttribute('data-geometry-group-states', '[]');
  await expect(viewport.locator('.asa3d-webgl-error')).toHaveCount(0);
  expect(await viewport.getAttribute('data-geometry-worker-error')).toBeNull();
  const canvas = viewport.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const dimensions = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
  }));
  for (const dimension of Object.values(dimensions)) expect(dimension).toBeGreaterThan(0);
  // Same bounded rendered-workplane selection points as the existing 3D suite.
  // These clicks only select; no synthetic document or viewport mutation.
  for (const [x, y] of [
    [0.5, 0.5],
    [0.56, 0.47],
    [0.45, 0.52],
  ]) {
    await canvas.click({ position: { x: dimensions.cssWidth * x, y: dimensions.cssHeight * y } });
    if (expectedNodeIds.includes((await viewport.getAttribute('data-selected-node-id')) ?? ''))
      break;
  }
  expect(expectedNodeIds).toContain(await viewport.getAttribute('data-selected-node-id'));
  const overlay = page.getByTestId('asa3d-manipulator-overlay');
  await expect(overlay).toHaveAttribute('data-handle-positions', /resize-/);
  const handles = JSON.parse((await overlay.getAttribute('data-handle-positions')) ?? '{}') as {
    centre: { x: number; y: number };
    handles: Array<{ id: string; x: number; y: number }>;
  };
  expect(Number.isFinite(handles.centre.x)).toBe(true);
  expect(Number.isFinite(handles.centre.y)).toBe(true);
  expect(handles.handles.length).toBeGreaterThan(0);
  for (const handle of handles.handles) {
    expect(Number.isFinite(handle.x)).toBe(true);
    expect(Number.isFinite(handle.y)).toBe(true);
  }
}

async function registerAllowedSeat(browser: Browser, learner: Page) {
  const context = await browser.newContext();
  const teacher = await context.newPage();
  try {
    await register(teacher, 'Учитель получателя');
    const headers = { origin: new URL(teacher.url()).origin };
    expect(
      (
        await teacher.request.post('/api/capabilities/educator/self-attest', { headers, data: {} })
      ).status(),
    ).toBe(201);
    const classroom = await teacher.request.post('/api/classrooms', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: { title: 'Получение копий', ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
    });
    expect(classroom.status()).toBe(201);
    const id = (await classroom.json()).classroom.id;
    const detail = await teacher.request.get(`/api/classrooms/${id}`);
    const classCode = (await detail.json()).classroom.joinCode;
    const created = await teacher.request.post(`/api/classrooms/${id}/seats`, {
      headers,
      data: { displayLabel: 'Ученик получатель', safeMode: true },
    });
    expect(created.status()).toBe(201);
    const student = (await created.json()).student;
    const policy = await teacher.request.put(`/api/project-distribution/classrooms/${id}/policy`, {
      headers,
      data: { publish: false, download: true, expectedVersion: 0 },
    });
    expect(policy.status()).toBe(200);
    await learner.goto('/#/explore');
    const joined = await learner.request.post('/api/class-join/studentseat', {
      headers,
      data: { code: classCode, studentCode: student.studentCode },
    });
    expect(joined.status()).toBe(200);
    await learner.reload();
  } finally {
    await context.close();
  }
}
