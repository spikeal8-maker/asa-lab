/* global DOMMatrix, DOMPoint, Element, document, innerWidth, performance, window */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const origin = 'https://asa-ramp-passive.invalid';
const pageUrl = origin + '/passive.html';
const scriptUrl = origin + '/assets/passive.js';
const artifactFiles = ['passive.html', 'passive.ts', 'passive.spec.ts', 'passive.browser.mjs'];
const geometry = 'tests/robotics/field-core-qualification/editable-ramp-geometry.ts';
const geometrySha = '80d21f82acc576990b825b588adb539bcdd9aef7a784e45dab332eec177ff848';
const mime = 'application/x-asa-passive-ramp';
const millimetres = (point) => point?.map((value) => Math.round(value * 1000) / 1000);
const run = 0.8;
const viewLabels = { top: 'Сверху', orbit: 'Перспектива', side: 'Сбоку' };
const fieldLabels = {
  x: 'Положение X',
  y: 'Глубина Y',
  width: 'Ширина',
  rise: 'Высота подъёма',
  angle: 'Угол наклона',
};
const fileKey = (path) => path.split(sep).join('/');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 2_000_000 });
const receipt = (file, body) => ({
  file,
  bytes: body.length,
  sha256: createHash('sha256').update(body).digest('hex'),
});
const require = createRequire(import.meta.url);

async function exactSource(head) {
  assert.match(head ?? '', /^[0-9a-f]{40}$/, 'Usage: node passive.browser.mjs <exact HEAD>');
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), head);
  assert.equal(git('status', '--porcelain=v1', '-uall').length, 0, 'Expected clean worktree');
  const files = [
    ...artifactFiles.map((name) => fileKey(relative(repo, join(here, name)))),
    geometry,
    'pnpm-lock.yaml',
  ];
  const sources = await Promise.all(
    files.map(async (file) => {
      const data = await readFile(join(repo, file));
      assert.ok(data.equals(git('show', `${head}:${file}`)), 'Source byte mismatch: ' + file);
      return receipt(file, data);
    }),
  );
  assert.equal(sources.find((item) => item.file === geometry).sha256, geometrySha);
  return { head, tree: git('rev-parse', `${head}^{tree}`).toString().trim(), sources };
}

async function resources() {
  const web = createRequire(join(repo, 'apps/web/package.json'));
  const threeRoot = fileKey(dirname(dirname(web.resolve('three'))));
  const model = fileKey(join(repo, geometry));
  const input = fileKey(join(here, 'passive.ts'));
  const result = await build({
    configFile: false,
    root: repo,
    publicDir: false,
    logLevel: 'silent',
    build: {
      write: false,
      modulePreload: false,
      minify: false,
      sourcemap: false,
      rollupOptions: { input, output: { inlineDynamicImports: true } },
    },
  });
  assert.ok(!Array.isArray(result));
  assert.equal(result.output.length, 1, 'Only the static JS entry is admitted');
  const [chunk] = result.output;
  assert.equal(chunk.type, 'chunk');
  assert.ok(chunk.isEntry && !chunk.imports.length && !chunk.dynamicImports.length);
  const modules = Object.keys(chunk.modules).map(fileKey).sort();
  assert.ok(
    modules.includes(input) && modules.includes(model),
    'Actual frozen helper must be bundled',
  );
  for (const path of modules) {
    assert.ok(
      path === input || path === model || path.startsWith(threeRoot + '/'),
      'Unexpected bundled input: ' + path,
    );
  }
  const html = await readFile(join(here, 'passive.html'));
  const documentHtml = html.toString('utf8');
  assert.ok(documentHtml.includes('./assets/passive.js'));
  assert.ok(documentHtml.includes('<link rel="icon" href="data:," />'));
  assert.equal(
    documentHtml.match(/\bdata:/g)?.length,
    1,
    'Only the empty embedded favicon is admitted',
  );
  return {
    assets: new Map([
      [pageUrl, { data: html, type: 'text/html; charset=utf-8', resource: 'document' }],
      [
        scriptUrl,
        {
          data: Buffer.from(chunk.code),
          type: 'text/javascript; charset=utf-8',
          resource: 'script',
        },
      ],
    ]),
    modules: modules.map((path) =>
      path.startsWith(threeRoot + '/')
        ? 'three/' + path.slice(threeRoot.length + 1)
        : fileKey(relative(repo, path)),
    ),
  };
}

