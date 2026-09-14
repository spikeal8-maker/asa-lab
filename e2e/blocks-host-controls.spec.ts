import { test, expect, type BrowserContext, type Frame, type Page } from '@playwright/test';
import fs from 'node:fs';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let runtimeFrame: typeof import('../tools/blocks/browser/assertions.mjs').runtimeFrame;
let waitForRuntimeState: typeof import('../tools/blocks/browser/assertions.mjs').waitForRuntimeState;
let initMessage: typeof import('../tools/blocks/browser/protocol.mjs').initMessage;
let parentOrigin: string;
let runtimeUrl: string;
let sendFromParent: typeof import('../tools/blocks/browser/protocol.mjs').sendFromParent;

const evidenceDir = 'reports/blocks/product-chrome';

test.beforeAll(async () => {
  ({ createProtocolFixture } = await import('../tools/blocks/browser/fixture.mjs'));
  ({ runtimeFrame, waitForRuntimeState } = await import('../tools/blocks/browser/assertions.mjs'));
  ({ initMessage, parentOrigin, runtimeUrl, sendFromParent } =
    await import('../tools/blocks/browser/protocol.mjs'));
  fs.mkdirSync(evidenceDir, { recursive: true });
});

async function openEditor(locale: string): Promise<{
  fixture: Awaited<ReturnType<typeof createProtocolFixture>>;
  context: BrowserContext;
  page: Page;
  frame: Frame;
  external: string[];
}> {
  const fixture = await createProtocolFixture({ locale });
  const external: string[] = [];
  fixture.context.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && ![runtimeUrl, parentOrigin].includes(new URL(url).origin)) {
      external.push(url);
    }
  });
  const page = await fixture.context.newPage();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(parentOrigin, { waitUntil: 'domcontentloaded' });
  const frame = await runtimeFrame(page);
  await waitForRuntimeState(frame, 'awaiting-init');
  await sendFromParent(page, { ...initMessage, hasProjectJson: false, mode: 'editor' });
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 45000 },
  );
  await expect(frame.locator('.blocklySvg').first()).toBeVisible();
  return { fixture, context: fixture.context, page, frame, external };
}

async function closeFixture(fixture: Awaited<ReturnType<typeof createProtocolFixture>>) {
  await fixture.close();
}

async function assertAsaChrome(page: Page, frame: Frame) {
  const logo = frame.locator('#logo_img');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /asa-lab-mark\.svg$/);

  const header = frame.locator('header[role="banner"]');
  await expect(header).toBeVisible();
  await expect
    .poll(() => header.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe('rgb(8, 119, 179)');

  const account = page.locator('[data-asa-blocks-account-overlay]');
  await expect(account).toBeVisible();
  await expect(account).toHaveAccessibleName('Открыть аккаунт: Пользователь ASA Lab');
  await expect(frame.locator('[data-asa-blocks-account-overlay]')).toHaveCount(0);
}

test('English browser keeps native Scratch controls, ASA chrome and unfiltered extension catalogue', async () => {
  const { fixture, page, frame, external } = await openEditor('en-US');
  try {
    await assertAsaChrome(page, frame);

    await expect(frame.getByRole('button', { name: 'Settings menu' })).toBeVisible();
    await expect(frame.getByText('File', { exact: true })).toBeVisible();
    await expect(frame.getByText('Edit', { exact: true })).toBeVisible();

    await frame.getByRole('button', { name: 'Settings menu' }).click();
    await expect(frame.getByText('Language', { exact: true })).toHaveCount(1);
    await frame.getByText('Language', { exact: true }).click();
    await expect(frame.getByText('Русский', { exact: true })).toBeVisible();
    await expect(frame.getByText('English', { exact: true })).toBeVisible();

    // Language exists only in native Settings; there is no second ASA language control.
    await expect(frame.getByText('Language', { exact: true })).toHaveCount(1);

    // Close the nested language/settings menus before opening Extensions.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const extensionButton = frame.getByRole('button', { name: 'Add Extension' });
    await expect(extensionButton).toBeVisible();
    await extensionButton.click();
    await expect(frame.getByText('Music', { exact: true })).toBeVisible();
    await expect(frame.getByText('Pen', { exact: true })).toBeVisible();
    await expect(frame.getByText('Translate', { exact: true })).toBeVisible();
    await expect(frame.getByText('Text to Speech', { exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: /^micro:bit\b/ })).toBeVisible();
    await expect(frame.getByRole('button', { name: /^LEGO MINDSTORMS EV3\b/ })).toBeVisible();

    await page.screenshot({
      path: `${evidenceDir}/01-asa-chrome-and-account.png`,
      fullPage: true,
    });
    expect(external).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await closeFixture(fixture);
  }
});

test('ru-RU browser starts in native Russian Scratch and changes language only through Settings', async () => {
  const { fixture, page, frame, external } = await openEditor('ru-RU');
  try {
    await assertAsaChrome(page, frame);
    await expect(frame.getByText('Настройки', { exact: true })).toBeVisible();
    await expect(frame.getByText('Файл', { exact: true })).toBeVisible();
    await expect(frame.getByText('Редактировать', { exact: true })).toBeVisible();

    await frame.getByText('Настройки', { exact: true }).click();
    await expect(frame.getByText('Язык', { exact: true })).toHaveCount(1);
    await frame.getByText('Язык', { exact: true }).click();
    await frame.getByText('English', { exact: true }).click();
    await expect(frame.getByText('Settings', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await frame.getByText('Settings', { exact: true }).click();
    await frame.getByText('Language', { exact: true }).click();
    await frame.getByText('Русский', { exact: true }).click();
    await expect(frame.getByText('Настройки', { exact: true })).toBeVisible();

    await page.screenshot({
      path: `${evidenceDir}/02-native-russian-settings.png`,
      fullPage: true,
    });
    expect(external).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await closeFixture(fixture);
  }
});
