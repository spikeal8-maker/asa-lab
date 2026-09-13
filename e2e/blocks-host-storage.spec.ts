import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createProtocolFixture } from '../tools/blocks/browser/fixture.mjs';
import { runtimeFrame, waitForRuntimeState } from '../tools/blocks/browser/assertions.mjs';
import {
  initMessage,
  binding,
  parentOrigin,
  runtimeUrl,
  sendFromParent,
} from '../tools/blocks/browser/protocol.mjs';

type FixtureStorage = {
  scratchStorage: {
    AssetType: { Project: unknown };
    DataFormat: { JSON: string };
    load(type: unknown, id: string, format: string): Promise<unknown>;
  };
  saveProject(): Promise<unknown>;
  getLibraryAssetUrl(id: string, format: string): string;
};
declare global {
  interface Window {
    GUI: unknown;
    AsaBlocksStorage: { createFixtureStorage(gui: unknown): FixtureStorage };
  }
}

const evidenceDir = 'reports/blocks/first-visible';
let fixture: Awaited<ReturnType<typeof createProtocolFixture>>;
let page: Page;
const requests: { url: string; method: string; type: string }[] = [];
const external: string[] = [];
const failed: string[] = [];

test.beforeAll(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fixture = await createProtocolFixture();
  fixture.context.on('request', (request) => {
    const url = request.url();
    requests.push({ url, method: request.method(), type: request.resourceType() });
    if (/^https?:/.test(url) && ![runtimeUrl, parentOrigin].includes(new URL(url).origin)) {
      external.push(url);
    }
  });
  fixture.context.on('requestfailed', (request) => failed.push(request.url()));
});

test.beforeEach(async () => {
  page = await fixture.context.newPage();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(parentOrigin, { waitUntil: 'domcontentloaded' });
});

test.afterEach(async ({ browserName }, info) => {
  if (info.status !== info.expectedStatus) {
    await page.screenshot({
      path: `${evidenceDir}/failure-${browserName}-${info.testId.replace(/[^a-z0-9]/gi, '')}.png`,
    });
  }
  await page.close();
});

test.afterAll(async () => {
  fs.writeFileSync(
    `${evidenceDir}/network.json`,
    JSON.stringify(
      {
        sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        runtimeUrl,
        parentOrigin,
        external,
        failed,
        requests,
        browserErrors: fixture.pageErrors,
      },
      null,
      2,
    ),
  );
  await fixture.close();
});

async function mount(hasProjectJson: boolean, player = false) {
  const frame = await runtimeFrame(page);
  await waitForRuntimeState(frame, 'awaiting-init');
  await expect(frame.locator('#scratch-editor-root')).toBeEmpty();
  await sendFromParent(page, {
    ...initMessage,
    hasProjectJson,
    mode: player ? 'player' : 'editor',
    versionId: player ? '22222222-2222-4222-8222-222222222222' : null,
  });
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 45000 },
  );
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-fixture-kind',
    hasProjectJson ? 'existing' : 'new',
  );
  await expect(frame.locator('canvas[class*="stage_stage"]')).toBeVisible();
  await expect(
    frame.locator('[class*="monitor_label"]').filter({ hasText: 'Ticks' }),
  ).toBeVisible();
  return frame;
}

test('real editor, new fixture, block execution, stop, changes and defensive storage', async () => {
  const frame = await mount(false);
  const shell = frame.locator('[data-asa-host-shell]');
  await expect(frame.locator('.blocklySvg').first()).toBeVisible();
  await expect(frame.locator('.blocklyBlockCanvas .blocklyDraggable').first()).toBeVisible();
  await expect(frame.locator('.blocklyToolboxDiv')).toBeVisible();
  await expect(shell).toHaveAttribute('data-project-changes', '0');
  await page.screenshot({ path: `${evidenceDir}/01-editor-in-asa-host.png` });
  await frame
    .locator('#scratch-editor-root')
    .screenshot({ path: `${evidenceDir}/02-workspace-stage.png` });

  const counter = frame.locator('[class*="monitor_value"]').first();
  await expect(counter).toHaveText('0');
  await frame.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(shell).toHaveAttribute('data-project-running', 'true');
  await expect.poll(async () => Number(await counter.textContent())).toBeGreaterThan(3);
  await page.screenshot({ path: `${evidenceDir}/03-running-programme.png` });
  await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
  await expect(shell).toHaveAttribute('data-project-running', 'false');
  const stoppedValue = await counter.textContent();
  await page.waitForTimeout(400);
  await expect(counter).toHaveText(stoppedValue ?? '');

  const changesBefore = Number(await shell.getAttribute('data-project-changes'));
  await frame.getByPlaceholder('x', { exact: true }).fill('42');
  await frame.getByPlaceholder('x', { exact: true }).press('Enter');
  await expect
    .poll(async () => Number(await shell.getAttribute('data-project-changes')))
    .toBeGreaterThan(changesBefore);

  const storageResult = await frame.locator('body').evaluate(async () => {
    const storage = window.AsaBlocksStorage.createFixtureStorage(window.GUI);
    let save = 'unexpected_success';
    let library = 'unexpected_success';
    try {
      await storage.saveProject();
    } catch (error) {
      save = (error as Error).message;
    }
    try {
      storage.getLibraryAssetUrl('unavailable-fixture', 'svg');
    } catch (error) {
      library = (error as Error).message;
    }
    const unknownProject = await storage.scratchStorage.load(
      storage.scratchStorage.AssetType.Project,
      '11111111-1111-4111-8111-111111111111',
      storage.scratchStorage.DataFormat.JSON,
    );
    return { save, library, unknownProject };
  });
  expect(storageResult).toEqual({
    save: 'fixture_storage_read_only',
    library: 'fixture_asset_unavailable',
    unknownProject: null,
  });
  expect(external).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
  await sendFromParent(page, { ...binding, messageType: 'ASA_BLOCKS_STOP' });
  await expect(shell).toHaveAttribute('data-editor-state', 'disposed');
  await expect(frame.locator('#scratch-editor-root')).toBeEmpty();
});

test('existing controlled fixture loads through an internal fixture ID', async () => {
  const frame = await mount(true);
  await expect(frame.locator('.blocklySvg').first()).toBeVisible();
  await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('0');
  expect(external).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
});

test('player fixture is read-only and still runs and stops the actual VM', async () => {
  const frame = await mount(true, true);
  await expect(frame.locator('.blocklySvg')).toHaveCount(0);
  await expect(frame.getByPlaceholder('x', { exact: true })).toHaveCount(0);
  const counter = frame.locator('[class*="monitor_value"]').first();
  await frame.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect.poll(async () => Number(await counter.textContent())).toBeGreaterThan(2);
  await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
  const stoppedValue = await counter.textContent();
  await page.waitForTimeout(400);
  await expect(counter).toHaveText(stoppedValue ?? '');
  await page.screenshot({ path: `${evidenceDir}/04-read-only-player.png` });
  expect(external).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
});