function pinnedChromium() {
  const test = createRequire(require.resolve('@playwright/test/package.json'));
  const playwright = createRequire(test.resolve('playwright/package.json'));
  const core = playwright.resolve('playwright-core/package.json');
  const { browsers } = require(join(dirname(core), 'browsers.json'));
  const shell = browsers.find((entry) => entry.name === 'chromium-headless-shell');
  assert.match(shell?.revision ?? '', /^\d+$/);
  return { ...shell, playwright: require(core).version };
}

function verifySolid(mesh, anchor, { width, rise }) {
  assert.ok(mesh && mesh.origin.length === 3);
  for (const [index, value] of mesh.origin.entries()) {
    assert.ok(Math.abs(value - anchor[index]) < 0.000001);
  }
  const [x, y, z] = anchor;
  const plan = [
    [x, y - width / 2],
    [x + run, y - width / 2],
    [x + run, y + width / 2],
    [x, y + width / 2],
  ];
  const expected = [
    ...plan.map(([vx, vy]) => [vx, vy, z - 0.05]),
    ...plan.map(([vx, vy], index) => [vx, vy, z + (index === 1 || index === 2 ? rise : 0)]),
  ];
  const rounded = (point) => point.map((value) => Math.round(value * 100_000)).join(':');
  assert.equal(mesh.vertices.length, 8);
  assert.deepEqual(mesh.vertices.map(rounded).sort(), expected.map(rounded).sort());
}

async function target(canvas, xyz, offsetY = 0) {
  return canvas.evaluate(
    (element, { xyz, offsetY }) => {
      const rect = element.getBoundingClientRect();
      const projection = JSON.parse(element.dataset.projection ?? 'null');
      const viewMatrix = JSON.parse(element.dataset.viewMatrix ?? 'null');
      if (
        rect.width <= 100 ||
        rect.height <= 100 ||
        projection?.length !== 16 ||
        viewMatrix?.length !== 16 ||
        ![...projection, ...viewMatrix].every(Number.isFinite)
      )
        throw new Error('Invalid rendered camera readback');
      const camera = new DOMMatrix(projection).multiply(new DOMMatrix(viewMatrix));
      const point = new DOMPoint(...xyz, 1).matrixTransform(camera);
      const x = Math.round(rect.left + ((point.x / point.w + 1) * rect.width) / 2);
      const y = Math.round(rect.top + ((1 - point.y / point.w) * rect.height) / 2) + offsetY;
      if (document.elementFromPoint(x, y) !== element)
        throw new Error('Projected pointer is outside the actual canvas');
      return { projection, viewMatrix, rect: rect.toJSON(), view: element.dataset.view, x, y };
    },
    { xyz, offsetY },
  );
}

async function anchorAt(page, sample, point, depth) {
  const ground = await page.evaluate(
    ({ sample, point, depth }) => {
      const inverse = new DOMMatrix(sample.projection)
        .multiply(new DOMMatrix(sample.viewMatrix))
        .inverse();
      const u = (2 * (point.x - sample.rect.left)) / sample.rect.width - 1;
      const v = 1 - (2 * (point.y - sample.rect.top)) / sample.rect.height;
      const unproject = (z) => {
        const p = new DOMPoint(u, v, z, 1).matrixTransform(inverse);
        return [p.x / p.w, p.y / p.w, p.z / p.w];
      };
      const near = unproject(-1),
        far = unproject(1);
      const side = sample.view === 'side';
      const axis = side ? 1 : 2;
      const t = ((side ? depth : 0) - near[axis]) / (far[axis] - near[axis]);
      if (!Number.isFinite(t) || t < 0 || t > 1)
        throw new Error('Native cursor misses required placement plane');
      return [near[0] + t * (far[0] - near[0]), side ? depth : near[1] + t * (far[1] - near[1])];
    },
    { sample, point, depth },
  );
  assert.ok(ground.every(Number.isFinite));
  return [...ground.map((v) => Math.round(v * 1000) / 1000), 0];
}

async function watchTraffic(context, assets) {
  const requests = [],
    responses = [],
    denied = [],
    unexpected = [];
  const csp =
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  await context.route('**/*', async (route) => {
    const request = route.request();
    const asset = assets.get(request.url());
    if (
      !asset ||
      request.method() !== 'GET' ||
      request.redirectedFrom() ||
      request.resourceType() !== asset.resource
    ) {
      denied.push({ url: request.url(), method: request.method(), type: request.resourceType() });
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({
      status: 200,
      body: asset.data,
      headers: {
        'content-type': asset.type,
        'content-security-policy': csp,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });
  context.on('request', (r) =>
    requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }),
  );
  context.on('response', (r) =>
    responses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] }),
  );
  context.on('serviceworker', () => unexpected.push('serviceworker'));
  return { requests, responses, denied, unexpected, csp };
}

