#!/usr/bin/env node
// Tests persistence ONLY in the dedicated D2-R2 5m demo; leaves one useful "СТАРТ" label.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const local = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const url = readFileSync(join(local, 'arena-demo-v2.url'), 'utf8').trim();
const credentials = Object.fromEntries(
  readFileSync(join(local, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const origin = 'http://127.0.0.1:4630';
if (!url.startsWith(origin + '/#/home/') || !url.includes('module=robotics'))
  throw new Error('Refusing a project outside the private 5m demo');
const projectId = new URL(url).hash.match(/#\/home\/([^?]+)/)?.[1];
if (!projectId || url === credentials.URL)
  throw new Error('The old user demo must remain unchanged');
const out = join(process.cwd(), 'e2e/artifacts/robotics-5m-demo-008');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: origin,
  locale: 'ru-RU',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function documentOnServer() {
  const response = await page.request.get('/api/projects/' + projectId);
  if (!response.ok()) throw new Error('Demo project API GET failed: ' + response.status());
  const json = await response.json();
  if (!json.draft?.document?.world?.field) throw new Error('Demo project has no persisted field');
  return json.draft;
}
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home-header-actions').getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(credentials.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.PASSWORD);
  const challenge = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await challenge.isVisible()) {
    await challenge.press('Space');
    await expect(challenge).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25000 });
  const before = await documentOnServer();
  if (
    before.document.world.field.widthMeters !== 5 ||
    before.document.world.field.heightMeters !== 5
  )
    throw new Error('The dedicated arena project is not 5x5m');
  const firstRevision = before.revision;
  const beforeRobot = JSON.stringify(before.document.world.robot);
  const beforeCircuit = JSON.stringify(before.document.circuit);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 25000 });
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  const labels = page.locator('.robotics-field-canvas [data-object-kind="text"]');
  const existing = before.document.world.field.visuals?.find(
    (v) => v.kind === 'text' && v.text === 'СТАРТ',
  );
  if (!existing) {
    const count = await labels.count();
    await page
      .getByTestId('robotics-field-palette')
      .getByRole('button', { name: 'Текст', exact: true })
      .click();
    // The 5m SVG deliberately extends beyond its visible scroll container at 250%.
    // Use an onscreen pointer position, not the offscreen SVG world bounds.
    const viewport = await page.locator('.robotics-field-canvas').boundingBox();
    if (!viewport) throw new Error('No visible 5m canvas');
    await page.mouse.click(viewport.x + viewport.width * 0.65, viewport.y + viewport.height * 0.32);
    await expect(labels).toHaveCount(count + 1, { timeout: 6000 });
    const popup = page.getByRole('dialog', { name: 'Параметры выбранного объекта' });
    await expect(popup).toBeVisible();
    const input = popup.getByRole('textbox', { name: 'Надпись на поле' });
    await input.fill('СТАРТ');
    await input.press('Tab');
    await expect(labels.last()).toContainText('СТАРТ');
    const save = page.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(save).toHaveAttribute('data-save-state', 'dirty');
    await save.click();
    await expect(save).toHaveAttribute('data-save-state', 'saved', { timeout: 30000 });
  }
  const stored = await documentOnServer();
  if (!stored.document.world.field.visuals?.some((v) => v.kind === 'text' && v.text === 'СТАРТ'))
    throw new Error('Server did not persist the new text field object');
  if (JSON.stringify(stored.document.world.robot) !== beforeRobot)
    throw new Error('Robot dimensions changed while saving a field label');
  if (JSON.stringify(stored.document.circuit) !== beforeCircuit)
    throw new Error('The shared Electronics circuit changed while saving a field label');
  if (!existing && !(stored.revision > firstRevision))
    throw new Error('Save did not advance revision');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 25000 });
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  await expect(labels.filter({ hasText: 'СТАРТ' })).toHaveCount(1, { timeout: 10000 });
  await page.screenshot({ path: join(out, 'saved-reopened-5m-1440.png'), fullPage: false });
  const afterReload = await documentOnServer();
  if (afterReload.revision !== stored.revision)
    throw new Error('Reload caused an unexpected server save');
  if (errors.length) throw new Error('Browser JS errors: ' + errors.join(' | '));
  writeFileSync(
    join(out, 'save-reopen-report.json'),
    JSON.stringify(
      {
        projectId,
        beforeRevision: firstRevision,
        savedRevision: stored.revision,
        fieldMetres: [5, 5],
        label: 'СТАРТ',
        robotUnchanged: true,
        circuitUnchanged: true,
        reloadNoWrite: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS new 5m project: saved label "СТАРТ", persisted server revision, reloaded intact',
  );
  console.log('PASS robot & Electronics untouched; reload did not write');
  console.log('LOCAL_URL=' + url);
} catch (error) {
  console.error('SAVE_REOPEN_CHECK_FAILED', String(error));
  await page
    .screenshot({ path: join(out, 'save-reopen-failure.png'), fullPage: false })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
