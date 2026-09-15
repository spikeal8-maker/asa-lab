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
        .poll(async () => page.locator('iframe').boundingBox())
        .toEqual({ x: 0, y: 0, ...size });
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