async function observeNative(context) {
  await context.addInitScript(() => {
    window.__passiveDragEvidence = [];
    window.__passiveInputEvidence = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'keydown']) {
      document.addEventListener(
        type,
        (event) => {
          if (!event.isTrusted || !(event.target instanceof Element)) return;
          window.__passiveInputEvidence.push({
            type,
            target: event.target.closest('[data-testid]')?.getAttribute('data-testid'),
            x: event.clientX,
            y: event.clientY,
            pointerType: event.pointerType,
            key: event.key,
          });
        },
        { capture: true },
      );
    }
    for (const type of ['dragstart', 'dragenter', 'dragover', 'dragleave', 'drop', 'dragend']) {
      document.addEventListener(
        type,
        (event) => {
          if (!event.isTrusted || !(event.target instanceof Element)) return;
          const target = event.target.closest('[data-testid]')?.getAttribute('data-testid');
          const types = Array.from(event.dataTransfer?.types ?? []);
          const payload =
            type === 'drop'
              ? event.dataTransfer?.getData('application/x-asa-passive-ramp')
              : undefined;
          window.__passiveDragEvidence.push({
            type,
            target,
            x: event.clientX,
            y: event.clientY,
            types,
            payload,
          });
        },
        { capture: true },
      );
    }
  });
}

