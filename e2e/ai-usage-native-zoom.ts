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

/** Native browser zoom in an owned disposable CI profile, never CSS scaling or
 * viewport emulation. Adapted from the existing course-editor native zoom gate. */
export async function openAiUsageNativeZoom(sourcePage: Page) {
  if (process.env.CI !== 'true')
    throw new Error('AI overview native zoom requires the isolated CI browser gate.');
  const directory = await mkdtemp(path.join(tmpdir(), 'asa-ai-usage-zoom-'));
  const extension = path.join(directory, 'extension');
  let context: BrowserContext | undefined;
  let zoomMayBeChanged = false;
  let resetZoom: (() => Promise<{ factor: number }>) | undefined;

  async function close(failure?: { error: unknown }) {
    const errors: unknown[] = [];
    async function cleanup(stage: string, action: () => Promise<unknown>) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(action),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`AI zoom ${stage} cleanup timed out`)), 5000);
          }),
        ]);
      } catch (error) {
        errors.push(error);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    if (zoomMayBeChanged && resetZoom) {
      const reset = resetZoom;
      await cleanup('reset', async () => {
        if ((await reset()).factor !== 1)
          throw new Error('AI overview native zoom reset did not confirm factor 1.');
      });
    }
    const ownedContext = context;
    if (ownedContext) await cleanup('context', () => ownedContext.close());
    await cleanup('profile', () => rm(directory, { recursive: true, force: true }));
    if (failure) throw failure.error;
    if (errors.length) throw new AggregateError(errors, 'AI overview native zoom cleanup failed');
  }

  try {
    await mkdir(extension);
    await writeFile(
      path.join(extension, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'ASA AI overview native zoom evidence',
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
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
      channel: 'chromium',
      headless: true,
      viewport: null,
      baseURL: new URL(sourcePage.url()).origin,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--window-size=1440,1200',
      ],
    });
    // The dedicated runner has trace:off. No storage-state, cookie or profile
    // files become artifacts; run-created session cookies are transferred in memory.
    await context.addCookies(await sourcePage.context().cookies());
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    const control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/control.html`);
    const page =
      context.pages().find((candidate) => candidate !== control) ?? (await context.newPage());
    await page.bringToFront();

    async function setZoom(factor: 1 | 2) {
      if (factor === 2) zoomMayBeChanged = true;
      const result = await control.evaluate(
        async ({ url, factor }) => {
          const tabs = (globalThis as unknown as { chrome: { tabs: NativeTabs } }).chrome.tabs;
          const matches = (await tabs.query({})).filter((tab) => tab.url === url);
          if (matches.length !== 1 || matches[0]!.id === undefined)
            throw new Error('Expected one exact AI overview tab for native zoom.');
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
      if (factor === 1 && result.factor === 1) zoomMayBeChanged = false;
      return result;
    }
    resetZoom = () => setZoom(1);
    return { page, setZoom, close };
  } catch (error) {
    await close({ error });
    throw error;
  }
}
