import { test, expect } from '@playwright/test';
import fs from 'node:fs';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let parentOrigin: string;
let runtimeUrl: string;
const evidenceDir = 'reports/blocks/product-integration';

test.beforeAll(async () => {
  ({ createProtocolFixture } = await import('../tools/blocks/browser/fixture.mjs'));
  ({ parentOrigin, runtimeUrl } = await import('../tools/blocks/browser/protocol.mjs'));
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('shipping fullscreen host loads the account avatar in ASA only and survives runtime failure', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  const requests: string[] = [];
  fixture.context.on('request', (request) => requests.push(request.url()));
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    const account = page.locator('[data-asa-blocks-account-overlay]');
    const avatar = account.locator('img');
    await expect(account).toHaveAccessibleName('Открыть аккаунт: Scratch acceptance account');
    await expect(avatar).toHaveAttribute('src', fixture.avatarDataUrl ?? 'missing-avatar');
    await expect
      .poll(() => avatar.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(account.locator('.blocks-editor-account-initials')).toHaveCount(0);
    await expect(frame.locator('[data-asa-blocks-account-overlay]')).toHaveCount(0);
    await expect(page.locator('.portal-shell, .portal-header')).toHaveCount(0);
    await expect(frame.locator('header[role="banner"]')).toHaveCount(1);
    await expect(frame.locator('#logo_img')).toHaveAttribute(
      'src',
      '/asa-lab-scratch-wordmark.svg',
    );
    for (const size of [
      { width: 1440, height: 960 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () => page.locator('[data-asa-blocks-fullscreen]').boundingBox())
        .toEqual({ x: 0, y: 0, ...size });
      const footer = await page.getByRole('status').boundingBox();
      expect(footer).not.toBeNull();
      await expect
        .poll(async () => page.locator('iframe').boundingBox())
        .toEqual({ x: 0, y: 0, width: size.width, height: size.height - footer!.height });
    }
    await expect(page.getByRole('status')).toContainText('изменения пока не сохраняются');
    await page.screenshot({ path: `${evidenceDir}/01-shipping-host-account.png` });
    await account.click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/account`);
    const updatedAvatar = fixture.updatedAvatarDataUrl;
    await page.evaluate((src) => {
      window.dispatchEvent(new CustomEvent('asa-profile-avatar-changed', { detail: src }));
    }, updatedAvatar);
    await expect(avatar).toHaveAttribute('src', updatedAvatar ?? 'missing-avatar');
    expect(requests).toContain(`${parentOrigin}/api/account/avatar`);
    expect(requests.filter((url) => url.startsWith(`${runtimeUrl}/api/account`))).toEqual([]);
    expect(
      requests.filter(
        (url) => /^https?:/.test(url) && ![parentOrigin, runtimeUrl].includes(new URL(url).origin),
      ),
    ).toEqual([]);
    await page.screenshot({ path: `${evidenceDir}/02-updated-account.png` });
    await frame.locator('body').evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'protocol-fixture-fatal' }));
    });
    await expect(page.getByRole('status')).toContainText('Ошибка Scratch runtime');
    await expect(account).toBeVisible();
    await expect(avatar).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}/03-parent-survives-failure.png` });
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    fs.writeFileSync(`${evidenceDir}/network.json`, JSON.stringify({ requests }, null, 2));
    await fixture.close();
  }
});