async function runBrowser(assets, output) {
  const pinned = pinnedChromium();
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND',
    ],
  });
  try {
    assert.equal(
      browser.version(),
      pinned.browserVersion,
      'Chromium must match the lockfile-pinned revision',
    );
    const context = await browser.newContext({
      viewport: { width: 1280, height: 864 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      locale: 'ru-RU',
    });
    const traffic = await watchTraffic(context, assets);
    await observeNative(context);
    const page = await context.newPage();
    page.setDefaultTimeout(6_000);
    const errors = [];
    context.on('page', () => traffic.unexpected.push('extra-page'));
    page.on('worker', () => traffic.unexpected.push('worker'));
    page.on('websocket', () => traffic.unexpected.push('websocket'));
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(pageUrl, { waitUntil: 'load' });
    assert.equal(page.url(), pageUrl);
    const canvas = page.getByTestId('ramp-passive-canvas');
    const palette = page.getByTestId('ramp-palette-card');
    const confirm = page.getByRole('button', { name: 'Разместить горку', exact: true });
    const input = (name) => page.getByRole('spinbutton', { name: fieldLabels[name], exact: true });
    const value = async (name) => {
      const raw = await input(name).inputValue();
      assert.ok(raw.trim().length > 0);
      const number = Number(raw.replace(',', '.'));
      assert.ok(Number.isFinite(number));
      return number;
    };
    const dimensions = async () => ({
      width: await value('width'),
      rise: await value('rise'),
      angle: await value('angle'),
    });
    const meshes = async () => {
      const all = JSON.parse((await canvas.getAttribute('data-ramp-renders')) ?? 'null');
      assert.ok(Array.isArray(all) && all.length <= 2);
      assert.ok(all.every((mesh) => mesh.role === 'preview' || mesh.role === 'committed'));
      assert.equal(new Set(all.map((mesh) => mesh.role)).size, all.length);
      return all;
    };
    const mesh = async (role) => (await meshes()).find((item) => item.role === role);
    const preview = () => mesh('preview');
    const committed = () => mesh('committed');
    const clearPreview = () => expect.poll(preview).toBeUndefined();
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('data-view', 'top');
    await expect(canvas).toHaveAttribute('data-ramp-renders', /\[/);
    await expect(palette).toHaveAttribute('draggable', 'true');
    assert.equal(await committed(), undefined);
    const canvasIdentity = await canvas.elementHandle();
    const panes = {
      palette: await palette.boundingBox(),
      canvas: await canvas.boundingBox(),
      confirm: await confirm.boundingBox(),
    };
    assert.ok(panes.palette && panes.canvas && panes.confirm);
    assert.ok(
      panes.palette.x + panes.palette.width <= panes.canvas.x,
      'Palette is reachable outside the stage',
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const events = () => page.evaluate(() => window.__passiveDragEvidence);
    const realEvent = async (after, type, point) => {
      const record = async () =>
        (await events())
          .slice(after)
          .find(
            (event) =>
              event.type === type &&
              event.target === 'ramp-passive-canvas' &&
              event.x === point.x &&
              event.y === point.y &&
              event.types.includes(mime),
          );
      await expect
        .poll(record, { message: `Trusted ${type} must reach the actual canvas pixel` })
        .toBeDefined();
      return record();
    };
    const move = async ({ x, y }) => {
      await page.mouse.move(x - 1, y - 1, { steps: 8 });
      await page.mouse.move(x, y);
    };
    const begin = async (point) => {
      const after = (await events()).length;
      const box = await palette.boundingBox();
      assert.ok(box);
      const x = Math.round(box.x + box.width / 2),
        y = Math.round(box.y + box.height / 2);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 18, y + 8, { steps: 5 });
      await move(point);
      const hover = await realEvent(after, 'dragover', point);
      assert.ok(
        (await events())
          .slice(after)
          .some((event) => event.type === 'dragstart' && event.target === 'ramp-palette-card'),
      );
      return { after, hover };
    };
    const show = async (view) => {
      await page.getByRole('button', { name: viewLabels[view], exact: true }).click();
      await expect(canvas).toHaveAttribute('data-view', view);
      assert.ok(await canvas.evaluate((current, original) => current === original, canvasIdentity));
    };
    const captures = [],
      placements = [],
      edits = [],
      rejected = [];
    const image = async (file) => {
      captures.push(receipt(file, await page.screenshot({ path: join(output, file) })));
    };
    const place = async (view, xyz, depth, offsetY = 0) => {
      const before = await committed();
      await show(view);
      assert.deepEqual(await committed(), before, 'Switching cameras cannot move the ramp');
      const params = await dimensions();
      const point = await target(canvas, xyz);
      const { after, hover } = await begin(point);
      const anchor = await anchorAt(page, point, hover, depth);
      assert.notDeepEqual(
        anchor,
        millimetres(before?.origin),
        'Require a different world position',
      );
      await expect.poll(async () => millimetres((await preview())?.origin)).toEqual(anchor);
      verifySolid(await preview(), anchor, params);
      assert.deepEqual(await committed(), before, 'Holding a drag must not commit');
      const otherPoint = offsetY ? await target(canvas, xyz, offsetY) : point;
      let otherHover;
      if (offsetY) {
        await move(otherPoint);
        otherHover = await realEvent(after, 'dragover', otherPoint);
        assert.equal(otherHover.x, hover.x);
        assert.notEqual(otherHover.y, hover.y);
        assert.deepEqual(await anchorAt(page, otherPoint, otherHover, depth), anchor);
        await expect.poll(async () => millimetres((await preview())?.origin)).toEqual(anchor);
        verifySolid(await preview(), anchor, params);
        assert.deepEqual(await committed(), before);
      }
      await page.mouse.up();
      const drop = await realEvent(after, 'drop', otherPoint);
      assert.equal(drop.payload, 'ramp');
      assert.deepEqual(await anchorAt(page, otherPoint, drop, depth), anchor);
      await clearPreview();
      const result = await committed();
      verifySolid(result, anchor, params);
      assert.deepEqual([await value('x'), await value('y')], anchor.slice(0, 2));
      const native = (await events()).slice(after);
      assert.equal(native.filter((event) => event.type === 'drop').length, 1);
      placements.push({
        view,
        point,
        otherPoint,
        otherHover,
        anchor,
        params,
        before,
        result,
        native,
      });
      await image(`ramp-${view}.png`);
    };

    await place('top', [0.35, 0.48, 0]);
    async function edit(name, number, expected) {
      const before = await committed();
      const previous = await dimensions();
      await input(name).fill(String(number));
      await expect(confirm).toBeEnabled();
      assert.deepEqual(
        await committed(),
        before,
        'Input change is provisional before confirmation',
      );
      await confirm.click();
      await clearPreview();
      const result = await committed();
      verifySolid(result, before.origin, expected);
      const values = await dimensions();
      assert.ok(Math.abs(values.width - expected.width) <= 0.0005);
      assert.ok(Math.abs(values.rise - expected.rise) <= 0.0005);
      assert.ok(
        Math.abs(values.angle - (Math.atan2(expected.rise, run) * 180) / Math.PI) <= 0.0050001,
      );
      edits.push({ name, number, previous, values, before, result });
    }
    await edit('width', 0.52, { width: 0.52, rise: 0.18 });
    await edit('rise', 0.32, { width: 0.52, rise: 0.32 });
    await edit('angle', (Math.atan2(0.4, run) * 180) / Math.PI, { width: 0.52, rise: 0.4 });
    const beforeInvalid = await committed();
    await input('width').fill('-0.2');
    await expect(confirm).toBeDisabled();
    await clearPreview();
    assert.deepEqual(await committed(), beforeInvalid);
    rejected.push({
      type: 'parameter',
      field: 'width',
      input: await input('width').inputValue(),
      previous: beforeInvalid,
      after: await committed(),
    });
    await input('width').fill('0.52');
    await place('orbit', [0.72, 0.78, 0]);
    const depth = 0.93;
    const priorSide = await committed();
    await input('y').fill(String(depth));
    assert.deepEqual(await committed(), priorSide);
    await place('side', [1.12, depth, 0.1], depth, -25);
    await show('top');
    const stable = await committed();
    const invalid = await target(canvas, [1.93, 0.72, 0]);
    const { after: invalidStart, hover: invalidHover } = await begin(invalid);
    const invalidAnchor = await anchorAt(page, invalid, invalidHover);
    assert.ok(
      invalidAnchor[0] < 2.4 && invalidAnchor[0] + run > 2.4,
      'Anchor is on-board, only footprint protrudes',
    );
    await expect(canvas).toHaveAttribute('data-placement', 'invalid');
    await expect(page.getByText('Горка выходит за границы поля', { exact: true })).toBeVisible();
    await clearPreview();
    assert.deepEqual(await committed(), stable);
    await page.mouse.up();
    await clearPreview();
    assert.deepEqual(await committed(), stable);
    rejected.push({
      type: 'footprint',
      invalid,
      invalidAnchor,
      native: (await events()).slice(invalidStart),
    });

    const canceled = await target(canvas, [0.55, 0.73, 0]);
    const { after: escapeStart } = await begin(canceled);
    await expect.poll(preview).toBeDefined();
    await page.keyboard.press('Escape');
    await clearPreview();
    await page.mouse.up();
    assert.deepEqual(await committed(), stable);
    rejected.push({ type: 'escape', native: (await events()).slice(escapeStart) });

    const { after: exitStart } = await begin(canceled);
    await expect.poll(preview).toBeDefined();
    const outside = await palette.boundingBox();
    assert.ok(outside);
    await page.mouse.move(Math.round(outside.x + 4), Math.round(outside.y + 4));
    await expect
      .poll(async () =>
        (await events())
          .slice(exitStart)
          .some((event) => event.type === 'dragleave' && event.target === 'ramp-passive-canvas'),
      )
      .toBe(true);
    await clearPreview();
    const entered = (await events()).length;
    await move(canceled);
    await realEvent(entered, 'dragover', canceled);
    await clearPreview();
    await page.mouse.up();
    assert.deepEqual(await committed(), stable);
    const exitEvents = (await events()).slice(exitStart);
    rejected.push({ type: 'viewport-exit', native: exitEvents });
    const inputEvents = () => page.evaluate(() => window.__passiveInputEvidence);
    await palette.click();
    await expect(canvas).toBeFocused();
    const pickStart = (await inputEvents()).length;
    await page.mouse.move(canceled.x, canceled.y);
    await page.mouse.down();
    const pointerAnchor = await anchorAt(page, canceled, canceled);
    await expect.poll(async () => millimetres((await preview())?.origin)).toEqual(pointerAnchor);
    assert.notDeepEqual(pointerAnchor, millimetres(stable.origin));
    assert.deepEqual(await committed(), stable);
    const beyondCanvas = { x: Math.round(outside.x + 4), y: Math.round(outside.y + 4) };
    await page.mouse.move(beyondCanvas.x, beyondCanvas.y);
    await expect(canvas).toHaveAttribute('data-placement', 'idle');
    await clearPreview();
    await page.mouse.move(canceled.x, canceled.y);
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-placement', 'idle');
    await clearPreview();
    assert.deepEqual(await committed(), stable);
    const pointerEvents = (await inputEvents()).slice(pickStart);
    const nativePointerAt = (type, point) =>
      pointerEvents.some(
        (event) =>
          event.type === type &&
          event.pointerType === 'mouse' &&
          event.x === point.x &&
          event.y === point.y,
      );
    assert.ok(nativePointerAt('pointerdown', canceled) && nativePointerAt('pointerup', canceled));
    assert.ok(nativePointerAt('pointermove', beyondCanvas));
    rejected.push({
      type: 'pointer-exit',
      point: canceled,
      beyondCanvas,
      pointerAnchor,
      pointerEvents,
    });

    await show('side');
    const keyboardDepth = 0.63;
    await input('y').fill(String(keyboardDepth));
    const keyboardX = await value('x');
    const keyboardParams = await dimensions();
    assert.deepEqual(await committed(), stable);
    await palette.click();
    await expect(canvas).toBeFocused();
    const keyboardStart = (await inputEvents()).length;
    const sideAnchor = [keyboardX, keyboardDepth, 0];
    await expect.poll(async () => millimetres((await preview())?.origin)).toEqual(sideAnchor);
    const beforeArrow = await preview();
    await page.keyboard.press('ArrowUp');
    await canvas.evaluate(
      () =>
        new Promise((done) =>
          window.requestAnimationFrame(() => window.requestAnimationFrame(done)),
        ),
    );
    assert.equal(await value('y'), keyboardDepth);
    assert.deepEqual(await preview(), beforeArrow);
    assert.deepEqual(await committed(), stable);
    const shiftedX = Math.round((keyboardX + 0.01) * 1000) / 1000;
    const keyboardAnchor = [shiftedX, keyboardDepth, 0];
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => millimetres((await preview())?.origin)).toEqual(keyboardAnchor);
    verifySolid(await preview(), keyboardAnchor, keyboardParams);
    assert.deepEqual(await committed(), stable);
    await page.keyboard.press('Enter');
    await expect(canvas).toHaveAttribute('data-placement', 'idle');
    await expect(canvas).toBeFocused();
    await clearPreview();
    const keyboardRamp = await committed();
    verifySolid(keyboardRamp, keyboardAnchor, keyboardParams);
    assert.deepEqual([await value('x'), await value('y')], keyboardAnchor.slice(0, 2));
    const keyboardEvents = (await inputEvents()).slice(keyboardStart);
    assert.deepEqual(
      keyboardEvents
        .filter((event) => event.type === 'keydown' && event.target === 'ramp-passive-canvas')
        .map((event) => event.key),
      ['ArrowUp', 'ArrowRight', 'Enter'],
    );
    const sideKeyboard = {
      sideAnchor,
      keyboardAnchor,
      before: stable,
      result: keyboardRamp,
      keyboardEvents,
    };
    const expected = [...assets.keys()].sort();
    assert.deepEqual(traffic.denied, []);
    assert.deepEqual(traffic.unexpected, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(traffic.requests.map((entry) => entry.url).sort(), expected);
    assert.deepEqual(traffic.responses.map((entry) => entry.url).sort(), expected);
    assert.ok(
      traffic.responses.every(
        (entry) => entry.status === 200 && assets.get(entry.url).type === entry.type,
      ),
    );
    assert.equal(context.serviceWorkers().length, 0);
    assert.equal(page.workers().length, 0);
    assert.deepEqual(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .sort(),
      ),
      [scriptUrl],
    );
    return {
      browser: { ...pinned, actual: browser.version(), platform: process.platform },
      viewport: page.viewportSize(),
      panes,
      traffic,
      placements,
      edits,
      rejected,
      sideKeyboard,
      captures,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node passive.browser.mjs <exact HEAD>');
  const source = await exactSource(process.argv[2]);
  const { assets, modules } = await resources();
  const output = await mkdtemp(join(tmpdir(), 'asa-ramp-passive-proof-'));
  const result = await runBrowser(assets, output);
  const report = Buffer.from(
    JSON.stringify(
      {
        schema: 'ASA_EDITABLE_RAMP_PORTABLE_PASSIVE_V1',
        profile: 'TEST_ONLY',
        source,
        resources: [...assets].map(([url, asset]) => ({
          url,
          type: asset.type,
          ...receipt(new URL(url).pathname, asset.data),
        })),
        modules,
        result,
      },
      null,
      2,
    ) + '\n',
  );
  const file = 'passive-browser-receipt.json';
  await writeFile(join(output, file), report, { flag: 'wx' });
  console.log(
    JSON.stringify({
      status: 'PASS',
      output,
      source: source.head,
      tree: source.tree,
      ...receipt(file, report),
    }),
  );
}

await main();
