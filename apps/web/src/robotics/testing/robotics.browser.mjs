/* global document, window, performance, URL, getComputedStyle, PointerEvent, setTimeout, console, localStorage */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// The real dev entry, catalog, Blockly and dedicated Worker run in one process.
// Test-only module access below uses Blockly's own public Workspace API; it never
// substitutes Arduino execution, host time, circuit results or robot movement.
const origin = 'http://127.0.0.1:4612';
const output = resolve('reports/playwright/robotics');
const storageKey = 'asa-lab:robotics:local-project:v1';
await mkdir(output, { recursive: true });
const receipts = [];
const errors = [];
const forbiddenRequests = [];
let browser;
let page;
let server;
let nextDialogAccepted = true;
let lastDialogMessage = '';
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const record = (scenario, details = {}) => {
  receipts.push({ scenario, ...details });
  console.log(`PASS ${scenario}`);
};
async function until(label, read, accepts, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accepts(last)) return last;
    await delay(100);
  }
  throw new Error(`${label}: timed out: ${JSON.stringify(last)}`);
}
async function nav(name) {
  await page.getByRole('tab', { name, exact: true }).click();
}
async function attr(testId, name) {
  const raw = await page.getByTestId(testId).getAttribute(name);
  assert.notEqual(raw, null, `${testId}.${name}`);
  const value = Number(raw);
  assert.ok(Number.isFinite(value), `${testId}.${name}`);
  return value;
}
async function observation() {
  return {
    time: await attr('robotics-time', 'data-microseconds'),
    x: await attr('robotics-robot', 'data-x-meters'),
    y: await attr('robotics-robot', 'data-y-meters'),
    heading: await attr('robotics-robot', 'data-heading-radians'),
    leftRpm: await attr('robotics-left-rpm', 'data-rpm'),
    rightRpm: await attr('robotics-right-rpm', 'data-rpm'),
    distance: await attr('robotics-distance', 'data-distance-meters'),
  };
}
async function pause() {
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await until(
    'acknowledged pause',
    () => page.getByRole('button', { name: 'Продолжить', exact: true }).isEnabled(),
    Boolean,
  );
  const before = await observation();
  await delay(400);
  assert.deepEqual(await observation(), before);
  return before;
}
async function save() {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
}
async function numberField(label, value) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
}
async function preset(id) {
  await nav('Программа');
  await page.getByRole('combobox', { name: 'Пример программы', exact: true }).selectOption(id);
}
async function bindBlockly() {
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/scratch-blocks.js'))?.name;
    if (!url) throw new Error('Actual ScratchBlocks module was not loaded');
    const module = await import(url);
    window.roboticsTestBlockly = module.common ? module : module.default;
  });
}
async function blockGraph() {
  return page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    const workspace = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    return JSON.stringify(S.serialization.workspaces.save(workspace));
  });
}
async function blockHistory() {
  return page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    const workspace = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    return JSON.stringify({
      undo: workspace.getUndoStack().map((event) => event.toJson()),
      redo: workspace.getRedoStack().map((event) => event.toJson()),
    });
  });
}
async function programView() {
  return page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    const w = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    const root = w.getTopBlocks(true)[0].getSvgRoot();
    const first = root.getBoundingClientRect();
    const host = w.getInjectionDiv();
    const bounds = host.getBoundingClientRect();
    const clip = {
      left: Math.max(0, bounds.left + (w.getFlyout()?.getWidth() ?? 0)),
      top: Math.max(0, bounds.top),
      right: Math.min(window.innerWidth, bounds.right),
      bottom: Math.min(window.innerHeight, bounds.bottom),
    };
    for (let ancestor = host.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const rect = ancestor.getBoundingClientRect();
      if (style.overflowX !== 'visible') {
        clip.left = Math.max(clip.left, rect.left);
        clip.right = Math.min(clip.right, rect.right);
      }
      if (style.overflowY !== 'visible') {
        clip.top = Math.max(clip.top, rect.top);
        clip.bottom = Math.min(clip.bottom, rect.bottom);
      }
    }
    return { first: first.toJSON(), clip, scrollX: w.scrollX, scrollY: w.scrollY, scale: w.scale };
  });
}
async function visibleProgramStart(label) {
  const view = await programView();
  assert.ok(
    view.first.left >= view.clip.left - 1,
    `${label}: left edge is clipped: ${JSON.stringify(view)}`,
  );
  assert.ok(view.first.left < view.clip.right - 40, `${label}: start is beyond viewport`);
  assert.ok(
    view.first.top >= view.clip.top - 1 && view.first.top < view.clip.bottom - 30,
    `${label}: top edge is clipped: ${JSON.stringify(view)}`,
  );
  return view;
}
function savedProgram(project, boardId = 'uno') {
  const properties = project.circuit.components.find((part) => part.id === boardId).stateProperties;
  return { source: properties.arduinoSource, workspace: properties.arduinoWorkspace };
}
async function workspaceIdentity() {
  return page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    const workspace = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    return { id: workspace.id, scale: workspace.scale };
  });
}
async function editThreshold(value) {
  await page.evaluate((next) => {
    const S = window.roboticsTestBlockly;
    const workspace = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    const assignment = workspace
      .getAllBlocks(false)
      .find(
        (block) =>
          block.type === 'asa_var_set' && block.getField('NAME')?.getText() === 'safeStopEchoUs',
      );
    if (!assignment) throw new Error('The robot threshold assignment must be editable');
    assignment.getInputTargetBlock('VALUE').setFieldValue(String(next), 'VALUE');
  }, value);
}
async function verifyProgramHistory() {
  await nav('Программа');
  await bindBlockly();
  const original = savedProgram(await save());
  assert.match(original.source, /safeStopEchoUs\s*=\s*3480/);
  const oldWorkspace = await workspaceIdentity();
  await editThreshold(3700);
  const edited = savedProgram(await save());
  assert.match(edited.source, /safeStopEchoUs\s*=\s*3700/);
  await nav('Электроника');
  const keys = [];
  for (const [key, expected, redo] of [
    ['Control+z', original, true],
    ['Control+y', edited, false],
    ['Control+z', original, true],
    ['Control+Shift+z', edited, false],
    ['Control+z', original, true],
  ]) {
    await page.keyboard.press(key);
    assert.deepEqual(savedProgram(await save()), expected, `${key}: immediate Save`);
    assert.equal(await blockGraph(), expected.workspace, `${key}: live hidden workspace`);
    assert.equal(
      await page.getByRole('button', { name: 'Повторить', exact: true }).isEnabled(),
      redo,
      `${key}: Save preserves the history branch`,
    );
    await delay(220);
    assert.deepEqual(savedProgram(await save()), expected, `${key}: after old debounce`);
    keys.push({ key, threshold: expected === original ? 3480 : 3700, redo });
  }
  const restoredWorkspace = await workspaceIdentity();
  assert.notEqual(restoredWorkspace.id, oldWorkspace.id);
  const graphBeforeReveal = await blockGraph();
  await nav('Программа');
  await delay(180);
  const restoredView = await visibleProgramStart('restored hidden program');
  assert.equal(restoredView.scale, restoredWorkspace.scale, 'revealing never changes zoom');
  assert.equal(await blockGraph(), graphBeforeReveal, 'revealing never edits the restored graph');

  // A pending block publication must enter history before its immediate Undo.
  await editThreshold(3800);
  await nav('Электроника');
  await page.keyboard.press('Control+z');
  assert.deepEqual(savedProgram(await save()), original);
  await delay(220);
  assert.deepEqual(savedProgram(await save()), original);
  assert.equal(await blockGraph(), original.workspace);
  assert.equal(
    await page.getByRole('button', { name: 'Повторить', exact: true }).isEnabled(),
    true,
  );
  await nav('Программа');
  await delay(180);
  await visibleProgramStart('pending edit restored after keyboard Undo');

  const beforeField = await save();
  const preservedWorkspace = await workspaceIdentity();
  const view = await programView();
  await page.mouse.move(view.clip.right - 25, view.clip.top + 90);
  await page.mouse.wheel(0, 120);
  await delay(100);
  const panned = await programView();
  await nav('Поле');
  if (!(await page.getByRole('spinbutton', { name: 'Шаг сетки', exact: true }).isVisible()))
    await page.getByText('Размеры и учебная сцена', { exact: true }).click();
  await numberField('Шаг сетки', 0.12);
  await nav('Электроника');
  await page.keyboard.press('Control+z');
  assert.deepEqual((await save()).world, beforeField.world);
  assert.deepEqual(
    await workspaceIdentity(),
    preservedWorkspace,
    'field Undo keeps the live editor',
  );
  await nav('Программа');
  await delay(100);
  const afterField = await programView();
  assert.equal(afterField.scrollX, panned.scrollX);
  assert.equal(afterField.scrollY, panned.scrollY);
  assert.equal(await blockGraph(), original.workspace);
  await page.getByRole('button', { name: 'К началу', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await delay(180);
  await editThreshold(3900);
  await nav('Электроника');
  await page.keyboard.press('Control+z');
  assert.deepEqual(savedProgram(await save()), original);
  const mobileRestored = await workspaceIdentity();
  const mobileGraph = await blockGraph();
  await nav('Программа');
  await delay(180);
  const mobileView = await visibleProgramStart('restored hidden program on mobile');
  assert.equal(mobileView.scale, mobileRestored.scale);
  assert.equal(await blockGraph(), mobileGraph);
  await page.screenshot({
    path: resolve(output, 'robotics-history-restored-390.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await delay(180);
  record(
    'keyboard program Undo/Redo keeps source, live graph, Save and Redo aligned; field history preserves editor and pan',
    {
      keys,
      oldWorkspace,
      restoredWorkspace,
      restoredView,
      preservedWorkspace,
      mobileView,
    },
  );
}
async function verifyPresetTarget() {
  const before = await save();
  const boundId = before.world.bindings.boardId;
  await nav('Электроника');
  const uno = page.locator(`.workbench-canvas [data-component-id="${boundId}"] > .workbench-part`);
  await uno.focus();
  await uno.press('Enter');
  await page.keyboard.press('Control+d');
  const duplicated = await save();
  const second = duplicated.circuit.components.find(
    (part) => part.componentTypeId === 'arduino-uno' && part.id !== boundId,
  );
  assert.ok(second, 'the common Duplicate command adds a second real Uno');
  await nav('Программа');
  const boardSelector = page.getByRole('combobox', { name: 'Программируемая плата', exact: true });
  await boardSelector.selectOption(second.id);
  await bindBlockly();
  await editThreshold(3910);
  nextDialogAccepted = false;
  await page
    .getByRole('combobox', { name: 'Пример программы', exact: true })
    .selectOption('push-one-shot');
  assert.ok(lastDialogMessage.includes(`(${boundId})`), 'confirmation identifies the bound Uno');
  const cancelled = await save();
  assert.equal(
    await boardSelector.inputValue(),
    second.id,
    'Cancel keeps the displayed second Uno',
  );
  assert.deepEqual(savedProgram(cancelled, boundId), savedProgram(duplicated, boundId));
  assert.match(savedProgram(cancelled, second.id).source, /safeStopEchoUs\s*=\s*3910/);
  await editThreshold(3920);
  await page
    .getByRole('combobox', { name: 'Пример программы', exact: true })
    .selectOption('push-one-shot');
  assert.ok(lastDialogMessage.includes(`(${boundId})`));
  assert.equal(
    await boardSelector.inputValue(),
    boundId,
    'confirmed example opens its actual target',
  );
  const confirmed = await save();
  assert.match(savedProgram(confirmed, boundId).source, /delay\(800\)/);
  assert.match(savedProgram(confirmed, second.id).source, /safeStopEchoUs\s*=\s*3920/);
  assert.equal(await blockGraph(), savedProgram(confirmed, boundId).workspace);
  await delay(220);
  const settled = await save();
  assert.deepEqual(savedProgram(settled, boundId), savedProgram(confirmed, boundId));
  assert.deepEqual(savedProgram(settled, second.id), savedProgram(confirmed, second.id));
  await page.screenshot({
    path: resolve(output, 'robotics-preset-target-1440.png'),
    fullPage: true,
  });
  record(
    'robot example names and opens its bound Uno; Cancel and replacement preserve the other pending sketch',
    {
      boundId,
      secondId: second.id,
      confirmation: lastDialogMessage,
    },
  );
  // Return the journey to one bound board through the same public UI.
  await nav('Электроника');
  const duplicate = page.locator(
    `.workbench-canvas [data-component-id="${second.id}"] > .workbench-part`,
  );
  await duplicate.focus();
  await duplicate.press('Enter');
  await page
    .locator('#robotics-panel-electronics')
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await preset('safe-rover');
  assert.equal((await save()).circuit.components.length, before.circuit.components.length);
}
async function dragObject(id, dx, dy, cancel = false) {
  const selected = page.locator(`#robotics-panel-field [data-scene-key="${id}"]`);
  const box = await selected.boundingBox();
  assert.ok(box);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  if (cancel)
    await page
      .getByTestId('robotics-field')
      .evaluate((svg) =>
        svg.dispatchEvent(
          new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, isPrimary: true }),
        ),
      );
  await page.mouse.up();
}
async function visibleSchemeLanding() {
  return page.locator('.workbench-canvas').evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    for (const y of [0.8, 0.6, 0.9, 0.4]) {
      for (const x of [0.85, 0.65, 0.45, 0.25]) {
        const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
        const target = document.elementFromPoint(point.x, point.y);
        if (
          target &&
          svg.contains(target) &&
          !target.closest('[data-component-id], [data-wire-id]')
        )
          return point;
      }
    }
    throw new Error('No visible scheme landing point outside controls');
  });
}
async function viewport(width, height, section) {
  await page.setViewportSize({ width, height });
  await nav(section);
  await delay(150);
  const layout = await page.evaluate(() => {
    const bounds = document.querySelector('.workbench-canvas')?.getBoundingClientRect();
    const active = document
      .querySelector('[role="tabpanel"]:not([hidden])')
      ?.getBoundingClientRect();
    const header = document.querySelector('.robotics-unified-header');
    const headerBounds = header?.getBoundingClientRect();
    const tabs = [...(header?.querySelectorAll('[role="tab"]') ?? [])];
    const save = header?.querySelector('.robotics-header-save');
    const saveBounds = save?.getBoundingClientRect();
    const tabBounds = tabs.map((tab) => tab.getBoundingClientRect());
    return {
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      stage: bounds?.toJSON(),
      active: active?.toJSON(),
      header: {
        count: document.querySelectorAll('.robotics-lab > header').length,
        top: headerBounds?.top,
        height: headerBounds?.height,
        background: header ? getComputedStyle(header).backgroundColor : null,
        tabCount: tabs.length,
        allIconTabs: tabs.every((tab) => tab.querySelector('svg') !== null),
        sameRow: tabBounds.every(
          (box) => box.top >= headerBounds.top && box.bottom <= headerBounds.bottom,
        ),
        tabSeparatedFromSave: tabBounds.every((box) => box.right <= saveBounds.left + 1),
        saveLast: save === header?.querySelector('.robotics-header-controls')?.lastElementChild,
        saveVisible: Boolean(
          saveBounds &&
          saveBounds.width > 0 &&
          saveBounds.left >= 0 &&
          saveBounds.right <= window.innerWidth + 1,
        ),
        saveLabel: save?.getAttribute('aria-label'),
        saveTop: saveBounds?.top,
        saveBottom: saveBounds?.bottom,
      },
      oneStage: document.querySelectorAll('.workbench-canvas').length === 1,
      sameStage: window.roboticsMountedStage === document.querySelector('.workbench-canvas'),
      hiddenFocus: Boolean(document.activeElement?.closest('[hidden], [inert]')),
    };
  });
  assert.ok(layout.scrollWidth <= width + 1, `${section} horizontal overflow at ${width}`);
  assert.equal(layout.header.count, 1, 'one top-level header');
  assert.ok(
    layout.header.top >= -1 && layout.header.top <= 1,
    'header touches the application top',
  );
  assert.equal(layout.header.height, 48, 'same 48px as Electronics');
  assert.equal(layout.header.background, 'rgb(255, 255, 255)', 'Electronics white surface');
  assert.equal(layout.header.tabCount, 4, 'all four tabs inside the only header');
  assert.equal(layout.header.allIconTabs, true, 'every tab has an icon');
  assert.equal(layout.header.sameRow, true, 'four tabs remain in the header row');
  assert.equal(layout.header.tabSeparatedFromSave, true, 'Save cannot overlap any tab');
  assert.equal(layout.header.saveLast, true, 'Save is the final header action');
  assert.equal(layout.header.saveVisible, true, 'Save remains visible at every width');
  assert.equal(layout.header.saveLabel, 'Сохранить');
  assert.ok(layout.header.saveTop >= -1 && layout.header.saveBottom <= 49);
  assert.ok(layout.oneStage && layout.sameStage, 'one mounted stage through all sections');
  assert.ok(layout.stage.width > 90 && layout.stage.height > 65, 'real stage has a visible size');
  assert.ok(layout.active.width > 250);
  // The electronics tab owns the persistent scheme region via aria-owns;
  // its toolbar and the actual Stage occupy adjacent rows of the same editor.
  assert.ok(section === 'Электроника' ? layout.stage.height > 180 : layout.active.height > 180);
  assert.equal(layout.hiddenFocus, false);
  const file = { Поле: 'field', Робот: 'robot', Электроника: 'electronics', Программа: 'program' }[
    section
  ];
  await page.screenshot({ path: resolve(output, `robotics-${file}-${width}.png`), fullPage: true });
  record('four-section viewport', { section, width, ...layout });
  if (section === 'Программа')
    await visibleProgramStart(`program after four-tab navigation at ${width}`);
  if (section === 'Робот') {
    assert.equal(
      await page
        .locator(
          '#robotics-panel-robot [data-ball-id], #robotics-panel-robot [data-obstacle-id], #robotics-panel-robot .robotics-field-dimension, #robotics-panel-robot .robotics-start-marker',
        )
        .count(),
      0,
    );
  }
  if (section === 'Электроника' && width === 320) {
    assert.equal(
      await page
        .getByRole('button', { name: 'Компоненты', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    );
    const before = await save();
    await page.getByRole('button', { name: 'Компоненты', exact: true }).click();
    await page.getByRole('button', { name: 'Резистор', exact: true }).tap();
    await page.locator('.workbench-library.collapsed').waitFor();
    await page.locator('.workbench-placement').waitFor();
    const landing = await visibleSchemeLanding();
    await page.touchscreen.tap(landing.x, landing.y);
    assert.equal((await save()).circuit.components.length, before.circuit.components.length + 1);
    await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
    await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
    await page.screenshot({
      path: resolve(output, 'robotics-electronics-add-320.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    assert.deepEqual((await save()).circuit, before.circuit);
    await nav('Робот');
    await page.getByRole('button', { name: 'Добавить компонент', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Компоненты', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.getByRole('button', { name: 'Компоненты', exact: true }).click();
    record(
      'mobile scheme opens collapsed, adds from real catalog, restores canvas, zooms and undoes',
    );
  }
  if (width === 390 && section === 'Поле') {
    const source = await save();
    const ball = source.world.field.balls[0];
    const properties = page.getByRole('button', { name: 'Свойства', exact: true });
    if ((await properties.getAttribute('aria-expanded')) !== 'true') await properties.click();
    await page
      .locator('.robotics-object-list')
      .getByRole('button', { name: new RegExp(ball.id) })
      .click();
    const input = page.getByRole('spinbutton', { name: 'Y мяча', exact: true });
    await input.scrollIntoViewIfNeeded();
    const visible = await input.boundingBox();
    assert.ok(visible.x >= 0 && visible.x + visible.width <= width);
    const nextY = Number((ball.yMeters + 0.05).toFixed(4));
    await numberField('Y мяча', nextY);
    assert.equal((await save()).world.field.balls[0].yMeters, nextY);
    await page.screenshot({
      path: resolve(output, 'robotics-field-properties-390.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    assert.deepEqual((await save()).world, source.world);
    await properties.click();
    record('mobile visible properties edit and Undo', { width, input: visible });
  }
}

try {
  server = await createServer({
    configFile: resolve('apps/web/vite.config.ts'),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 4612, strictPort: true, open: false },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(90_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => {
    lastDialogMessage = dialog.message();
    const accept = nextDialogAccepted;
    nextDialogAccepted = true;
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) {
      forbiddenRequests.push(url.origin + url.pathname);
      await route.abort();
    } else await route.continue();
  });
  await page.goto(`${origin}/robotics-dev.html`, { waitUntil: 'networkidle' });
  await page.getByTestId('robotics-field').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.roboticsMountedStage = document.querySelector('.workbench-canvas');
  });
  const initialProject = await save();
  assert.equal(initialProject.schemaVersion, 3);
  assert.equal(
    initialProject.circuit.components.find((part) => part.id === 'uno').stateProperties
      .arduinoCodeMode,
    'blocks',
  );
  const initial = await observation();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const moving = await until(
    'actual motor motion',
    observation,
    (value) => value.time >= 200_000 && value.x > initial.x + 0.01 && value.leftRpm > 0,
  );
  await nav('Электроника');
  assert.equal(
    await page.getByRole('button', { name: 'Компоненты', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.locator('.workbench-library').evaluate((element) => element.inert), true);
  const paused = await pause();
  await nav('Программа');
  await page.getByTestId('arduino-block-workspace').waitFor();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const resumed = await until(
    'same run across sections',
    observation,
    (value) => value.time > paused.time + 100_000 && value.x >= paused.x,
  );
  await nav('Поле');
  const stoppedByProgram = await until(
    'safe sketch sees obstacle and completes motor coast',
    observation,
    (value) =>
      value.time >= 2_000_000 &&
      value.distance < 0.6 &&
      value.distance > 0.02 &&
      Math.abs(value.leftRpm) < 8 &&
      Math.abs(value.rightRpm) < 8,
  );
  const beforeTurn = await observation();
  await page.getByRole('button', { name: 'Влево', exact: true }).click();
  const turned = await until(
    'Serial steering changes real motor outputs',
    observation,
    (value) => value.heading > beforeTurn.heading + 0.04 && value.rightRpm > value.leftRpm + 10,
  );
  await page.getByRole('button', { name: 'Выбег', exact: true }).click();
  await pause();
  record('canonical program, sonar, Serial, pause and mounted navigation', {
    initial,
    moving,
    paused,
    resumed,
    stoppedByProgram,
    turned,
  });
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  assert.equal((await observation()).x, initial.x);

  await nav('Электроника');
  await page.getByRole('button', { name: 'Резистор', exact: true }).focus();
  await page.getByRole('button', { name: 'Резистор', exact: true }).press('Enter');
  const stage = await page.locator('.workbench-canvas').boundingBox();
  await page.mouse.click(stage.x + stage.width * 0.55, stage.y + stage.height * 0.8);
  const withComponent = await save();
  assert.equal(
    withComponent.circuit.components.length,
    initialProject.circuit.components.length + 1,
  );
  assert.deepEqual(withComponent.world.bindings, initialProject.world.bindings);
  await page
    .locator('#robotics-panel-electronics')
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  assert.equal((await save()).circuit.components.length, initialProject.circuit.components.length);
  record('shared catalog adds a real unbound component and inspector deletion works');

  // A non-editing preview must reject both pointer input and electronics hotkeys.
  const leftMotor = page.locator(
    '.workbench-canvas [data-component-id="left-motor"] > .workbench-part',
  );
  await leftMotor.focus();
  await leftMotor.press('Enter');
  await nav('Поле');
  const previewBefore = await save();
  const preview = await page.locator('.workbench-canvas').boundingBox();
  await page.mouse.click(preview.x + preview.width / 2, preview.y + preview.height / 2);
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+v');
  assert.deepEqual((await save()).circuit, previewBefore.circuit);
  record('read-only compact scheme ignores pointer and global keyboard edits');

  await nav('Электроника');
  await leftMotor.focus();
  await leftMotor.press('Enter');
  await page
    .locator('#robotics-panel-electronics')
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  const missingMotor = await save();
  assert.equal(missingMotor.world.bindings.leftMotorId, 'left-motor');
  assert.equal(
    missingMotor.circuit.components.some((part) => part.id === 'left-motor'),
    false,
  );
  await nav('Робот');
  const missingBinding = page.getByRole('combobox', { name: 'Левый мотор', exact: true });
  assert.equal(await missingBinding.inputValue(), 'left-motor');
  assert.match(await missingBinding.locator('option:checked').innerText(), /Не найден/);
  assert.equal(
    await page.getByRole('button', { name: 'Запустить', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  assert.deepEqual((await save()).circuit, previewBefore.circuit);
  record('deleted bound component stays explicitly missing until Undo; no automatic rebinding');

  await nav('Программа');
  await bindBlockly();
  const immediateSave = await page.evaluate((key) => {
    const S = window.roboticsTestBlockly;
    const workspace = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    const number = workspace
      .getAllBlocks(false)
      .find(
        (block) => block.type === 'asa_number' && String(block.getFieldValue('VALUE')) === '3480',
      );
    if (!number) throw new Error('Real threshold block missing');
    const start = performance.now();
    number.setFieldValue('3600', 'VALUE');
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Сохранить')
      .click();
    const elapsedMs = performance.now() - start;
    const saved = JSON.parse(localStorage.getItem(key));
    return {
      elapsedMs,
      source: saved.circuit.components.find((part) => part.id === 'uno').stateProperties
        .arduinoSource,
    };
  }, storageKey);
  assert.ok(
    immediateSave.elapsedMs < 180,
    `Save must be inside debounce, measured ${immediateSave.elapsedMs}ms`,
  );
  assert.match(immediateSave.source, /safeStopEchoUs\s*=\s*3600/);
  const immediateRun = await page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    const workspace = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    const assign = workspace
      .getAllBlocks(false)
      .find(
        (block) => block.type === 'asa_var_set' && block.getField('NAME')?.getText() === 'command',
      );
    const start = performance.now();
    assign.getInputTargetBlock('VALUE').setFieldValue('83', 'VALUE');
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Запустить')
      .click();
    return { elapsedMs: performance.now() - start };
  });
  assert.ok(immediateRun.elapsedMs < 180);
  const stoppedRun = await until(
    'immediate Run sees edited initial S command',
    observation,
    (value) => value.time >= 250_000,
  );
  assert.equal(stoppedRun.x, initial.x);
  assert.equal(stoppedRun.leftRpm, 0);
  assert.equal(stoppedRun.rightRpm, 0);
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  record('actual block edits reach Save and Run before the 180ms debounce', {
    immediateSave,
    immediateRun,
    stoppedRun,
  });

  const graphBeforeHide = await blockGraph();
  await page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    S.Workspace.getAll()
      .find((entry) => entry.rendered && !entry.isFlyout)
      .getTopBlocks(false)[0]
      .select();
  });
  await nav('Поле');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await delay(250);
  assert.equal(await blockGraph(), graphBeforeHide);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'robotics-tab-field');
  record('selected hidden Blockly graph ignores Delete and Ctrl+Z');

  // Source replacement must clear the old publication timer; cancellation keeps the edit.
  await nav('Программа');
  await page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    const w = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    w.getAllBlocks(false)
      .find(
        (block) => block.type === 'asa_number' && String(block.getFieldValue('VALUE')) === '3600',
      )
      .setFieldValue('3700', 'VALUE');
  });
  nextDialogAccepted = false;
  await page
    .getByRole('combobox', { name: 'Пример программы', exact: true })
    .selectOption('push-one-shot');
  const afterCancel = await save();
  assert.match(
    afterCancel.circuit.components.find((part) => part.id === 'uno').stateProperties.arduinoSource,
    /safeStopEchoUs\s*=\s*3700/,
  );
  await page.evaluate(() => {
    const S = window.roboticsTestBlockly;
    const w = S.Workspace.getAll().find((entry) => entry.rendered && !entry.isFlyout);
    w.getAllBlocks(false)
      .find(
        (block) => block.type === 'asa_number' && String(block.getFieldValue('VALUE')) === '3700',
      )
      .setFieldValue('3800', 'VALUE');
  });
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await delay(300);
  assert.match(
    (await save()).circuit.components.find((part) => part.id === 'uno').stateProperties
      .arduinoSource,
    /safeStopEchoUs\s*=\s*3700/,
  );
  const beforePreset = await save();
  await preset('safe-rover');
  await delay(300);
  const afterPreset = await save();
  assert.deepEqual(afterPreset.world, beforePreset.world);
  assert.deepEqual(afterPreset.circuit.connections, beforePreset.circuit.connections);
  assert.match(
    afterPreset.circuit.components.find((part) => part.id === 'uno').stateProperties.arduinoSource,
    /safeStopEchoUs\s*=\s*3480/,
  );
  record(
    'cancelled preset preserves pending edit; confirmed Open and preset cannot revive old debounce',
  );
  await verifyProgramHistory();
  await verifyPresetTarget();

  await nav('Поле');
  const sceneBefore = await save();
  for (const name of ['Стена', 'Мяч', 'Линия', 'Зона']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Добавить в свободное место', exact: true }).click();
  }
  const added = await save();
  assert.equal(added.world.field.obstacles.length, sceneBefore.world.field.obstacles.length + 1);
  assert.equal(added.world.field.balls.length, 1);
  assert.equal(added.world.field.floorMarks.length, 2);
  assert.deepEqual(added.circuit.connections, sceneBefore.circuit.connections);
  assert.deepEqual(
    added.circuit.components.find((part) => part.id === 'uno'),
    sceneBefore.circuit.components.find((part) => part.id === 'uno'),
  );
  assert.deepEqual(added.world.bindings, sceneBefore.world.bindings);
  const ballId = added.world.field.balls[0].id;
  await page
    .locator('.robotics-object-list')
    .getByRole('button', { name: new RegExp(ballId) })
    .click();
  const beforeDrag = await save();
  await dragObject(`ball:${ballId}`, 20, -15);
  const afterDrag = await save();
  assert.notDeepEqual(afterDrag.world.field.balls[0], beforeDrag.world.field.balls[0]);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  assert.deepEqual((await save()).world, beforeDrag.world, 'one complete drag is exactly one Undo');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  assert.deepEqual((await save()).world, afterDrag.world);
  await dragObject(`ball:${ballId}`, -18, 13, true);
  assert.deepEqual((await save()).world, afterDrag.world, 'cancelled drag never changes source');
  await numberField('Ширина поля', 0.8);
  assert.equal(
    await page
      .getByRole('spinbutton', { name: 'Ширина поля', exact: true })
      .getAttribute('aria-invalid'),
    'true',
  );
  assert.deepEqual((await save()).world, afterDrag.world, 'invalid shrink never relocates objects');
  await page
    .getByRole('spinbutton', { name: 'Ширина поля', exact: true })
    .fill(String(afterDrag.world.field.widthMeters));
  await page.getByRole('spinbutton', { name: 'Ширина поля', exact: true }).press('Tab');
  record('scene has all object types, finite numeric validation and one-step drag history', {
    ballId,
  });

  await nav('Робот');
  const bindingBefore = (await save()).world.bindings;
  await page.getByRole('button', { name: 'Поменять моторы местами', exact: true }).click();
  const swapped = (await save()).world.bindings;
  assert.equal(swapped.leftMotorId, bindingBefore.rightMotorId);
  assert.equal(swapped.rightMotorId, bindingBefore.leftMotorId);
  await page.getByRole('button', { name: 'Поменять моторы местами', exact: true }).click();
  await numberField('Датчик: вперёд от центра', 0);
  await numberField('Датчик: влево от центра', 100);
  await numberField('Направление датчика', 90);
  await nav('Поле');
  await page
    .locator('.robotics-object-list')
    .getByRole('button', { name: new RegExp(ballId) })
    .click();
  await numberField('X мяча', 0.5);
  await numberField('Y мяча', 0.9);
  // Remove the added wall from the straight push corridor, using the real editor.
  const extraWall = added.world.field.obstacles.at(-1).id;
  await page
    .locator('.robotics-object-list')
    .getByRole('button', { name: new RegExp(extraWall) })
    .click();
  await page.getByRole('button', { name: 'Удалить предмет', exact: true }).click();
  const pushSource = await save();
  await preset('push-one-shot');
  assert.deepEqual((await save()).world, pushSource.world);
  await nav('Поле');
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const ballObservation = async () => {
    const robot = await observation();
    const ball = await page
      .locator(`#robotics-panel-field [data-ball-id="${ballId}"]`)
      .evaluate((element) => ({
        x: Number(element.getAttribute('data-x-meters')),
        y: Number(element.getAttribute('data-y-meters')),
        vx: Number(element.getAttribute('data-velocity-x')),
        vy: Number(element.getAttribute('data-velocity-y')),
      }));
    return { ...robot, ball };
  };
  const pushed = await until(
    'actual GPIO impulse pushes dynamic ball',
    ballObservation,
    (value) => value.ball.x > 0.515 && value.ball.vx > 0,
  );
  const free = await until(
    'ball continues freely after one-shot power ends',
    ballObservation,
    (value) =>
      value.time > 850_000 && value.ball.vx > 0.005 && value.ball.x - 0.06 > value.x + 0.1 + 0.003,
  );
  await pause();
  await page.screenshot({
    path: resolve(output, 'robotics-field-pushed-1440.png'),
    fullPage: true,
  });
  const pausedBall = await ballObservation();
  await delay(300);
  assert.deepEqual(await ballObservation(), pausedBall);
  assert.equal(await page.getByRole('button', { name: 'Мяч', exact: true }).isDisabled(), true);
  const savedWhileMoving = await save();
  assert.deepEqual(
    savedWhileMoving.world,
    pushSource.world,
    'runtime positions never replace source',
  );
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  const resetBall = await ballObservation();
  assert.equal(resetBall.time, 0);
  assert.equal(resetBall.x, pushSource.world.initialPose.xMeters);
  assert.equal(resetBall.ball.x, 0.5);
  assert.equal(resetBall.ball.vx, 0);
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await until('restart after paused Reset', ballObservation, (value) => value.ball.x > 0.515);
  await pause();
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  const stoppedBall = await ballObservation();
  assert.equal(stoppedBall.ball.x, 0.5);
  assert.equal(stoppedBall.x, pushSource.world.initialPose.xMeters);
  const stoppedSource = await save();
  await dragObject(`ball:${ballId}`, 18, -12);
  assert.notDeepEqual((await save()).world.field.balls[0], stoppedSource.world.field.balls[0]);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  assert.deepEqual((await save()).world, stoppedSource.world);
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await until('restart after paused Stop', ballObservation, (value) => value.ball.x > 0.515);
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  record('real motor impulse, dynamic push, free movement, pause, source Save and Reset', {
    pushed,
    free,
    resetBall,
  });

  await preset('safe-rover');
  await bindBlockly();
  const layoutGraph = await blockGraph();
  const layoutProject = await save();
  const layoutHistory = await blockHistory();
  const beforePan = await programView();
  await page.mouse.move(beforePan.clip.right - 25, beforePan.clip.top + 100);
  await page.mouse.wheel(0, 140);
  await delay(120);
  const panned = await programView();
  assert.notEqual(panned.scrollY, beforePan.scrollY, 'the actual Blockly canvas can scroll');
  await nav('Поле');
  await nav('Программа');
  await delay(150);
  const restoredPan = await programView();
  assert.equal(restoredPan.scrollX, panned.scrollX, 'ordinary navigation preserves horizontal pan');
  assert.equal(restoredPan.scrollY, panned.scrollY, 'ordinary navigation preserves vertical pan');
  await page.getByRole('button', { name: 'К началу', exact: true }).click();
  await visibleProgramStart('explicit start after user scroll');
  const projectHistory = {
    undo: await page.getByRole('button', { name: 'Отменить', exact: true }).isDisabled(),
    redo: await page.getByRole('button', { name: 'Повторить', exact: true }).isDisabled(),
  };
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 720],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await delay(180);
    const automatic = await visibleProgramStart(`automatic resize at ${width}`);
    await page.getByRole('button', { name: 'К началу', exact: true }).click();
    await delay(100);
    const explicit = await visibleProgramStart(`explicit reveal at ${width}`);
    record('program start geometry', { width, automatic, explicit });
    assert.equal(await blockGraph(), layoutGraph, 'layout and reveal do not mutate block graph');
    assert.equal(
      await blockHistory(),
      layoutHistory,
      'layout and reveal do not create Blockly history',
    );
    if (width <= 390) {
      await page.getByRole('button', { name: 'Палитра блоков', exact: true }).click();
      await page.getByRole('tab', { name: 'Управление', exact: true }).click();
      await page.getByRole('button', { name: 'Скрыть палитру', exact: true }).click();
      await delay(180);
      await visibleProgramStart(`palette close at ${width}`);
      assert.equal(await blockGraph(), layoutGraph);
    }
  }
  assert.deepEqual(
    (await save()).circuit,
    layoutProject.circuit,
    'layout never changes source or persistence',
  );
  assert.equal(await blockHistory(), layoutHistory);
  assert.deepEqual(
    {
      undo: await page.getByRole('button', { name: 'Отменить', exact: true }).isDisabled(),
      redo: await page.getByRole('button', { name: 'Повторить', exact: true }).isDisabled(),
    },
    projectHistory,
  );
  record(
    'mobile program start survives resizing and palette toggles without graph/source/history edits',
  );
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 720],
  ]) {
    for (const section of ['Поле', 'Робот', 'Электроника', 'Программа'])
      await viewport(width, height, section);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await nav('Программа');
  await page.locator('.arduino-mode-menu > summary').click();
  await page.getByRole('button', { name: 'Текст', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Продолжить?', exact: true })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  const editor = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
  const source = await editor.inputValue();
  const downloadedPromise = page.waitForEvent('download');
  await page.getByTitle('Скачать .ino', { exact: true }).click();
  const downloaded = await downloadedPromise;
  await downloaded.saveAs(resolve(output, 'robotics-example.ino'));
  assert.equal(await readFile(resolve(output, 'robotics-example.ino'), 'utf8'), source);
  await editor.fill('void setup() {}\nvoid loop() { unknownRoboticsCommand(); }\n');
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await until(
    'unsupported sketch is rejected',
    () => page.getByTestId('robotics-notice').innerText(),
    (text) => /неподдерж|неизвест|ошиб|unsupported|unknown|invalid/i.test(text),
    30_000,
  );
  assert.equal((await observation()).time, 0);
  await editor.fill(source);
  await save();
  await page.reload({ waitUntil: 'networkidle' });
  await nav('Программа');
  assert.equal(await editor.inputValue(), source);
  record('text programming, source download, unsupported rejection and local reload');

  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(forbiddenRequests, [], 'no external or API requests');
  console.log(JSON.stringify({ result: 'PASS', receipts, output }, null, 2));
} catch (error) {
  receipts.push({ failure: error instanceof Error ? error.message : String(error) });
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