test('missing library files return HTTP 404 instead of a successful SPA document', async ({
  request,
}) => {
  for (const path of [
    '/library-assets/00000000000000000000000000000000.svg',
    '/library-assets/11111111-1111-4111-8111-111111111111.json',
  ]) {
    const response = await request.get(`${runtimeUrl}${path}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('data-asa-scratch-host');
  }
});

// Regression #256: text presence alone missed two overlapping live regions.
test('one parent status row stays outside the real editor in ready and fatal states', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'ru-RU' });
  const page = await fixture.context.newPage();
  const directory = `${evidenceDir}/status-layout`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    for (const state of ['ready', 'error']) {
      if (state === 'error') {
        await frame.locator('body').evaluate(() => {
          window.dispatchEvent(new ErrorEvent('error', { message: 'protocol-fixture-fatal' }));
        });
        await expect(page.getByRole('status')).toContainText('Ошибка Scratch runtime');
      }
      for (const size of [
        { width: 1440, height: 960 },
        { width: 1024, height: 768 },
        { width: 390, height: 844 },
        { width: 320, height: 720 },
      ]) {
        await page.setViewportSize(size);
        const status = page.getByRole('status');
        await expect(status).toHaveCount(1);
        await expect(status).toBeVisible();
        await expect(status).toContainText('изменения пока не сохраняются');
        await expect(frame.locator('#runtime-status')).toBeHidden();
        const footer = await status.boundingBox();
        const iframe = await page.locator('iframe[title="Scratch runtime"]').boundingBox();
        expect(footer).not.toBeNull();
        expect(iframe).not.toBeNull();
        expect(footer!.x).toBe(0);
        expect(footer!.width).toBe(size.width);
        expect(footer!.y + footer!.height).toBeCloseTo(size.height, 1);
        expect(iframe!.x).toBe(0);
        expect(iframe!.y).toBe(0);
        expect(iframe!.width).toBe(size.width);
        expect(iframe!.height).toBeGreaterThan(0);
        expect(iframe!.y + iframe!.height).toBeLessThanOrEqual(footer!.y);
        expect(iframe!.height + footer!.height).toBeCloseTo(size.height, 1);
        expect(
          await status.evaluate(
            (element) =>
              element.scrollWidth <= element.clientWidth &&
              element.scrollHeight <= element.clientHeight,
          ),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await expect(page.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
        await page.screenshot({ path: `${directory}/${state}-${size.width}.png` });
      }
    }
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('status presentation opt-in cannot hide local errors before accepted INIT', async () => {
  const fixture = await createProtocolFixture();
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${runtimeUrl}/?asaStatus=parent`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-runtime-state',
      'awaiting-init',
    );
    await expect(page.locator('#runtime-status')).toBeVisible();
    await expect(page.locator('#runtime-status')).toContainText('Ожидание безопасного подключения');
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

// Native Scratch File commands are not ASA durable save or the M1-007 import API.
// Reopen in a fresh browser so an in-memory VM/storage cache cannot fake restoration.
test('native File saves an edited sb3 and restores code and media in a fresh editor', async () => {
  const directory = `${evidenceDir}/native-file-roundtrip`;
  fs.mkdirSync(directory, { recursive: true });
  const savedPath = `${directory}/edited-project.sb3`;
  const marker = 'ASA File Sprite';
  const variable = 'ASA_File_Proof';
  const requests: Array<{ phase: string; url: string; method: string }> = [];
  const failed: Array<{ phase: string; url: string; error: string; type: string }> = [];
  const requestPhases = new WeakMap<object, string>();
  const badResponses: string[] = [];
  let phase = 'edit';
  let fixture: Awaited<ReturnType<typeof createProtocolFixture>> | undefined;
  const observe = (current: NonNullable<typeof fixture>) => {
    current.context.on('request', (request) => {
      requestPhases.set(request, phase);
      requests.push({ phase, url: request.url(), method: request.method() });
    });
    current.context.on('requestfailed', (request) => {
      failed.push({
        phase: requestPhases.get(request) ?? 'unknown',
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown',
        type: request.resourceType(),
      });
    });
    current.context.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });
  };
  try {
    fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
    observe(fixture);
    const page = await fixture.context.newPage();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    const program = frame.locator('.blocklyBlockCanvas').first();
    await program.getByText('8', { exact: true }).dblclick();
    await frame.locator('.blocklyHtmlInput').fill('37');
    await frame.locator('.blocklyHtmlInput').press('Enter');
    await expect(program.getByText('37', { exact: true })).toBeVisible();
    phase = 'sprite-library';
    await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
    await frame.getByText('Abby', { exact: true }).click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
    await frame.getByPlaceholder('Name', { exact: true }).fill(marker);
    await frame.getByPlaceholder('Name', { exact: true }).press('Enter');
    await frame.getByPlaceholder('x', { exact: true }).fill('137');
    await frame.getByPlaceholder('x', { exact: true }).press('Enter');
    await frame.getByRole('treeitem', { name: 'Variables', exact: true }).click();
    await frame.getByText('Make a Variable', { exact: true }).click();
    const dialog = frame.getByRole('dialog', { name: 'New Variable' });
    await dialog.getByRole('textbox').fill(variable);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    phase = 'sound-library';
    await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
    await frame.getByText('Bark', { exact: true }).click();
    await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
    await frame.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(frame.getByRole('button', { name: marker, exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('изменения пока не сохраняются');
    await page.screenshot({ path: `${directory}/01-before-save.png` });
    await frame.getByText('File', { exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await frame.getByText('Save to your computer', { exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.sb3$/i);
    await download.saveAs(savedPath);
    expect(await download.failure()).toBeNull();
    const savedBytes = fs.readFileSync(savedPath);
    expect(savedBytes.length).toBeGreaterThan(1024);
    expect(savedBytes.readUInt32LE(0)).toBe(0x04034b50);
    phase = 'new';
    page.once('dialog', async (confirmation) => {
      expect(confirmation.type()).toBe('confirm');
      expect(confirmation.message()).toBe('Replace contents of the current project?');
      await confirmation.accept();
    });
    await frame.getByText('File', { exact: true }).click();
    await frame.getByText('New', { exact: true }).click();
    await expect(frame.getByRole('button', { name: marker, exact: true })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Fixture Cat', exact: true })).toBeVisible();
    await expect(program.getByText('37', { exact: true })).toHaveCount(0);
    await expect(program.getByText('8', { exact: true })).toBeVisible();
    await expect(
      frame.locator('[class*="monitor_label"]').filter({ hasText: variable }),
    ).toHaveCount(0);
    await page.screenshot({ path: `${directory}/02-new-project.png` });
    expect(fixture.pageErrors).toEqual([]);
    await fixture.close();
    fixture = undefined;
    phase = 'fresh-boot';
    fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
    observe(fixture);
    const reopened = await fixture.context.newPage();
    await reopened.setViewportSize({ width: 1440, height: 960 });
    await reopened.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const restored = reopened.frameLocator('iframe[title="Scratch runtime"]');
    await expect(restored.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(restored.getByRole('button', { name: marker, exact: true })).toHaveCount(0);
    phase = 'restore';
    await restored.getByText('File', { exact: true }).click();
    const chooserPromise = reopened.waitForEvent('filechooser');
    await restored.getByText('Load from your computer', { exact: true }).click();
    await (await chooserPromise).setFiles(savedPath);
    const importedSprite = restored.getByRole('button', { name: marker, exact: true });
    await expect(importedSprite).toBeVisible();
    await importedSprite.click();
    await expect(restored.getByPlaceholder('Name', { exact: true })).toHaveValue(marker);
    await expect(restored.getByPlaceholder('x', { exact: true })).toHaveValue('137');
    await expect(
      restored.locator('[class*="monitor_label"]').filter({ hasText: variable }),
    ).toBeVisible();
    await restored.getByRole('tab', { name: 'Costumes', exact: true }).click();
    await expect(
      restored
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Abby-a', { exact: true }),
    ).toBeVisible();
    await expect(
      restored
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Abby-d', { exact: true }),
    ).toBeVisible();
    const costumeImage = importedSprite.locator('img').first();
    await expect
      .poll(() => costumeImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await reopened.screenshot({ path: `${directory}/03-restored-costumes.png` });
    await restored.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await restored
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Bark', { exact: true })
      .click();
    await expect(restored.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
    await reopened.screenshot({ path: `${directory}/04-restored-sound.png` });
    await restored.getByRole('tab', { name: 'Code', exact: true }).click();
    await restored.getByRole('button', { name: 'Fixture Cat', exact: true }).click();
    await expect(
      restored.locator('.blocklyBlockCanvas').first().getByText('37', { exact: true }),
    ).toBeVisible();
    await restored.getByRole('button', { name: 'Start project', exact: true }).click();
    const shell = restored.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-project-running', 'true');
    const ticks = restored
      .locator('[class*="monitor_monitor-container"]')
      .filter({ hasText: 'Ticks' })
      .locator('[class*="monitor_value"]');
    await expect.poll(async () => Number(await ticks.textContent())).toBeGreaterThan(2);
    await restored.getByRole('button', { name: 'Stop project', exact: true }).click();
    await expect(shell).toHaveAttribute('data-project-running', 'false');
    await expect(reopened.getByRole('status')).toContainText('изменения пока не сохраняются');
    await expect(reopened.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
    await reopened.screenshot({ path: `${directory}/05-restored-program.png` });
    const httpRequests = requests.filter(({ url }) => /^https?:/.test(url));
    expect(
      httpRequests.filter(({ url }) => ![parentOrigin, runtimeUrl].includes(new URL(url).origin)),
    ).toEqual([]);
    expect(httpRequests.filter(({ method }) => !['GET', 'HEAD'].includes(method))).toEqual([]);
    expect(
      httpRequests.filter(
        ({ phase: step, url }) =>
          step === 'restore' && new URL(url).pathname.startsWith('/library-assets/'),
      ),
    ).toEqual([]);
    // Closing a stock picker may cancel an unused thumbnail. Keep that evidence,
    // but do not confuse it with failed project/media reads during file restoration.
    expect(
      failed.filter(
        (failure) =>
          !(
            failure.phase === 'sprite-library' &&
            failure.type === 'image' &&
            failure.error === 'net::ERR_ABORTED' &&
            new URL(failure.url).origin === runtimeUrl &&
            /^\/library-assets\/[a-f0-9]{32}\.(svg|png|jpg)$/.test(new URL(failure.url).pathname)
          ),
      ),
    ).toEqual([]);
    expect(badResponses).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    try {
      fs.writeFileSync(
        `${directory}/network.json`,
        JSON.stringify({ requests, failed, badResponses }, null, 2),
      );
    } finally {
      await fixture?.close();
    }
  }
});
