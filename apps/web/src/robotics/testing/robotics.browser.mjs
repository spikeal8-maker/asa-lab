/* global document, console, URL, setTimeout, Node, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// Actual dev entry, production catalog and dedicated simulation Worker. This
// test deliberately has no project API, Arduino mock or fake simulation clock.
const origin = 'http://127.0.0.1:4612';
const output = resolve('reports/playwright/robotics');
await mkdir(output, { recursive: true });
const receipts = [];
const errors = [];
const forbiddenRequests = [];
let browser;
let page;
let server;

const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
async function until(label, read, accepts, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accepts(value)) return value;
    await delay(100);
  }
  throw new Error(`${label}: timed out, last observation ${JSON.stringify(value)}`);
}
async function attribute(testId, name) {
  const raw = await page.getByTestId(testId).getAttribute(name);
  assert.notEqual(raw, null, `${testId}.${name} must exist`);
  const value = Number(raw);
  assert.ok(Number.isFinite(value), `${testId}.${name} must be finite`);
  return value;
}
async function observation() {
  return {
    time: await attribute('robotics-time', 'data-microseconds'),
    x: await attribute('robotics-robot', 'data-x-meters'),
    y: await attribute('robotics-robot', 'data-y-meters'),
    heading: await attribute('robotics-robot', 'data-heading-radians'),
    leftRpm: await attribute('robotics-left-rpm', 'data-rpm'),
    rightRpm: await attribute('robotics-right-rpm', 'data-rpm'),
    distance: await attribute('robotics-distance', 'data-distance-meters'),
  };
}
async function pause() {
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await until(
    'pause is acknowledged',
    () => page.getByRole('button', { name: 'Продолжить', exact: true }).isEnabled(),
    Boolean,
  );
  const first = await observation();
  await delay(500);
  assert.deepEqual(await observation(), first, 'paused committed world must not advance');
  return first;
}

async function serialLayout(width, open) {
  const title = page.locator('.robotics-program .arduino-serial-title');
  if ((await title.getAttribute('aria-expanded')) !== String(open)) await title.click();
  await title.scrollIntoViewIfNeeded();
  const layout = await until(
    `full Serial heading and form fit at ${width}px, open=${open}`,
    () =>
      title.evaluate((element) => {
        const monitor = element.closest('.arduino-serial-monitor');
        const form = monitor?.querySelector('form');
        const buttonBounds = element.getBoundingClientRect();
        const monitorBounds = monitor?.getBoundingClientRect();
        const contains = (outer, inner) =>
          outer &&
          inner.left >= outer.left - 1 &&
          inner.right <= outer.right + 1 &&
          inner.top >= outer.top - 1 &&
          inner.bottom <= outer.bottom + 1;
        const textLines = [];
        for (const node of element.childNodes) {
          if (
            node.nodeType !== Node.TEXT_NODE ||
            !node.textContent.includes('Монитор последовательного интерфейса')
          )
            continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            textLines.push({
              height: rect.height,
              insideButton: contains(buttonBounds, rect),
              insideMonitor: contains(monitorBounds, rect),
            });
          }
        }
        const expanded = element.getAttribute('aria-expanded') === 'true';
        return {
          open: expanded,
          fontSize: getComputedStyle(element).fontSize,
          titleHeight: buttonBounds.height,
          monitorHeight: monitorBounds?.height,
          buttonFits: contains(monitorBounds, buttonBounds),
          textLines,
          formFits: !expanded || (form && contains(monitorBounds, form.getBoundingClientRect())),
        };
      }),
    (value) =>
      value.open === open &&
      value.buttonFits &&
      value.formFits &&
      value.textLines.length > 0 &&
      value.textLines.every((line) => line.insideButton && line.insideMonitor),
    3000,
  );
  receipts.push({ scenario: 'Serial title and form remain unclipped', width, ...layout });
}

try {
  server = await createServer({
    configFile: resolve('apps/web/vite.config.ts'),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 4612, strictPort: true, open: false },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(90_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) {
      forbiddenRequests.push(url.origin + url.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto(`${origin}/robotics-dev.html`, { waitUntil: 'networkidle' });
  await page.getByTestId('robotics-field').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Запустить', exact: true }).waitFor();
  assert.equal(await page.locator('.workbench-stage').count(), 1);
  const initial = await observation();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const moving = await until(
    'real Arduino drives real motor observations',
    observation,
    (value) => value.time >= 250_000 && value.x > initial.x + 0.01 && value.leftRpm > 0,
  );
  const paused = await pause();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const resumed = await until(
    'resume continues the same source time',
    observation,
    (value) => value.time > paused.time + 100_000,
  );
  const stoppedByProgram = await until(
    'sonar program removes drive and actual motor coast completes',
    observation,
    (value) =>
      value.time >= 2_000_000 &&
      value.distance < 0.6 &&
      value.distance > 0.02 &&
      Math.abs(value.leftRpm) < 8 &&
      Math.abs(value.rightRpm) < 8,
  );
  await pause();
  receipts.push({
    scenario: 'canonical movement, pause, resume, sonar and coast',
    initial,
    moving,
    paused,
    resumed,
    stoppedByProgram,
  });

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.content <= dimensions.viewport + 1, `page overflow at ${width}px`);
    for (const name of [
      'Продолжить',
      'Сбросить',
      'Программа',
      'Сохранить',
      'Открыть сохранённое',
    ]) {
      const button = page.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      assert.ok(await button.isVisible(), `${name} must be visible at ${width}px`);
      if (await button.isEnabled()) {
        await button.focus();
        assert.ok(
          await button.evaluate((element) => document.activeElement === element),
          `${name} must be focusable at ${width}px`,
        );
        assert.ok(
          await button.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            return hit === element || element.contains(hit);
          }),
          `${name} must not be covered at ${width}px`,
        );
      }
    }
    await page.getByTestId('robotics-field').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `robotics-${width}.png`), fullPage: true });
    receipts.push({ scenario: 'viewport', width, ...dimensions });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const beforeTurn = await observation();
  await page.getByRole('button', { name: 'Влево', exact: true }).click();
  const manualTurn = await until(
    'Serial turn remains available after automatic obstacle stop',
    observation,
    (value) => value.heading > beforeTurn.heading + 0.05 && value.rightRpm > value.leftRpm + 10,
  );
  await page.getByRole('button', { name: 'Выбег', exact: true }).click();
  const manualCoast = await until(
    'Serial S removes drive and keeps genuine coast',
    observation,
    (value) =>
      value.time > manualTurn.time + 100_000 &&
      Math.abs(value.leftRpm) < 8 &&
      Math.abs(value.rightRpm) < 8,
  );
  receipts.push({
    scenario: 'actual Serial steering after obstacle stop',
    beforeTurn,
    manualTurn,
    manualCoast,
  });
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  const reset = await observation();
  assert.equal(reset.time, 0);
  assert.equal(reset.x, initial.x);
  assert.equal(reset.y, initial.y);
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
  await editor.waitFor({ state: 'visible' });
  const originalSource = await editor.inputValue();
  assert.match(originalSource, /int\s+command\s*=\s*70\s*;/);
  const stoppedSource = originalSource.replace(/int\s+command\s*=\s*70\s*;/, 'int command = 83;');
  await editor.fill(stoppedSource);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('robotics-field').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Открыть сохранённое', exact: true }).click();
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await editor.waitFor({ state: 'visible' });
  assert.equal(
    await editor.inputValue(),
    stoppedSource,
    'local Save/Open retains actual Arduino source',
  );
  assert.equal(
    await page.locator('.workbench-stage').count(),
    1,
    'code never unmounts the native presentation barrier',
  );
  const downloadReady = page.waitForEvent('download');
  await page.getByTitle('Скачать .ino', { exact: true }).click();
  const downloaded = await downloadReady;
  assert.match(downloaded.suggestedFilename(), /\.ino$/);
  await downloaded.saveAs(resolve(output, 'robotics-example.ino'));
  assert.equal(await readFile(resolve(output, 'robotics-example.ino'), 'utf8'), stoppedSource);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await editor.scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => {
      const shell = document.querySelector('.robotics-program-shell')?.getBoundingClientRect();
      const panel = document
        .querySelector('.robotics-program-shell .arduino-code-panel')
        ?.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
        shellWidth: shell?.width,
        panelWidth: panel?.width,
      };
    });
    assert.ok(layout.content <= layout.viewport + 1, `program page overflow at ${width}px`);
    assert.ok(layout.panelWidth >= layout.shellWidth - 2, `unused program column at ${width}px`);
    assert.ok(await editor.isVisible(), `shared text editor visible at ${width}px`);
    await serialLayout(width, true);
    await serialLayout(width, false);
    await serialLayout(width, true);
    await page.screenshot({
      path: resolve(output, `robotics-program-${width}.png`),
      fullPage: true,
    });
    receipts.push({
      scenario: 'shared program viewport and no empty drawer column',
      width,
      ...layout,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const controlledStop = await until(
    'edited sketch runs without driving',
    observation,
    (value) => value.time >= 250_000,
  );
  assert.equal(controlledStop.x, initial.x);
  assert.equal(controlledStop.leftRpm, 0);
  assert.equal(controlledStop.rightRpm, 0);
  receipts.push({
    scenario: 'shared text editor changes actual motion and survives Save/Open',
    controlledStop,
  });
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();

  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await editor.fill('void setup() {}\nvoid loop() { unknownRoboticsCommand(); }\n');
  assert.equal(await editor.getAttribute('aria-invalid'), 'true');
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const runtimeError = await until(
    'unsupported Arduino source blocks Run with a specific error',
    () => page.getByTestId('robotics-notice').innerText(),
    (value) => /неподдерж|неизвест|ошиб|unsupported|unknown|invalid/i.test(value),
    30_000,
  );
  assert.equal((await observation()).x, initial.x, 'invalid sketch must not fabricate movement');
  receipts.push({ scenario: 'unsupported sketch fails visibly', message: runtimeError });

  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await editor.fill(originalSource);
  await page.locator('.arduino-mode-menu > summary').click();
  await page.getByRole('button', { name: 'Блоки', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Продолжить?', exact: true })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  const blockWorkspace = page.getByTestId('arduino-block-workspace').locator('svg.blocklySvg');
  await blockWorkspace.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('robotics-field').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await blockWorkspace.waitFor({ state: 'visible' });
  assert.equal((await page.locator('.arduino-mode-menu > summary').innerText()).trim(), 'Блоки');
  await blockWorkspace.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'robotics-blocks-1440.png'), fullPage: true });
  receipts.push({
    scenario: 'shared Blockly editor opens and its selected mode survives Save/reload',
  });

  await page.locator('.arduino-mode-menu > summary').click();
  await page.getByRole('button', { name: 'Текст', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Продолжить?', exact: true })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  await editor.fill(originalSource);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const recovered = await until(
    'valid source runs after an unsupported sketch and Blockly mode changes',
    observation,
    (value) => value.time >= 250_000 && value.x > initial.x + 0.01 && value.leftRpm > 0,
  );
  await pause();
  receipts.push({ scenario: 'valid source recovery uses the same engine', recovered });
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  assert.equal(await editor.inputValue(), originalSource);
  await page.locator('.robotics-program').screenshot({
    path: resolve(output, 'robotics-program-default-1440.png'),
  });
  assert.deepEqual(errors, [], 'no browser page errors');
  assert.deepEqual(forbiddenRequests, [], 'local robotics must not call API or external services');
  console.log(JSON.stringify({ result: 'PASS', receipts, output }, null, 2));
} catch (error) {
  if (page)
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    resolve(output, 'evidence.json'),
    JSON.stringify({ receipts, errors, forbiddenRequests }, null, 2) + '\n',
  );
  await browser?.close();
  await server?.close();
}
