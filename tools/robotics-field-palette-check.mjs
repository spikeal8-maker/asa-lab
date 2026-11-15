#!/usr/bin/env node
// D2-R2 account-backed Robotics field palette acceptance, no shared services touched.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const local = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const credentials = Object.fromEntries(
  readFileSync(join(local, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const origin = 'http://127.0.0.1:4630';
if (!credentials.URL?.startsWith(origin + '/#/home/')) throw new Error('D2-R2 local project only');
const evidence = join(process.cwd(), 'e2e/artifacts/robotics-field-palette-007');
mkdirSync(evidence, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
const projectWrites = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (request) => {
  const url = new URL(request.url());
  if (
    url.origin === origin &&
    url.pathname.startsWith('/api/projects') &&
    request.method() !== 'GET'
  )
    projectWrites.push(request.method() + ' ' + url.pathname);
});
const evidenceData = [];
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(credentials.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.PASSWORD);
  const check = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await check.isVisible()) {
    await check.press('Space');
    await expect(check).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 20000 });
  await page.goto(credentials.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 25000 });
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();

  const palette = page.getByTestId('robotics-field-palette');
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('region', { name: 'Предметы' })).toBeVisible();
  await expect(palette.getByRole('region', { name: 'Разметка и трасса' })).toBeVisible();
  for (const name of ['Стена', 'Мяч', 'Банка', 'Брусок', 'Линия', 'Кривая', 'Зона', 'Трасса'])
    await expect(palette.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('toolbar', { name: 'Инструменты поля' })
      .getByRole('button', { name: 'Стена', exact: true }),
  ).toHaveCount(0);
  const settings = page.locator('.robotics-field-settings-sheet');
  await expect(settings).not.toHaveAttribute('open', '');
  await settings.locator(':scope > summary').click();
  await expect(page.getByRole('combobox', { name: 'Режим физики' })).toBeVisible();
  await settings.locator(':scope > summary').click();
  console.log('PASS right palette groups and compact settings accordion');

  const field = page.locator('.robotics-field-canvas svg.robotics-field');
  const balls = page.locator('.robotics-field-canvas [data-object-kind="ball"]');
  await expect(field).toBeVisible();
  const initial = await balls.count();
  const projectId = new URL(credentials.URL).hash.match(/#\/home\/([^?]+)/)?.[1];
  if (!projectId) throw new Error('No local project ID');
  const apiResult = await page.request.get('/api/projects/' + projectId);
  if (!apiResult.ok()) throw new Error('Could not read local project field size');
  const fieldHeight = (await apiResult.json()).draft.document.world.field.heightMeters;
  if (!Number.isFinite(fieldHeight)) throw new Error('Invalid project height');
  const rect = await field.boundingBox();
  if (!rect) throw new Error('No field SVG geometry');
  const dropX = rect.width * 0.68,
    dropY = rect.height * 0.48;
  const point = await field.evaluate(
    (svg, p) => {
      const matrix = svg.getScreenCTM();
      if (!matrix) throw Error('No matrix');
      const pt = svg.createSVGPoint();
      const r = svg.getBoundingClientRect();
      pt.x = r.left + p.x;
      pt.y = r.top + p.y;
      const local = pt.matrixTransform(matrix.inverse());
      return {
        x: local.x / 1000,
        y: p.height - local.y / 1000,
      };
    },
    { x: dropX, y: dropY, height: fieldHeight },
  );
  await palette
    .getByRole('button', { name: 'Мяч', exact: true })
    .dragTo(field, { targetPosition: { x: dropX, y: dropY }, timeout: 10000 });
  await expect(balls).toHaveCount(initial + 1, { timeout: 6000 });
  const placed = await balls.last().evaluate((el) => ({
    x: Number(el.getAttribute('data-x-meters')),
    y: Number(el.getAttribute('data-y-meters')),
  }));
  if (!Number.isFinite(placed.x) || !Number.isFinite(placed.y))
    throw new Error('New ball has no coordinates');
  if (Math.hypot(placed.x - point.x, placed.y - point.y) > 0.12)
    throw new Error(
      'Drag-and-drop did not honor the cursor position: ' + JSON.stringify({ point, placed }),
    );
  console.log('PASS native drag/drop: ball placed at pointer coordinates', JSON.stringify(placed));
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(balls).toHaveCount(initial);
  console.log('PASS drag/drop is a single reversible undo step');
  for (const item of [
    { name: 'Стена', selector: '[data-object-kind="wall"]', x: 0.32, y: 0.23 },
    { name: 'Линия', selector: '[data-object-kind="line"]', x: 0.38, y: 0.33 },
  ]) {
    const objects = page.locator('.robotics-field-canvas ' + item.selector);
    const before = await objects.count();
    await palette
      .getByRole('button', { name: item.name, exact: true })
      .dragTo(field, { targetPosition: { x: rect.width * item.x, y: rect.height * item.y } });
    await expect(objects).toHaveCount(before + 1);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(objects).toHaveCount(before);
    console.log('PASS drag/drop and Undo for ' + item.name);
  }

  for (const width of [1728, 1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width > 760 ? 900 : 844 });
    await page.getByRole('tab', { name: 'Поле', exact: true }).click();
    const mobile = width <= 760;
    if (mobile) {
      const toggle = page.getByRole('button', { name: /Элементы поля/ });
      await expect(toggle).toBeVisible();
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      await expect(palette).toBeVisible();
    }
    const geometry = await page.evaluate(() => {
      const bound = (selector) => {
        const el = [...document.querySelectorAll(selector)].find(
          (e) => e.getBoundingClientRect().height && getComputedStyle(e).visibility !== 'hidden',
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const cards = [...document.querySelectorAll('.robotics-field-palette-card')].map((el) => {
        const art = el.querySelector('.robotics-field-palette-art').getBoundingClientRect();
        const label = el.querySelector('.robotics-field-palette-name').getBoundingClientRect();
        return {
          artBottom: art.bottom,
          labelTop: label.top,
          cardWidth: el.getBoundingClientRect().width,
        };
      });
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        toolbar: bound('.robotics-field-toolbar'),
        runbar: bound('.robotics-field-toolbar .robotics-run-bar'),
        palette: bound('.robotics-field-palette'),
        canvas: bound('.robotics-field-canvas'),
        workspace: bound('.robotics-workspace'),
        panel: bound('.robotics-field-panel'),
        body: bound('.robotics-field-editor-body'),
        scroll: bound('.robotics-field-toolbar-scroll'),
        scrollActual: document.querySelector('.robotics-field-toolbar-scroll')?.scrollWidth,
        gridTracks: getComputedStyle(document.querySelector('.robotics-workspace'))
          .gridTemplateColumns,
        cards,
      };
    });
    if (geometry.scrollWidth > width + 1)
      throw Error('Page horizontal overflow: ' + JSON.stringify(geometry));
    if (!geometry.toolbar || Math.abs(geometry.toolbar.height - 46) > 1.5)
      throw Error('Field toolbar not 46px: ' + JSON.stringify(geometry));
    if (
      !geometry.runbar ||
      geometry.runbar.right > width + 1 ||
      geometry.runbar.bottom > geometry.toolbar.bottom + 1
    )
      throw Error('Run controls clipped or wrapped: ' + JSON.stringify(geometry));
    if (geometry.cards.some((card) => card.artBottom > card.labelTop + 2))
      throw Error('Palette icon overlaps its title');
    evidenceData.push(geometry);
    if (width === 1728 || width === 1440 || width === 390)
      await page.screenshot({ path: join(evidence, 'field-' + width + '.png'), fullPage: false });
    if (mobile) await page.getByRole('button', { name: 'Закрыть каталог элементов' }).click();
    console.log('PASS field layout width=' + width + ': icons, labels, sidebar and 46px toolbar');
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'Электроника', exact: true }).click();
  const cards = page.locator('.robotics-schematic.editing .workbench-catalog-card');
  await expect(cards.first()).toBeVisible();
  const art = await cards.first().evaluate((card) => {
    const picture = card.querySelector('.workbench-catalog-art').getBoundingClientRect();
    const name = card.querySelector('.workbench-catalog-name').getBoundingClientRect();
    const content = card.querySelector(
      '.workbench-catalog-art .workbench-component-preview, .workbench-catalog-art .workbench-component-vector-preview, .workbench-catalog-art img',
    );
    const child = content?.getBoundingClientRect();
    return { picture: picture.toJSON(), label: name.toJSON(), content: child?.toJSON() };
  });
  if (art.picture.bottom > art.label.top + 2)
    throw Error('Electronics image area overlaps label: ' + JSON.stringify(art));
  if (
    art.content &&
    (art.content.width > art.picture.width + 2 || art.content.height > art.picture.height + 2)
  )
    throw Error('Electronics preview overflows: ' + JSON.stringify(art));
  const previewReport = await cards.evaluateAll((items) =>
    items.slice(0, 60).map((card) => {
      const picture = card.querySelector('.workbench-catalog-art')?.getBoundingClientRect();
      const label = card.querySelector('.workbench-catalog-name')?.getBoundingClientRect();
      const image = card
        .querySelector(
          '.workbench-catalog-art .workbench-component-preview, .workbench-catalog-art .workbench-component-vector-preview, .workbench-catalog-art img',
        )
        ?.getBoundingClientRect();
      return {
        name: card.querySelector('.workbench-catalog-name')?.textContent?.trim(),
        overlap: picture && label ? Math.max(0, picture.bottom - label.top) : 0,
        oversized: !!(
          picture &&
          image &&
          (image.width > picture.width + 2 || image.height > picture.height + 2)
        ),
      };
    }),
  );
  const invalidPreview = previewReport.filter((item) => item.overlap > 2 || item.oversized);
  if (invalidPreview.length)
    throw Error('Catalog previews do not fit: ' + JSON.stringify(invalidPreview));
  console.log('PASS ' + previewReport.length + ' electronics catalog previews fit their labels');
  await page.screenshot({ path: join(evidence, 'electronics-1440.png'), fullPage: false });
  for (const name of ['Робот', 'Электроника', 'Код']) {
    await page.getByRole('tab', { name, exact: true }).click();
    const selected =
      name === 'Робот'
        ? '.robotics-robot-toolbar'
        : name === 'Электроника'
          ? '.robotics-electronics-toolbar'
          : '.arduino-code-toolbar';
    const tool = page.locator(selected).filter({ visible: true }).first();
    await expect(tool).toBeVisible();
    const box = await tool.boundingBox();
    if (!box || Math.abs(box.height - 46) > 1.5)
      throw Error(
        'Not all toolbars share the same 46px height: ' + name + ' ' + JSON.stringify(box),
      );
  }
  console.log('PASS electronics preview fit and same toolbar height in all four sections');
  if (errors.length) throw Error('Browser JS errors ' + errors.join(' | '));
  if (projectWrites.length)
    throw Error('Unexpected project writes during UI-only actions: ' + projectWrites.join(' | '));
  writeFileSync(
    join(evidence, 'measurements.json'),
    JSON.stringify({ field: evidenceData, electronics: art }, null, 2) + '\n',
  );
  console.log('PASS no browser exceptions');
} catch (error) {
  console.error('FIELD_PALETTE_FAILED', String(error));
  await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
