#!/usr/bin/env node
// Validates the ONE-row simulation controls in the real account-backed Robotics UI.
// Operates exclusively on the isolated D2-R2 demo. No document mutations.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const stateDir = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const account = Object.fromEntries(
  readFileSync(join(stateDir, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const origin = 'http://127.0.0.1:4630';
if (!account.URL?.startsWith(origin + '/#/home/')) throw new Error('Local Robotics project only');
const evidenceDir = join(process.cwd(), 'e2e/artifacts/robotics-field-palette-007/toolbars');
mkdirSync(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const requestWrites = [];
page.on('request', (request) => {
  const u = new URL(request.url());
  if (u.origin === origin && u.pathname.startsWith('/api/projects') && request.method() !== 'GET')
    requestWrites.push(request.method() + ' ' + u.pathname);
});
const sections = [
  { name: 'Поле', id: 'field', toolbar: '.robotics-field-toolbar' },
  { name: 'Робот', id: 'robot', toolbar: '.robotics-robot-toolbar' },
  { name: 'Электроника', id: 'electronics', toolbar: '.robotics-electronics-toolbar' },
  { name: 'Код', id: 'program', toolbar: '.arduino-code-toolbar' },
];
const measurements = [];
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home-header-actions').getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(account.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(account.PASSWORD);
  const bot = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await bot.isVisible()) {
    await bot.press('Space');
    await expect(bot).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25_000 });
  await page.goto(account.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 30_000 });

  for (const width of [1728, 1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
    for (const section of sections) {
      await page.getByRole('tab', { name: section.name, exact: true }).click();
      await expect(page.getByTestId('robotics-lab')).toHaveAttribute('data-section', section.id);
      const loc = page.locator(section.toolbar).filter({ visible: true }).first();
      await expect(loc).toBeVisible({ timeout: 25_000 });
      const controls = loc.locator('.robotics-run-bar');
      await expect(controls).toHaveCount(1);
      const play = controls.getByRole('button', { name: 'Запустить' });
      await expect(play).toBeVisible();
      const m = await page.evaluate((selector) => {
        const h = document.querySelector('.robotics-unified-header').getBoundingClientRect();
        const w = document.querySelector('.robotics-workspace').getBoundingClientRect();
        const t = [...document.querySelectorAll(selector)].find(
          (x) => x.getBoundingClientRect().height > 0,
        );
        if (!t) throw Error('Missing visible toolbar');
        const a = t.getBoundingClientRect();
        const c = t.querySelector('.robotics-run-bar').getBoundingClientRect();
        const p = t
          .querySelector('.robotics-run-buttons .robotics-button.primary')
          .getBoundingClientRect();
        const hit = document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2);
        return {
          width: innerWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
          headerBottom: h.bottom,
          workspaceTop: w.top,
          toolbar: { x: a.x, right: a.right, top: a.top, bottom: a.bottom, height: a.height },
          controls: { x: c.x, right: c.right, top: c.top, bottom: c.bottom, height: c.height },
          slot: (() => {
            const node = t.querySelector('.robotics-toolbar-run-slot');
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              height: r.height,
              align: getComputedStyle(node).alignItems,
            };
          })(),
          computed: {
            top: getComputedStyle(t.querySelector('.robotics-run-bar')).top,
            marginTop: getComputedStyle(t.querySelector('.robotics-run-bar')).marginTop,
            alignSelf: getComputedStyle(t.querySelector('.robotics-run-bar')).alignSelf,
          },
          play: { x: p.x, right: p.right },
          hitPlay: !!hit?.closest('.robotics-run-buttons .robotics-button.primary'),
        };
      }, section.toolbar);
      if (m.pageScrollWidth > width + 1)
        throw Error('Horizontal page overflow ' + JSON.stringify({ section, width, m }));
      if (Math.abs(m.workspaceTop - m.headerBottom) > 2)
        throw Error('Extra simulator row ' + JSON.stringify({ section, width, m }));
      if (Math.abs(m.toolbar.height - 46) > 2)
        throw Error('Toolbar not 46 px ' + JSON.stringify({ section, width, m }));
      if (Math.abs(m.controls.right - m.toolbar.right) > 10)
        throw Error('Run controls not aligned right ' + JSON.stringify({ section, width, m }));
      if (m.controls.top + 1 < m.toolbar.top || m.controls.bottom > m.toolbar.bottom + 2)
        throw Error('Run controls overflow the tool row ' + JSON.stringify({ section, width, m }));
      if (!m.hitPlay)
        throw Error(
          'Run button blocked by another element ' + JSON.stringify({ section, width, m }),
        );
      console.log(
        'PASS ' +
          section.name +
          ' ' +
          width +
          ': one 46px toolbar, controls at right, no extra row/overlap',
      );
      measurements.push({ section: section.id, ...m });
      if (width === 1728 || width === 1440 || width === 390) {
        await page.screenshot({
          path: join(evidenceDir, section.id + '-' + width + '.png'),
          fullPage: false,
        });
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'Код', exact: true }).click();
  const codeBar = page.locator('.robotics-program-shell .arduino-code-toolbar');
  await expect(codeBar).toBeVisible();
  const board = codeBar.getByRole('combobox', { name: 'Программируемая плата' });
  await expect(board).toBeVisible();
  const mode = codeBar.locator('.arduino-mode-menu > summary');
  await expect(mode).toBeVisible();
  const br = await board.boundingBox(),
    mr = await mode.boundingBox();
  const codeBarRect = await codeBar.boundingBox();
  if (!br || !mr || !codeBarRect || br.x > mr.x + 2 || br.x - codeBarRect.x > 35)
    throw Error(
      'Arduino Uno board selector not at toolbar left: ' + JSON.stringify({ br, mr, codeBarRect }),
    );
  if (await page.getByRole('combobox', { name: 'Пример программы' }).isVisible())
    throw Error('Educational example still clutters primary Code toolbar');
  const more = codeBar.locator('.robotics-code-extras > summary');
  await more.click();
  await expect(page.getByRole('combobox', { name: 'Пример программы' })).toBeVisible();
  await expect(page.locator('.robotics-code-extras-menu')).toContainText('демонстрационный опыт');
  await more.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await more.click();
  const mobileExamples = await page.locator('.robotics-code-extras-menu').boundingBox();
  if (!mobileExamples || mobileExamples.x < 0 || mobileExamples.x + mobileExamples.width > 391)
    throw Error(
      'Optional Code menu spills outside mobile viewport: ' + JSON.stringify(mobileExamples),
    );
  await more.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log('PASS Code: Arduino Uno left; examples explained and accessible on mobile');

  await page.getByRole('tab', { name: 'Электроника' }).click();
  const drawerToggle = page
    .getByRole('toolbar', { name: 'Инструменты электроники' })
    .getByRole('button', { name: 'Открыть код' });
  await drawerToggle.click();
  await expect(page.getByRole('region', { name: 'Выдвижной редактор кода Arduino' })).toBeVisible();
  await expect(page.locator('.robotics-electronics-toolbar .robotics-run-bar')).toBeVisible();
  await page
    .getByRole('toolbar', { name: 'Инструменты электроники' })
    .getByRole('button', { name: 'Закрыть код' })
    .click();
  await expect(page.getByRole('region', { name: 'Выдвижной редактор кода Arduino' })).toHaveCount(
    0,
  );
  console.log('PASS drawer still accessible, simulator controls remain in Electronics toolbar');

  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Остановить' })).toBeVisible();
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.getByRole('button', { name: 'Запустить', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить' }).click();
  await expect(page.getByTestId('robotics-time')).toHaveAttribute('data-microseconds', '0');
  console.log('PASS simulation actions still work after the move');

  await page.getByRole('tab', { name: 'Код', exact: true }).click();
  const avatarMenu = page.locator('.robotics-header-profile > summary');
  await avatarMenu.click();
  const homeAction = page
    .locator('.robotics-header-menu-panel')
    .getByRole('button', { name: 'Главная', exact: true });
  await expect(homeAction).toBeVisible();
  const menuTopmost = await homeAction.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return button === target || button.contains(target);
  });
  if (!menuTopmost) throw Error('Profile navigation is overlapped by simulation controls');
  await homeAction.click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 15000 });
  console.log('PASS profile dropdown is above Code/simulation controls and navigates home');

  if (errors.length) throw Error('Browser JavaScript errors: ' + errors.join(' | '));
  const unexpected = requestWrites.filter((item) => !item.endsWith('/snapshot'));
  const exitSnapshot = requestWrites.filter((item) => item.endsWith('/snapshot'));
  if (unexpected.length || exitSnapshot.length > 1)
    throw Error('Unexpected project API writes: ' + requestWrites.join(' | '));
  console.log('PASS no project source writes; at most one expected exit thumbnail');
  writeFileSync(
    join(evidenceDir, 'measurements.json'),
    JSON.stringify(measurements, null, 2) + '\n',
  );
  console.log('PASS no JavaScript errors, no project API writes');
} catch (error) {
  console.error('ONE_ROW_ACCEPTANCE_FAILED ' + String(error));
  await page
    .screenshot({ path: join(evidenceDir, 'failure.png'), fullPage: false })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
