import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const local = join(process.env.LOCALAPPDATA, 'ASA-Lab-Robotics-Fast-Dev-001');
const credentialPath = join(local, 'demo-login.txt');
const savedCredentials = existsSync(credentialPath);
const credentials = savedCredentials
  ? Object.fromEntries(
      readFileSync(credentialPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
  : {
      EMAIL: 'robotics-header-' + randomUUID().replaceAll('-', '') + '@isolated.test',
      PASSWORD: 'RobotHeader-' + randomUUID() + '-Password',
      URL: '',
    };
const out = join(process.cwd(), 'e2e', 'artifacts', 'robotics-header-ui-002');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: 'http://127.0.0.1:4630',
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const metrics = [];
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  const action = savedCredentials ? 'Войти' : 'Создать аккаунт';
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: action, exact: true })
    .click();
  if (savedCredentials) {
    await page.getByLabel('Почта или логин', { exact: true }).fill(credentials.EMAIL);
  } else {
    await page.getByLabel('Email', { exact: true }).fill(credentials.EMAIL);
    await page.getByLabel('Отображаемое имя', { exact: true }).fill('Локальная робототехника');
    await page.getByLabel('Дата рождения', { exact: true }).fill('1991-04-18');
  }
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.PASSWORD);
  const challenge = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await challenge.isVisible()) {
    await challenge.press('Space');
    await expect(challenge).toBeChecked();
  }
  await page.getByRole('button', { name: action, exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25000 });
  if (!savedCredentials) {
    await page.locator('.portal-header .portal-quick-create > summary').click();
    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/projects' &&
        response.request().method() === 'POST',
    );
    await page
      .locator('.portal-header .portal-create-options')
      .getByRole('button', { name: /^Робототехника/ })
      .click();
    const created = await createdResponse;
    if (created.status() !== 201) throw new Error('Demo project creation HTTP ' + created.status());
    const projectId = (await created.json()).project.id;
    credentials.URL = 'http://127.0.0.1:4630/#/home/' + projectId + '?module=robotics';
    mkdirSync(local, { recursive: true });
    writeFileSync(
      credentialPath,
      'EMAIL=' +
        credentials.EMAIL +
        '\nPASSWORD=' +
        credentials.PASSWORD +
        '\nURL=' +
        credentials.URL +
        '\n',
    );
  }

  await page.goto(credentials.URL, { waitUntil: 'domcontentloaded' });
  const header = page.locator('.robotics-unified-header');
  const avatar = header.locator('.robotics-header-avatar');
  const save = header.getByRole('button', { name: 'Сохранить' });
  const title = header.getByRole('textbox', { name: 'Название проекта' });
  await expect(header).toBeVisible({ timeout: 30000 });
  await expect(avatar).toBeVisible();
  await expect(avatar.locator('img')).toBeVisible();
  await expect
    .poll(() => avatar.locator('img').evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(save).toHaveAttribute('data-save-state', 'saved');
  const initialTitle = await title.inputValue();
  await title.fill(initialTitle + '!');
  await expect(save).toHaveAttribute('data-save-state', 'dirty');
  await title.fill(initialTitle);
  await expect(save).toHaveAttribute('data-save-state', 'saved');
  console.log('PASS profile image, save state transition saved → dirty → saved');

  for (const name of ['Поле', 'Робот', 'Электроника', 'Программа']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  console.log('PASS all four sections');

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(header).toBeVisible();
    await expect(avatar).toBeVisible();
    const layout = await header.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const avatarRect = element.querySelector('.robotics-header-avatar').getBoundingClientRect();
      const saveRect = element.querySelector('.robotics-header-save').getBoundingClientRect();
      const tabs = [...element.querySelectorAll('.robotics-tabs > button')].map((tab) => {
        const r = tab.getBoundingClientRect();
        return {
          width: Number(r.width.toFixed(2)),
          x: Number(r.x.toFixed(2)),
          right: Number(r.right.toFixed(2)),
        };
      });
      const status = element.querySelector('.robotics-header-status');
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll('body *')]
          .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8)
          .map((node) => ({
            tag: node.tagName,
            className: String(node.className).slice(0, 90),
            right: Math.round(node.getBoundingClientRect().right),
          })),
        header: { x: rect.x, right: rect.right },
        avatar: { x: avatarRect.x, right: avatarRect.right },
        save: { x: saveRect.x, right: saveRect.right },
        tabs,
        statusWidth: status.getBoundingClientRect().width,
      };
    });
    if (layout.documentWidth > width) {
      throw new Error('Viewport overflow: ' + JSON.stringify(layout));
    }
    if (
      Math.max(...layout.tabs.map((item) => item.width)) -
        Math.min(...layout.tabs.map((item) => item.width)) >
      1
    ) {
      throw new Error('Section buttons have unequal widths: ' + JSON.stringify(layout));
    }
    if (layout.avatar.right > width + 1 || layout.avatar.right < width - 20) {
      throw new Error('Avatar not at right edge: ' + JSON.stringify(layout));
    }
    if (layout.save.right > layout.tabs[0].x + 1) {
      throw new Error('Save overlaps sections: ' + JSON.stringify(layout));
    }
    if (layout.statusWidth > 2) throw new Error('Persistent save status still visible');
    await page.screenshot({ path: join(out, 'editor-' + width + '.png'), fullPage: false });
    await header.screenshot({ path: join(out, 'header-' + width + '.png') });
    metrics.push(layout);
    console.log('PASS viewport ' + width + ': avatar far right, 4 equal segments, save separate');
  }

  const summary = header.locator('.robotics-header-profile > summary');
  await summary.click();
  for (const name of ['Главная', 'Мои проекты', 'Аккаунт', 'Публикация']) {
    await expect(
      header.locator('.robotics-header-menu-panel').getByRole('button', { name }),
    ).toBeVisible();
  }
  await summary.click();
  if (errors.length) throw new Error('Browser page errors: ' + errors.join(' | '));
  console.log('PASS actions available only within avatar menu');
  console.log('PASS no uncaught browser errors');
  writeFileSync(join(out, 'measurements.json'), JSON.stringify(metrics, null, 2));
} catch (e) {
  console.error('FAIL', String(e));
  await page.screenshot({ path: join(out, 'failed.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
