import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let runtimeFrame: typeof import('../tools/blocks/browser/assertions.mjs').runtimeFrame;
let waitForRuntimeState: typeof import('../tools/blocks/browser/assertions.mjs').waitForRuntimeState;
let initMessage: typeof import('../tools/blocks/browser/protocol.mjs').initMessage;
let binding: typeof import('../tools/blocks/browser/protocol.mjs').binding;
let parentOrigin: string;
let runtimeUrl: string;
let sendFromParent: typeof import('../tools/blocks/browser/protocol.mjs').sendFromParent;

type ReadOnlyStorage = {
  scratchStorage: {
    AssetType: { Project: unknown };
    DataFormat: { JSON: string };
    load(type: unknown, id: string, format: string): Promise<unknown>;
  };
  saveProject(): Promise<unknown>;
  getLibraryAssetUrl(id: string, format: string): string;
  dispose(): void;
};
declare global {
  interface Window {
    GUI: unknown;
    AsaBlocksStorage: {
      createReadOnlyStorage(gui: unknown, options: Record<string, unknown>): ReadOnlyStorage;
    };
  }
}

const evidenceDir = 'reports/blocks/first-visible';
const projectId = '11111111-1111-4111-8111-111111111111';
let fixture: Awaited<ReturnType<typeof createProtocolFixture>>;
let page: Page;
const requests: { url: string; method: string; type: string }[] = [];
const external: string[] = [];
const failed: string[] = [];
const responses: { url: string; status: number }[] = [];

test.beforeAll(async () => {
  ({ createProtocolFixture } = await import('../tools/blocks/browser/fixture.mjs'));
  ({ runtimeFrame, waitForRuntimeState } = await import('../tools/blocks/browser/assertions.mjs'));
  ({ initMessage, binding, parentOrigin, runtimeUrl, sendFromParent } =
    await import('../tools/blocks/browser/protocol.mjs'));
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
  fixture.context.on('response', (response) => {
    responses.push({ url: response.url(), status: response.status() });
  });
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
  try {
    expect(external).toEqual([]);
    expect(failed).toEqual([]);
    expect(responses.filter((response) => response.status >= 400)).toEqual([]);
  } finally {
    await page.close();
  }
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
        responses,
        browserErrors: fixture.pageErrors,
      },
      null,
      2,
    ),
  );
  await fixture.close();
});

async function mount(player = false) {
  const frame = await runtimeFrame(page);
  await waitForRuntimeState(frame, 'awaiting-init');
  await expect(frame.locator('#scratch-editor-root')).toBeEmpty();
  await sendFromParent(page, {
    ...initMessage,
    mode: player ? 'player' : 'editor',
    versionId: player ? '22222222-2222-4222-8222-222222222222' : null,
  });
  const shell = frame.locator('[data-asa-host-shell]');
  await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
  await expect(shell).toHaveAttribute('data-project-source', 'new-default');
  await expect(shell).toHaveAttribute('data-draft-revision', '0');
  await expect(frame.locator('[class*="stage_stage_"] canvas').first()).toBeVisible();
  return frame;
}

test('new editor binds the stock Scratch default to the managed ASA project UUID', async () => {
  const frame = await mount(false);
  const shell = frame.locator('[data-asa-host-shell]');
  await expect(frame.locator('.blocklySvg').first()).toBeVisible();
  await expect(frame.locator('.blocklyToolbox')).toBeVisible();
  await expect(frame.getByPlaceholder('Name', { exact: true })).not.toHaveValue('Fixture Cat');
  await expect(shell).toHaveAttribute('data-project-changes', '0');
  await expect(frame.getByText('Fixture Cat', { exact: true })).toHaveCount(0);
  await expect(frame.locator('[class*="monitor_label"]').filter({ hasText: 'Ticks' })).toHaveCount(
    0,
  );
  await page.screenshot({ path: `${evidenceDir}/01-default-editor-in-asa-host.png` });

  await frame.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(shell).not.toHaveAttribute('data-runtime-state', 'error');
  await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
  await expect(shell).toHaveAttribute('data-project-running', 'false');

  const changesBefore = Number(await shell.getAttribute('data-project-changes'));
  await frame.getByPlaceholder('x', { exact: true }).fill('42');
  await frame.getByPlaceholder('x', { exact: true }).press('Enter');
  await expect
    .poll(async () => Number(await shell.getAttribute('data-project-changes')))
    .toBeGreaterThan(changesBefore);

  const storageResult = await frame.locator('body').evaluate(
    async ({ apiOrigin, targetProjectId }) => {
      const storage = window.AsaBlocksStorage.createReadOnlyStorage(window.GUI, {
        projectId: targetProjectId,
        projectJson: null,
        assets: [],
        apiOrigin,
        getRuntimeToken: () => 'fixture.runtime.token',
      });
      let library = 'unexpected_success';
      try {
        storage.getLibraryAssetUrl('unavailable-fixture', 'svg');
      } catch (error) {
        library = (error as Error).message;
      }
      const managedProject = await storage.scratchStorage.load(
        storage.scratchStorage.AssetType.Project,
        targetProjectId,
        storage.scratchStorage.DataFormat.JSON,
      );
      const localZeroProject = await storage.scratchStorage.load(
        storage.scratchStorage.AssetType.Project,
        '0',
        storage.scratchStorage.DataFormat.JSON,
      );
      storage.dispose();
      return {
        library,
        hasManagedProject: Boolean(managedProject),
        managedProjectHasData: Boolean(managedProject?.data),
        hasLocalZeroProject: Boolean(localZeroProject),
      };
    },
    { apiOrigin: parentOrigin, targetProjectId: projectId },
  );
  expect(storageResult).toEqual({
    library: 'runtime_asset_unavailable',
    hasManagedProject: true,
    managedProjectHasData: true,
    hasLocalZeroProject: false,
  });
  expect(fixture.pageErrors).toEqual([]);

  await sendFromParent(page, { ...binding, messageType: 'ASA_BLOCKS_STOP' });
  await expect(shell).toHaveAttribute('data-editor-state', 'disposed');
  await expect(frame.locator('#scratch-editor-root')).toBeEmpty();
});

test('new player remains read-only and controls the actual default VM', async () => {
  const frame = await mount(true);
  const shell = frame.locator('[data-asa-host-shell]');
  await expect(frame.locator('.blocklySvg')).toHaveCount(0);
  await expect(frame.getByPlaceholder('x', { exact: true })).toHaveCount(0);
  await frame.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(shell).not.toHaveAttribute('data-runtime-state', 'error');
  await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
  await expect(shell).toHaveAttribute('data-project-running', 'false');
  const directSave = await frame.locator('body').evaluate(
    async ({ apiOrigin, targetProjectId }) => {
      const storage = window.AsaBlocksStorage.createReadOnlyStorage(window.GUI, {
        projectId: targetProjectId,
        projectJson: null,
        assets: [],
        apiOrigin,
        canSave: false,
        getRuntimeToken: () => 'fixture.runtime.token',
      });
      try {
        await storage.saveProject(
          targetProjectId,
          JSON.stringify({ targets: [], monitors: [], extensions: [] }),
        );
        return 'unexpected_success';
      } catch (error) {
        return (error as Error).message;
      } finally {
        storage.dispose();
      }
    },
    { apiOrigin: parentOrigin, targetProjectId: projectId },
  );
  expect(directSave).toBe('runtime_storage_read_only');
  await page.screenshot({ path: `${evidenceDir}/02-read-only-player.png` });
  expect(fixture.pageErrors).toEqual([]);
});
