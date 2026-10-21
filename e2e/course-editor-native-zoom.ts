import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface NativeTabs {
  query: (query: Record<string, never>) => Promise<Array<{ id?: number; url?: string }>>;
  setZoomSettings: (
    tabId: number,
    settings: { mode: 'automatic'; scope: 'per-tab' },
  ) => Promise<void>;
  setZoom: (tabId: number, factor: number) => Promise<void>;
  getZoom: (tabId: number) => Promise<number>;
  getZoomSettings: (tabId: number) => Promise<{ mode: string; scope: string }>;
}

/** A separate CI-only browser profile; never changes the ordinary test page's viewport. */
export async function openCourseNativeZoom(sourcePage: Page, evidence: string) {
  if (process.env['CI'] !== 'true')
    throw new Error('Native Chromium zoom evidence requires the isolated CI browser gate.');
  const ownedDirectory = await mkdtemp(path.join(tmpdir(), 'asa-course-native-zoom-'));
  const extension = path.join(ownedDirectory, 'extension');
  let context: BrowserContext | undefined;
  try {
    await mkdir(extension);
    await writeFile(
      path.join(extension, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'ASA Course Editor native zoom evidence',
        version: '1.0.0',
        permissions: ['tabs'],
        background: { service_worker: 'background.js' },
      }),
    );
    await writeFile(
      path.join(extension, 'background.js'),
      'chrome.runtime.onInstalled.addListener(() => {});\n',
    );
    await writeFile(
      path.join(extension, 'control.html'),
      '<!doctype html><title>Zoom control</title>',
    );
    // Playwright v1.55.1 chrome-extensions-js-python.md documents persistent
    // channel chromium for headless MV3. viewport:null avoids device-metrics
    // emulation; tabs automatic mode asks Chromium itself to scale the page.
    context = await chromium.launchPersistentContext(path.join(ownedDirectory, 'profile'), {
      channel: 'chromium',
      headless: true,
      viewport: null,
      baseURL: new URL(sourcePage.url()).origin,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--window-size=1440,900',
      ],
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    // Copy only the run-created author's cookies in memory; no storage-state file.
    await context.addCookies(await sourcePage.context().cookies());
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    const control = await context.newPage();
    // An extension page keeps the tabs API callable without relying on newer
    // Playwright support for restarting an idle Manifest V3 worker.
    await control.goto(`chrome-extension://${extensionId}/control.html`);
    const page =
      context.pages().find((candidate) => candidate !== control) ?? (await context.newPage());
    await page.bringToFront();
    const ownedContext = context;
    return {
      page,
      async setZoom(factor: 1 | 2) {
        return control.evaluate(
          async ({ url, factor }) => {
            const tabs = (globalThis as unknown as { chrome: { tabs: NativeTabs } }).chrome.tabs;
            const matches = (await tabs.query({})).filter((tab) => tab.url === url);
            if (matches.length !== 1 || matches[0]!.id === undefined)
              throw new Error('Expected one exact Course Editor tab for native zoom.');
            const tabId = matches[0]!.id;
            await tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' });
            await tabs.setZoom(tabId, factor);
            return {
              factor: await tabs.getZoom(tabId),
              settings: await tabs.getZoomSettings(tabId),
            };
          },
          { url: page.url(), factor },
        );
      },
      async close() {
        try {
          await ownedContext.tracing.stop({ path: path.join(evidence, 'native-zoom-trace.zip') });
        } finally {
          try {
            await ownedContext.close();
          } finally {
            await rm(ownedDirectory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    try {
      await context?.close();
    } finally {
      await rm(ownedDirectory, { recursive: true, force: true });
    }
    throw error;
  }
}
