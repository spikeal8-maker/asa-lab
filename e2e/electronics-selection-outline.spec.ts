import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { catalogEntry, renderedSize } from '../apps/web/src/electronics/component-catalog';
import { configureProductionLibrary } from '../apps/web/src/electronics/production-manifest-adapter';
import { addComponentToDocument } from '../apps/web/src/electronics/workbench-document';
import type { ElectronicsSimulationWorkerResponse } from '../apps/web/src/electronics/simulation-worker-protocol';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

configureProductionLibrary(
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'apps/web/public/assets/electronics/component-database/catalog.json'),
      'utf8',
    ),
  ),
);

const families = [
  ['resistor', 'resistor-axial', 350, 270],
  ['button', 'button-tactile-6mm', 600, 270],
  ['switch', 'switch-spdt', 520, 270],
  ['led', 'led-5mm', 430, 270],
  ['lamp', 'incandescent-lamp', 650, 150],
  ['supply', 'regulated-power-supply', 200, 130],
  ['meter', 'multimeter', 430, 130],
  ['uno', 'arduino-uno', 350, 430],
  ['board', 'breadboard-small', 650, 430],
] as const;

function pupilDocument(): SchematicDocument {
  let document: SchematicDocument = {
    schemaVersion: 4,
    components: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  for (const [id, type, x, y] of families)
    document = addComponentToDocument(document, type, { x, y }, id).document;
  document.components = document.components.map((part) => {
    if (part.id === 'supply')
      return {
        ...part,
        value: 6,
        state: true,
        stateProperties: {
          ...part.stateProperties,
          voltageSetpointVolt: 6,
          currentLimitAmp: 1,
          outputEnabled: true,
        },
      };
    if (part.id === 'resistor') return { ...part, value: 220 };
    if (part.id === 'uno')
      return {
        ...part,
        stateProperties: {
          ...part.stateProperties,
          arduinoCodeMode: 'text',
          arduinoSource: 'void setup(){} void loop(){delay(100);}',
        },
      };
    return part;
  });
  const connect = (id: string, from: string, fromPin: string, to: string, toPin: string) =>
    document.connections.push({
      id,
      from: { componentId: from, terminal: fromPin },
      to: { componentId: to, terminal: toPin },
      color: id.includes('negative') ? '#2a3035' : '#e3212b',
      vertices: [],
    });
  connect('lamp-positive', 'supply', 'positive', 'lamp', 'L1');
  connect('lamp-negative', 'lamp', 'L2', 'supply', 'negative');
  connect('led-positive', 'supply', 'positive', 'resistor', 'lead-1');
  connect('resistor-led', 'resistor', 'lead-2', 'led', 'anode');
  connect('led-negative', 'led', 'cathode', 'supply', 'negative');
  connect('meter-positive', 'supply', 'positive', 'meter', 'v-ohm-ma');
  connect('meter-negative', 'meter', 'com', 'supply', 'negative');
  return document;
}

type Point = { x: number; y: number };
type Probe = {
  phase: string;
  events: unknown[];
  nativePoints?: unknown[];
  responses: Array<{ at: number; response: ElectronicsSimulationWorkerResponse }>;
};
type ProbeWindow = Window & { __outlineProbe?: Probe };
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type Profile = { kind: string; boundary: Point; normal: Point; expectedPx: number };

async function installObserver(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = { phase: 'entry', events: [], responses: [] };
    (window as ProbeWindow).__outlineProbe = probe;
    for (const type of [
      'pointerdown',
      'pointerup',
      'gotpointercapture',
      'lostpointercapture',
      'click',
      'wheel',
      'keydown',
      'keyup',
    ])
      document.addEventListener(
        type,
        (event) => {
          const pointer = event as PointerEvent;
          const target = event.target instanceof Element ? event.target : null;
          probe.events.push({
            phase: probe.phase,
            type,
            trusted: event.isTrusted,
            at: performance.now(),
            x: pointer.clientX,
            y: pointer.clientY,
            pointerId: pointer.pointerId,
            key: (event as KeyboardEvent).key,
            code: (event as KeyboardEvent).code,
            component: target
              ?.closest('[data-testid="schematic-component"]')
              ?.getAttribute('data-component-id'),
            target: target?.getAttribute('class'),
          });
        },
        true,
      );
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name === 'asa-electronics-simulation')
          worker.addEventListener(
            'message',
            (event: MessageEvent<ElectronicsSimulationWorkerResponse>) => {
              probe.responses.push({ at: performance.now(), response: event.data });
            },
          );
        return worker;
      },
    });
  });
}

async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

function part(page: Page, id: string) {
  return page.locator(`[data-testid="schematic-component"][data-component-id="${id}"]`);
}

async function selectedIds(page: Page) {
  return page
    .locator('[data-testid="schematic-component"].workbench-component-selected')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-component-id')).sort());
}

async function neutralFocus(page: Page) {
  // A real pointer press outside the component removes SVG keyboard focus while
  // retaining selection. No CSS/DOM focus or selection state is injected.
  await page.locator('.workbench-stage-controls span').click();
  await page.mouse.move(2, 2);
  await frames(page);
}

async function nativePoint(page: Page, id: string): Promise<Point> {
  const type = families.find((entry) => entry[0] === id)![1];
  const entry = catalogEntry(type)!;
  const size = renderedSize(entry, 0);
  return part(page, id).evaluate(
    async (root, input) => {
      const visual = root.querySelector<SVGSVGElement>('.workbench-production-visual')!;
      const probe = (window as ProbeWindow).__outlineProbe!;
      const attempts: unknown[] = [];
      (probe.nativePoints ??= []).push({ phase: probe.phase, id: input.id, attempts });
      const unobscured = (point: DOMPoint, allowGrid: boolean) => {
        const hit = document.elementFromPoint(point.x, point.y);
        // Owner images deliberately pass pointers through to this canvas's grid;
        // Stage then resolves the painted alpha and starts the native body drag.
        const delegated =
          allowGrid &&
          hit?.classList.contains('workbench-grid-hit') &&
          hit.closest('.workbench-canvas') === root.closest('.workbench-canvas');
        const accepted = Boolean(
          hit &&
          (root.contains(hit) || delegated) &&
          !hit.closest(
            '.workbench-terminal, .workbench-breadboard-hole-hit, [class*="-knob"], [class*="-power-switch"], [class*="-mode-"], [data-testid="arduino-reset-button"]',
          ),
        );
        attempts.push({
          x: point.x,
          y: point.y,
          target: hit?.getAttribute('class'),
          targetTestId: hit?.getAttribute('data-testid'),
          component: hit
            ?.closest('[data-testid="schematic-component"]')
            ?.getAttribute('data-component-id'),
          delegated: Boolean(delegated),
          accepted,
        });
        return accepted;
      };
      const measured = visual.querySelector<SVGGElement>(
        '.workbench-owner-resistor, .workbench-tinkercad-button, .workbench-tinkercad-switch',
      );
      if (measured) {
        // Sample the existing ordinary body geometry. On mobile the central
        // switch point is covered by a larger terminal hit circle; exposed
        // painted body points still support the same real pointer gesture.
        const body = measured.querySelector<SVGGeometryElement>(
          ':scope > path, :scope > rect, [data-testid="spdt-actuator"] > rect',
        );
        if (!body) throw new Error(`No existing measured body geometry for ${input.id}`);
        const bounds = body.getBBox();
        const matrix = body.getScreenCTM()!;
        for (const y of [0.5, 0.25, 0.75, 0.125, 0.875])
          for (const x of [0.5, 0.25, 0.75, 0.125, 0.875]) {
            const local = new DOMPoint(bounds.x + x * bounds.width, bounds.y + y * bounds.height);
            if (!body.isPointInFill(local)) continue;
            const point = local.matrixTransform(matrix);
            if (unobscured(point, false)) return { x: point.x, y: point.y };
          }
        throw new Error(`No unobscured native measured body point for ${input.id}`);
      }
      const image = new Image();
      image.src = input.asset;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 80;
      const context = canvas.getContext('2d')!;
      // Keep the owner's actual meet/stretch projection into the outer visual
      // domain before sampling alpha, including its transparent margins.
      const meet = Math.min(input.width / image.naturalWidth, input.height / image.naturalHeight);
      const drawnWidth = input.fit === 'stretch' ? input.width : image.naturalWidth * meet;
      const drawnHeight = input.fit === 'stretch' ? input.height : image.naturalHeight * meet;
      context.setTransform(80 / input.width, 0, 0, 80 / input.height, 0, 0);
      context.drawImage(
        image,
        (input.width - drawnWidth) / 2,
        (input.height - drawnHeight) / 2,
        drawnWidth,
        drawnHeight,
      );
      const pixels = context.getImageData(0, 0, 80, 80).data;
      const matrix = visual.getScreenCTM()!;
      const candidates: Array<Point & { score: number }> = [];
      for (let y = 6; y < 74; y += 4)
        for (let x = 6; x < 74; x += 4) {
          if (pixels[(y * 80 + x) * 4 + 3]! < 250) continue;
          const point = new DOMPoint(
            (x / 80) * input.width,
            (y / 80) * input.height,
          ).matrixTransform(matrix);
          candidates.push({ x: point.x, y: point.y, score: (x - 40) ** 2 + (y - 40) ** 2 });
        }
      const point = candidates
        .sort((a, b) => a.score - b.score)
        .find((candidate) => unobscured(new DOMPoint(candidate.x, candidate.y), true));
      if (!point) throw new Error(`No unobscured opaque native body point for ${input.id}`);
      return { x: point.x, y: point.y };
    },
    { id, asset: entry.asset!, fit: entry.assetFit, ...size },
  );
}

async function nativeSelect(page: Page, id: string, additive = false) {
  const point = await nativePoint(page, id);
  if (additive) await page.keyboard.down('Shift');
  try {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.up();
  } finally {
    if (additive) await page.keyboard.up('Shift');
  }
  await expect(part(page, id)).toHaveClass(/workbench-component-selected/);
  return point;
}

async function nativeRunningSwitchSelect(page: Page) {
  // The Running switch body is its actuator; its remaining painted leads are
  // covered by terminal hit circles. Use the existing keyboard selection flow,
  // not an actuator press disguised as body selection or programmatic focus.
  const body = part(page, 'switch').locator('.workbench-part');
  const activeBefore = await part(page, 'switch').evaluate((root) =>
    root.classList.contains('workbench-component-actuator-active'),
  );
  const eventStart = await page.evaluate(
    () => (window as ProbeWindow).__outlineProbe!.events.length,
  );
  const tabLimit = await page.evaluate(
    () =>
      document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length + 1,
  );
  let tabs = 0;
  while (!(await body.evaluate((node) => document.activeElement === node)) && tabs < tabLimit) {
    await page.keyboard.press('Tab');
    tabs++;
  }
  expect(await body.evaluate((node) => document.activeElement === node)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(part(page, 'switch')).toHaveClass(/workbench-component-selected/);
  expect(await selectedIds(page)).toEqual(['switch']);
  expect(
    await part(page, 'switch').evaluate((root) =>
      root.classList.contains('workbench-component-actuator-active'),
    ),
  ).toBe(activeBefore);
  const entered = await page.evaluate(
    (start) =>
      (window as ProbeWindow).__outlineProbe!.events.slice(start).some((value) => {
        const event = value as {
          type: string;
          key: string;
          trusted: boolean;
          component: string;
          target: string;
        };
        return (
          event.type === 'keydown' &&
          event.key === 'Enter' &&
          event.trusted &&
          event.component === 'switch' &&
          event.target.split(' ').includes('workbench-part')
        );
      }),
    eventStart,
  );
  expect(entered).toBe(true);
  return { tabs, tabLimit, trustedEnter: entered, activeBefore };
}

async function fitAndPlace(page: Page, id: string) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
  await frames(page);
  await placeInUnobscuredCanvas(page, id);
}

async function placeInUnobscuredCanvas(page: Page, id: string) {
  // Middle-grid pan clears selection. Measure the same unselected body on both
  // sides of that native gesture, after real Escape and the existing render fence.
  await page.keyboard.press('Escape');
  await frames(page);
  const box = await page.locator('.workbench-canvas').boundingBox();
  const body = await part(page, id).locator('.workbench-production-visual').boundingBox();
  if (!box || !body) throw new Error('No actual canvas/body bounds');
  // Keep the actual selected object below the existing inspector; this is a
  // native viewport pan, never a component/document move or hidden layout fix.
  const delta = {
    x: box.x + box.width / 2 - (body.x + body.width / 2),
    y: box.y + box.height - 24 - (body.y + body.height),
  };
  // An actuator consumes pointerdown even for the middle button. Start on an
  // actual exposed grid pixel, with both ends inside the visible canvas.
  const point = await page.locator('.workbench-canvas').evaluate((stage, delta) => {
    const bounds = stage.getBoundingClientRect();
    const left = Math.max(8, bounds.left + 8, bounds.left + 8 - delta.x);
    const right = Math.min(innerWidth - 8, bounds.right - 8, bounds.right - 8 - delta.x);
    const top = Math.max(8, bounds.top + 8, bounds.top + 8 - delta.y);
    const bottom = Math.min(innerHeight - 8, bounds.bottom - 8, bounds.bottom - 8 - delta.y);
    for (let y = top; y <= bottom; y += 12)
      for (let x = left; x <= right; x += 12) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.classList.contains('workbench-grid-hit') && stage.contains(hit)) return { x, y };
      }
    throw new Error('No unobscured native grid point for the required viewport pan');
  }, delta);
  const target = { x: point.x + delta.x, y: point.y + delta.y };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await page.mouse.up({ button: 'middle' });
  await frames(page);
  const moved = await part(page, id).locator('.workbench-production-visual').boundingBox();
  if (!moved) throw new Error('No actual body bounds after viewport pan');
  expect(moved.x - body.x).toBeCloseTo(delta.x, 0);
  expect(moved.y - body.y).toBeCloseTo(delta.y, 0);
}

async function geometry(page: Page, id: string) {
  return part(page, id).evaluate((root) => {
    const matrix = (value: DOMMatrix | null): Matrix | null =>
      value ? { a: value.a, b: value.b, c: value.c, d: value.d, e: value.e, f: value.f } : null;
    const visual = root.querySelector<SVGSVGElement>('.workbench-production-visual')!;
    const box = visual.getBoundingClientRect();
    const selection = root.querySelector(
      '.workbench-tinkercad-selection, .workbench-selection-silhouette',
    );
    const measured = root.querySelector<SVGGElement>(
      '.workbench-owner-resistor, .workbench-tinkercad-button, .workbench-tinkercad-switch',
    );
    const stage = document.querySelector<SVGSVGElement>('.workbench-canvas')!;
    const stageMatrix = stage.getScreenCTM()!;
    const viewBox = stage.viewBox.baseVal;
    const zoom = 1600 / viewBox.width;
    const worldRadius = 1.6 / zoom;
    const expectedPx = worldRadius * Math.hypot(stageMatrix.a, stageMatrix.b);
    const profiles: Profile[] = [];
    if (measured) {
      const transform = measured.getScreenCTM()!;
      const normalLength = Math.hypot(transform.a, transform.b);
      const normal = { x: transform.a / normalLength, y: transform.b / normalLength };
      const id = root.getAttribute('data-component-id');
      const body =
        id === 'resistor'
          ? { x: 3.69, y: 0 }
          : id === 'switch'
            ? { x: 14, y: -10 }
            : { x: 12, y: 0 };
      const pin =
        id === 'resistor'
          ? { x: 1, y: -18 }
          : id === 'switch'
            ? { x: 11, y: -2.5 }
            : { x: 11, y: -14 };
      for (const [kind, local] of [
        ['body', body],
        ['pin', pin],
      ] as const) {
        const point = new DOMPoint(local.x, local.y).matrixTransform(transform);
        profiles.push({ kind, boundary: { x: point.x, y: point.y }, normal, expectedPx });
      }
    }
    return {
      id: root.getAttribute('data-component-id'),
      selected: root.classList.contains('workbench-component-selected'),
      zoom,
      expectedPx,
      profiles,
      stage: {
        matrix: matrix(stageMatrix),
        viewBox: { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height },
      },
      visualMatrix: matrix(visual.getScreenCTM()),
      measuredMatrix: matrix(measured?.getScreenCTM() ?? null),
      bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
      transform: root.querySelector('.workbench-part')?.getAttribute('transform'),
      outline: selection?.outerHTML ?? null,
      ordinary: visual.outerHTML,
      focus: {
        tag: document.activeElement?.tagName,
        class: document.activeElement?.getAttribute('class'),
      },
      sourceOperatingMode: root.getAttribute('data-source-operating-mode'),
      presentationState: root.getAttribute('data-presentation-state'),
      diagnostics: root.getAttribute('data-diagnostics'),
      appliedFilter: getComputedStyle(root.querySelector('.workbench-part')!).filter,
    };
  });
}

function rasterProfiles(before: Buffer, after: Buffer, profiles: Profile[]) {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  return profiles.map((profile) => {
    const samples = [];
    for (let distance = -2; distance <= profile.expectedPx + 3; distance += 0.25) {
      const x = Math.floor(profile.boundary.x + profile.normal.x * distance);
      const y = Math.floor(profile.boundary.y + profile.normal.y * distance);
      if (x < 0 || y < 0 || x >= a.width || y >= a.height)
        throw new Error('Raster profile is clipped');
      const offset = (y * a.width + x) * 4;
      const original = Array.from(a.data.subarray(offset, offset + 4));
      const selected = Array.from(b.data.subarray(offset, offset + 4));
      // Classify a change toward the established selection blue, allowing
      // subpixel antialias. This is colour evidence, not a new art threshold.
      const addedBlue =
        original[0]! - selected[0]! > 8 &&
        selected[2]! - selected[0]! > original[2]! - original[0]! + 12 &&
        selected[1]! > selected[0]!;
      samples.push({ distance, x, y, original, selected, addedBlue });
    }
    const exterior = samples.filter((sample) => sample.distance > 0 && sample.addedBlue);
    return {
      ...profile,
      samples,
      exteriorBlue: exterior.length,
      lastBlueDistance: exterior.at(-1)?.distance ?? null,
    };
  });
}

async function ownerAlphaEvidence(
  page: Page,
  id: string,
  phase: string,
  info: TestInfo,
  before: Buffer,
  after: Buffer,
) {
  const witness = await part(page, id).evaluate(async (root) => {
    const element = root.querySelector<SVGImageElement>('.workbench-selection-silhouette > image');
    if (!element) return null;
    const image = new Image();
    image.src = element.href.baseVal;
    await image.decode();
    const matrix = element.getScreenCTM()!;
    const x = element.x.baseVal.value;
    const y = element.y.baseVal.value;
    const width = element.width.baseVal.value;
    const height = element.height.baseVal.value;
    const fit = element.getAttribute('preserveAspectRatio');
    const meet = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawnWidth = fit === 'none' ? width : image.naturalWidth * meet;
    const drawnHeight = fit === 'none' ? height : image.naturalHeight * meet;
    const canvas = document.createElement('canvas');
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const context = canvas.getContext('2d')!;
    context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    context.drawImage(
      image,
      x + (width - drawnWidth) / 2,
      y + (height - drawnHeight) / 2,
      drawnWidth,
      drawnHeight,
    );
    return {
      href: element.href.baseVal,
      x,
      y,
      width,
      height,
      fit,
      natural: { width: image.naturalWidth, height: image.naturalHeight },
      matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
      png: canvas.toDataURL('image/png').split(',')[1]!,
    };
  });
  if (!witness) return null;
  const { png, ...projection } = witness;
  const maskBytes = Buffer.from(png, 'base64');
  const maskPath = info.outputPath(`${phase}-${id}-actual-owner-alpha.png`);
  await writeFile(maskPath, maskBytes);
  const mask = PNG.sync.read(maskBytes);
  const original = PNG.sync.read(before);
  const selected = PNG.sync.read(after);
  const bounds = await part(page, id).locator('.workbench-production-visual').boundingBox();
  if (!bounds) throw new Error('Missing owner raster bounds');
  const samples: Array<{
    x: number;
    y: number;
    alpha: number;
    original: number[];
    selected: number[];
  }> = [];
  const margin = 12;
  for (
    let y = Math.max(0, Math.floor(bounds.y - margin));
    y < Math.min(mask.height, Math.ceil(bounds.y + bounds.height + margin));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(bounds.x - margin));
      x < Math.min(mask.width, Math.ceil(bounds.x + bounds.width + margin));
      x++
    ) {
      const offset = (y * mask.width + x) * 4;
      if (mask.data[offset + 3]! >= 16) continue;
      const a = Array.from(original.data.subarray(offset, offset + 4));
      const b = Array.from(selected.data.subarray(offset, offset + 4));
      if (a[0]! - b[0]! > 8 && b[2]! - b[0]! > a[2]! - a[0]! + 12 && b[1]! > b[0]!)
        samples.push({ x, y, alpha: mask.data[offset + 3]!, original: a, selected: b });
    }
  return {
    maskPath,
    projection,
    bounds,
    exteriorAddedBlue: samples.length,
    exteriorPixels: samples,
  };
}

async function pair(page: Page, id: string, phase: string, info: TestInfo, output: unknown[]) {
  await page.evaluate((phase) => {
    (window as ProbeWindow).__outlineProbe!.phase = phase;
  }, phase);
  await page.keyboard.press('Escape');
  await neutralFocus(page);
  const beforeGeometry = await geometry(page, id);
  const beforePath = info.outputPath(`${phase}-${id}-unselected.png`);
  const before = await page.screenshot({ path: beforePath });
  const point = await nativeSelect(page, id);
  await neutralFocus(page);
  const afterGeometry = await geometry(page, id);
  const afterPath = info.outputPath(`${phase}-${id}-selected.png`);
  const after = await page.screenshot({ path: afterPath });
  expect(afterGeometry.stage).toEqual(beforeGeometry.stage);
  expect(afterGeometry.visualMatrix).toEqual(beforeGeometry.visualMatrix);
  expect(afterGeometry.transform).toEqual(beforeGeometry.transform);
  expect(afterGeometry.focus).toEqual(beforeGeometry.focus);
  expect(await selectedIds(page)).toEqual([id]);
  const raster = rasterProfiles(before, after, afterGeometry.profiles);
  const ownerAlpha = await ownerAlphaEvidence(page, id, phase, info, before, after);
  output.push({
    phase,
    id,
    point,
    beforePath,
    afterPath,
    beforeGeometry,
    afterGeometry,
    raster,
    ownerAlpha,
    selectedIds: await selectedIds(page),
    pixelOrigin: { x: 0, y: 0 },
    deviceScaleFactor: 1,
  });
  if (ownerAlpha)
    expect
      .soft(
        ownerAlpha.exteriorAddedBlue,
        `${phase} ${id}: rendered blue outside actual owner alpha`,
      )
      .toBeGreaterThan(0);
  // Only the pre-existing visual failure is soft. Native interaction, equal
  // focus/CTM, complete documents and physical readiness remain hard gates.
  for (const profile of raster) {
    expect
      .soft(
        profile.exteriorBlue,
        `${phase} ${id} ${profile.kind}: blue outside the original silhouette`,
      )
      .toBeGreaterThan(0);
    if (profile.lastBlueDistance !== null)
      expect
        .soft(
          Math.abs(profile.lastBlueDistance - profile.expectedPx),
          `${phase} ${id} ${profile.kind}: antialias-bounded actual outward width`,
        )
        .toBeLessThanOrEqual(1.25);
  }
  const measured = afterGeometry.measuredMatrix;
  if (measured) {
    const dimensions = await part(page, id).evaluate((root) => {
      const selection = root.querySelector('.workbench-tinkercad-selection')!;
      const pin = selection.querySelector('line')!;
      const ordinary = Array.from(selection.parentElement!.children).find(
        (node) => node.tagName === 'line',
      )!;
      return {
        body: Number(selection.querySelector('path, rect')!.getAttribute('stroke-width')),
        pin: Number(pin.getAttribute('stroke-width')),
        ordinary: Number(ordinary.getAttribute('stroke-width')),
      };
    });
    const scale = Math.hypot(measured.a, measured.b);
    expect
      .soft((dimensions.body / 2) * scale, `${id} measured body versus actual common screen radius`)
      .toBeCloseTo(afterGeometry.expectedPx, 5);
    expect
      .soft(
        ((dimensions.pin - dimensions.ordinary) / 2) * scale,
        `${id} measured pin versus actual common screen radius`,
      )
      .toBeCloseTo(afterGeometry.expectedPx, 5);
    output.push({
      phase,
      id,
      dimensions,
      measuredScale: scale,
      expectedPx: afterGeometry.expectedPx,
    });
  }
}

async function server(page: Page, id: string) {
  const response = await page.context().request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as { draft: { revision: number; document: SchematicDocument } };
}

async function localDocument(page: Page, user: string, project: string) {
  return page.evaluate(
    ({ user, project }) => {
      const key = `asa-project-local-draft:user:account:${encodeURIComponent(user)}:${encodeURIComponent(project)}`;
      const text = localStorage.getItem(key);
      if (!text) throw new Error('Expected full account-scoped local document');
      const record = JSON.parse(text) as {
        schemaVersion: number;
        identityKind: string;
        userId: string;
        projectId: string;
        moduleKey: string;
        document: SchematicDocument;
      };
      if (
        record.schemaVersion !== 3 ||
        record.identityKind !== 'account' ||
        record.userId !== user ||
        record.projectId !== project ||
        record.moduleKey !== 'electronics'
      )
        throw new Error('Local document scope mismatch');
      return record.document;
    },
    { user, project },
  );
}

function assertFinite(value: unknown) {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) for (const item of value) assertFinite(item);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) assertFinite(item);
}

let admin: pg.Pool;
test.beforeAll(() => {
  admin = e2eAdminPool();
});
test.afterAll(async () => {
  await admin.end();
});

const scenarios = [
  'stopped-fit',
  'stopped-zoom-group',
  'transform-persistence',
  'running-controls',
] as const;
for (const width of [1440, 1024, 390, 320])
  for (const scenario of scenarios) {
    test(`E11 ${scenario}: native outward selection, real DC and whole save reopen at ${width}px`, async ({
      page,
      browser,
    }, info) => {
      const teacher = await seedTeacher(
        admin,
        `e11-outline-${scenario}-${width}-${info.workerIndex}-${info.retry}`,
      );
      const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
      const output: unknown[] = [];
      const puts: unknown[] = [];
      let projectId = '';
      let reopened: Page | undefined;
      let lastObserver: Probe | undefined;
      let lastLocalStorage: Record<string, string | null> | undefined;
      let lastServer: unknown;
      let lastCheckpoint = 'setup';
      let primaryFailure: string | undefined;
      const rawPath = info.outputPath(`e11-outline-${scenario}-${width}-raw.json`);
      await installObserver(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithOrganization(page, teacher);
      const session = await page.context().request.get('/api/auth/me');
      expect(session.status()).toBe(200);
      const user = ((await session.json()) as { user: { id: string } }).user.id;
      const created = await page.context().request.post('/api/projects', {
        headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
        data: {
          scope: 'personal',
          classroomId: null,
          module: 'electronics',
          title: `E11 selection ${width}`,
        },
      });
      expect(created.status()).toBe(201);
      projectId = ((await created.json()) as { project: { id: string } }).project.id;
      const empty = await server(page, projectId);
      const pupil = pupilDocument();
      const seed = await page.context().request.put(`/api/projects/${projectId}/draft`, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          document: pupil,
          baseRevision: empty.draft.revision,
          mutationId: crypto.randomUUID(),
        },
      });
      expect(seed.status()).toBe(200);
      const seeded = await server(page, projectId);
      expect(seeded.draft.document).toEqual(pupil);
      page.on('request', (request) => {
        if (
          request.method() === 'PUT' &&
          new URL(request.url()).pathname === `/api/projects/${projectId}/draft`
        )
          puts.push({ at: Date.now(), body: request.postDataJSON() });
      });
      async function writeRaw(checkpointName: string) {
        const raw = {
          width,
          scenario,
          projectId,
          original: pupil,
          output,
          puts,
          lastCheckpoint: checkpointName,
          primaryFailure,
          journeyComplete: lastCheckpoint === 'complete',
          observer: lastObserver,
          server: lastServer,
          localStorage: lastLocalStorage,
        };
        await writeFile(rawPath, JSON.stringify(raw, null, 2), 'utf8');
      }
      async function checkpoint(name: string) {
        const snapshot = await page.evaluate(() => ({
          observer: (window as ProbeWindow).__outlineProbe,
          localStorage: Object.fromEntries(
            Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
          ),
        }));
        lastObserver = snapshot.observer;
        lastLocalStorage = snapshot.localStorage;
        lastCheckpoint = name;
        await writeRaw(name);
      }
      try {
        const delivery = page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname === `/api/projects/${projectId}`,
        );
        await page.goto(`/#/home/${projectId}`);
        const delivered = (await (await delivery).json()) as {
          draft: { revision: number; document: SchematicDocument };
        };
        expect(delivered.draft).toEqual(seeded.draft);
        output.push({ phase: 'initial-editor-delivery', whole: delivered });
        await expect(page.locator('.workbench-stage')).toBeVisible();
        await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(9);
        const collapse = page.getByRole('button', { name: 'Свернуть библиотеку', exact: true });
        if (await collapse.isVisible()) await collapse.click();
        await page.setViewportSize({ width, height: 900 });
        await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
        await frames(page);
        const layout = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          width: innerWidth,
        }));
        expect(layout.page).toBeLessThanOrEqual(layout.client);
        output.push({
          phase: 'overview',
          layout,
          seeded: seeded.draft,
          nativeMirrorY: 'No UI command exists; not implemented or injected by this test',
          faultFixture: 'Not covered: safe DC fixture is not fault evidence',
        });
        await page.screenshot({ path: info.outputPath('overview.png') });
        lastServer = seeded;
        await checkpoint('initial-editor-delivery');
        let expected = structuredClone(pupil);
        if (scenario === 'stopped-fit') {
          for (const [id] of families) {
            await fitAndPlace(page, id);
            await pair(page, id, 'fit', info, output);
            await checkpoint(`fit-${id}`);
          }
        }
        if (scenario === 'stopped-zoom-group') {
          for (const id of ['resistor', 'button', 'switch']) {
            await fitAndPlace(page, id);
            const point = await nativePoint(page, id);
            await page.mouse.move(point.x, point.y);
            for (let index = 0; index < 8; index++) await page.mouse.wheel(0, -100);
            await frames(page);
            await placeInUnobscuredCanvas(page, id);
            await pair(page, id, 'zoom-in', info, output);
            await checkpoint(`zoom-in-${id}`);
            await page.getByRole('button', { name: 'Уменьшить масштаб', exact: true }).click();
            await frames(page);
            await placeInUnobscuredCanvas(page, id);
            await pair(page, id, 'zoom-out', info, output);
            await checkpoint(`zoom-out-${id}`);
          }
          await page.keyboard.press('Escape');
          await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
          await frames(page);
          for (const [index, id] of ['led', 'resistor', 'switch', 'uno'].entries())
            await nativeSelect(page, id, index > 0);
          expect(await selectedIds(page)).toEqual(['led', 'resistor', 'switch', 'uno']);
          await neutralFocus(page);
          output.push({
            phase: 'group',
            selectedIds: await selectedIds(page),
            geometry: await Promise.all(
              ['led', 'resistor', 'switch', 'uno'].map((id) => geometry(page, id)),
            ),
          });
          await page.screenshot({ path: info.outputPath('group.png') });
          await checkpoint('group');
          expect(puts).toEqual([]);
          expect((await server(page, projectId)).draft).toEqual(seeded.draft);
        }
        if (scenario === 'running-controls') {
          await page.keyboard.press('Escape');
          await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Остановить моделирование', exact: true }),
          ).toHaveAttribute('data-simulation-status', 'running');
          await expect
            .poll(async () =>
              page.evaluate(() =>
                (window as ProbeWindow).__outlineProbe!.responses.some(
                  ({ response }) =>
                    response.ok &&
                    response.kind === 'advance' &&
                    response.advance.executionStatus === 'ready' &&
                    response.advance.result?.solved &&
                    response.advance.committedHorizonMicroseconds > 0,
                ),
              ),
            )
            .toBe(true);
          await expect(part(page, 'led').locator('.workbench-led-visual')).toHaveClass(/is-lit/);
          let lampObservation: unknown;
          await expect
            .poll(async () => {
              const observed = await page.evaluate(() => {
                const responses = (window as ProbeWindow).__outlineProbe!.responses;
                const ready = responses
                  .filter(
                    ({ response }) =>
                      response.ok &&
                      response.kind === 'advance' &&
                      response.advance.executionStatus === 'ready' &&
                      response.advance.committedHorizonMicroseconds > 0,
                  )
                  .at(-1);
                const href = Array.from(
                  document.querySelectorAll(
                    '[data-testid="schematic-component"][data-component-id="lamp"] .workbench-production-visual > image',
                  ),
                )
                  .at(-1)
                  ?.getAttribute('href');
                return { ready, href };
              });
              lampObservation = observed;
              const response = observed.ready?.response;
              if (!response?.ok || response.kind !== 'advance') return false;
              const advance = response.advance;
              const result = advance.result;
              const lamp = result?.components.find((component) => component.componentId === 'lamp');
              const brightness = lamp?.brightness;
              if (
                advance.committedHorizonMicroseconds !== advance.requestedHorizonMicroseconds ||
                !result?.solved ||
                result.status !== 'solved' ||
                !result.quality?.finite ||
                !result.quality.passed ||
                lamp?.lit !== true ||
                typeof brightness !== 'number' ||
                !Number.isFinite(brightness) ||
                brightness <= 0
              )
                return false;
              // Presentation contract, not an assumption that the filament is warm.
              const level = brightness >= 90 ? 'max' : brightness >= 45 ? 'on' : 'dim';
              return observed.href?.endsWith(`/lamp/${level}.svg`) === true;
            })
            .toBe(true);
          output.push({ phase: 'complete-ready-lamp-presentation', observation: lampObservation });
          await checkpoint('complete-ready-lamp-presentation');
          for (const id of ['led', 'lamp']) {
            await fitAndPlace(page, id);
            await pair(page, id, 'running', info, output);
            await checkpoint(`running-${id}`);
          }
          await fitAndPlace(page, 'switch');
          output.push({
            phase: 'running-switch-keyboard-selection',
            ...(await nativeRunningSwitchSelect(page)),
          });
          const switchActive = await part(page, 'switch').evaluate((root) =>
            root.classList.contains('workbench-component-actuator-active'),
          );
          for (const active of [!switchActive, switchActive]) {
            await part(page, 'switch').getByTestId('spdt-actuator').click();
            await expect
              .poll(async () =>
                part(page, 'switch').evaluate((root) =>
                  root.classList.contains('workbench-component-actuator-active'),
                ),
              )
              .toBe(active);
          }
          await checkpoint('running-switch-controls');
          await fitAndPlace(page, 'button');
          const buttonPoint = await nativePoint(page, 'button');
          await page.mouse.move(buttonPoint.x, buttonPoint.y);
          await page.mouse.down();
          await expect(part(page, 'button').locator('circle[opacity="0.3"]')).toHaveCount(0);
          await page.mouse.up();
          await expect(part(page, 'button').locator('circle[opacity="0.3"]')).toHaveCount(1);
          await checkpoint('running-button-controls');
          await fitAndPlace(page, 'supply');
          const supply = part(page, 'supply').getByTestId('regulated-power-supply-runtime');
          await expect(supply).toHaveAttribute('data-output-enabled', 'true');
          for (const enabled of ['false', 'true']) {
            await supply.locator('.workbench-regulated-supply-power-switch').click();
            await expect(supply).toHaveAttribute('data-output-enabled', enabled);
          }
          await checkpoint('running-supply-controls');
          await fitAndPlace(page, 'meter');
          await nativeSelect(page, 'meter');
          const meter = part(page, 'meter').getByTestId('multimeter-runtime-display');
          await meter.locator('.workbench-multimeter-mode-voltage').click();
          await expect(meter).toHaveAttribute('data-measurement-mode', 'dc-voltage');
          output.push({
            phase: 'native-runtime-controls',
            switchRestored: switchActive,
            buttonReleased: true,
            supplyRestored: await supply.getAttribute('data-output-enabled'),
            server: await server(page, projectId),
            wholeLocal: await localDocument(page, user, projectId),
          });
          expect(await localDocument(page, user, projectId)).toEqual(expected);
          await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Начать моделирование', exact: true }),
          ).toBeVisible();
          expect((await server(page, projectId)).draft).toEqual(seeded.draft);
          expect(puts).toEqual([]);
          failures.assertEmpty();

          await checkpoint('runtime-stopped-whole-original');
        }
        expect(puts).toEqual([]);
        expect(await localDocument(page, user, projectId)).toEqual(pupil);
        expect((await server(page, projectId)).draft).toEqual(seeded.draft);
        // Real transforms are the only intended document mutation. Compare every
        // field and unchanged wire/source; do not use product rotation code as oracle.
        const transformIds =
          scenario === 'transform-persistence'
            ? ['resistor', 'led', 'supply', 'uno', 'board']
            : ['resistor'];
        for (const [index, id] of transformIds.entries()) {
          await fitAndPlace(page, id);
          if (id === 'led') {
            const beforeZoom = await geometry(page, id);
            const bounds = beforeZoom.bounds;
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            for (let step = 0; step < 8; step++) await page.mouse.wheel(0, -100);
            await frames(page);
            await placeInUnobscuredCanvas(page, id);
            output.push({
              phase: 'native-led-exposure-zoom',
              before: beforeZoom,
              after: await geometry(page, id),
            });
            await checkpoint('native-led-exposure-zoom');
          }
          await nativeSelect(page, id);
          let transformed = expected.components.find((component) => component.id === id)!;
          const entry = catalogEntry(transformed)!;
          // Each real 45-degree action preserves the center. Keep its binary64
          // operation order; a direct 90-degree or reassociated delta is not exact.
          for (let step = 0; step < (index === 0 ? 2 : 1); step++) {
            const oldSize = renderedSize(entry, transformed.rotation ?? 0);
            const rotation = (((transformed.rotation ?? 0) + 45) % 360) as NonNullable<
              typeof transformed.rotation
            >;
            const nextSize = renderedSize(entry, rotation);
            const center = {
              x: transformed.position.x + oldSize.width / 2,
              y: transformed.position.y + oldSize.height / 2,
            };
            transformed = {
              ...transformed,
              rotation,
              position: {
                x: center.x - nextSize.width / 2,
                y: center.y - nextSize.height / 2,
              },
            };
          }
          if (index < 2)
            transformed = {
              ...transformed,
              stateProperties: { ...transformed.stateProperties, mirrorX: true },
            };
          expected = {
            ...expected,
            components: expected.components.map((component) =>
              component.id !== id ? component : transformed,
            ),
          };
          await page.getByRole('button', { name: 'Повернуть на 45° (R)', exact: true }).click();
          if (index === 0)
            await page.getByRole('button', { name: 'Повернуть на 45° (R)', exact: true }).click();
          if (index < 2) await page.getByRole('button', { name: 'Отразить', exact: true }).click();
          const whole = await localDocument(page, user, projectId);
          expect(whole).toEqual(expected);
          output.push({ phase: 'transformed', id, whole, geometry: await geometry(page, id) });
          await neutralFocus(page);
          await page.screenshot({ path: info.outputPath(`transformed-${id}.png`) });
          await checkpoint(`transformed-${id}`);
        }
        expect(puts).toEqual([]);
        const local = await localDocument(page, user, projectId);
        expect(local).toEqual(expected);
        await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
        await expect
          .poll(async () => (await server(page, projectId)).draft.document)
          .toEqual(expected);
        const saved = await server(page, projectId);
        expect(saved.draft.revision).toBe(seeded.draft.revision + 1);
        expect(puts).toHaveLength(1);
        expect(
          (puts[0] as { body: { document: SchematicDocument; baseRevision: number } }).body
            .document,
        ).toEqual(expected);
        expect((puts[0] as { body: { baseRevision: number } }).body.baseRevision).toBe(
          seeded.draft.revision,
        );
        output.push({
          phase: 'whole-save',
          local,
          expected,
          seeded: seeded.draft,
          saved: saved.draft,
          puts: [...puts],
        });

        lastServer = saved;
        failures.assertEmpty();
        await checkpoint('whole-save');
        const fresh = await browser.newContext({
          baseURL: new URL(page.url()).origin,
          viewport: { width, height: 900 },
          deviceScaleFactor: 1,
        });
        try {
          await fresh.addCookies(await page.context().cookies());
          expect((await fresh.storageState()).origins).toEqual([]);
          reopened = await fresh.newPage();
          reopened.on('request', (request) => {
            if (
              request.method() === 'PUT' &&
              new URL(request.url()).pathname === `/api/projects/${projectId}/draft`
            )
              puts.push({
                at: Date.now(),
                context: 'cookies-reopen',
                body: request.postDataJSON(),
              });
          });
          await installObserver(reopened);
          const freshFailures = collectBrowserFailures(reopened, {
            allowAnonymousSessionProbe: true,
          });
          const delivery = reopened.waitForResponse(
            (response) =>
              response.request().method() === 'GET' &&
              new URL(response.url()).pathname === `/api/projects/${projectId}`,
          );
          await reopened.goto(`/#/home/${projectId}`);
          const delivered = (await (await delivery).json()) as {
            draft: { revision: number; document: SchematicDocument };
          };
          expect(delivered.draft).toEqual(saved.draft);
          output.push({ phase: 'cookies-only-editor-delivery', whole: delivered });
          await writeRaw('cookies-only-editor-delivery');
          await expect(reopened.locator('.workbench-stage')).toBeVisible();
          await expect(reopened.locator('[data-testid="schematic-component"]')).toHaveCount(9);
          expect(
            await reopened.evaluate(() =>
              Object.keys(localStorage).filter((key) => key.startsWith('asa-project-local-draft:')),
            ),
          ).toEqual([]);
          expect(
            await reopened.evaluate(() =>
              Object.keys(sessionStorage).filter((key) =>
                key.startsWith('asa-project-local-draft:'),
              ),
            ),
          ).toEqual([]);
          expect((await server(reopened, projectId)).draft).toEqual(saved.draft);
          const collapse = reopened.getByRole('button', {
            name: 'Свернуть библиотеку',
            exact: true,
          });
          if (await collapse.isVisible()) await collapse.click();
          await fitAndPlace(reopened, 'resistor');
          await pair(reopened, 'resistor', 'cookies-reopen', info, output);
          await reopened.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
          await frames(reopened);
          output.push({
            phase: 'cookies-reopen-zoom',
            geometry: await geometry(reopened, 'resistor'),
            server: await server(reopened, projectId),
            observer: await reopened.evaluate(() => (window as ProbeWindow).__outlineProbe),
          });
          await checkpoint('cookies-reopen-complete');
          freshFailures.assertEmpty();
        } finally {
          try {
            if (!reopened || reopened.isClosed()) {
              output.push({
                phase: 'reopen-finally',
                availability: 'NOT_AVAILABLE',
                error: 'Reopen page closed before final snapshot',
              });
            } else
              output.push({
                phase: 'reopen-finally',
                observer: await reopened.evaluate(() => (window as ProbeWindow).__outlineProbe),
                server: await server(reopened, projectId),
              });
          } catch (error) {
            output.push({
              phase: 'reopen-finally',
              availability: 'NOT_AVAILABLE',
              error: String(error),
            });
          }
          await writeRaw('reopen-finally');
          await fresh.close();
          reopened = undefined;
        }
        const observed = await page.evaluate(() => (window as ProbeWindow).__outlineProbe!);
        if (scenario === 'running-controls') {
          const advances = observed.responses
            .map(({ response }) => response)
            .filter((response) => response.ok && response.kind === 'advance');
          expect(advances.length).toBeGreaterThan(0);
          let committed = 0;
          for (const response of advances) {
            if (!response.ok || response.kind !== 'advance') throw new Error('Unexpected response');
            if (response.advance.executionStatus === 'ready') {
              expect(response.advance.committedHorizonMicroseconds).toBe(
                response.advance.requestedHorizonMicroseconds,
              );
              expect(response.advance.result?.solved).toBe(true);
              expect(response.advance.result?.status).toBe('solved');
              expect(response.advance.result?.quality?.finite).toBe(true);
              expect(response.advance.result?.quality?.passed).toBe(true);
              expect(response.advance.committedHorizonMicroseconds).toBeGreaterThanOrEqual(
                committed,
              );
              committed = response.advance.committedHorizonMicroseconds;
              assertFinite(response.advance.result);
            } else if (response.advance.executionStatus === 'yielded')
              expect(response.advance.result).toBeNull();
            else throw new Error('Real safe DC fixture faulted');
          }
        }
        expect(
          observed.events.filter((event) => (event as { trusted: boolean }).trusted === false),
        ).toEqual([]);
        expect(
          observed.events.some((event) => (event as { type: string }).type === 'gotpointercapture'),
        ).toBe(true);
        expect(
          observed.events.some(
            (event) => (event as { type: string }).type === 'lostpointercapture',
          ),
        ).toBe(true);
        expect(puts).toHaveLength(1);
        expect((await server(page, projectId)).draft).toEqual(saved.draft);
        failures.assertEmpty();
        await checkpoint('complete');
      } catch (error) {
        primaryFailure = String(error);
        throw error;
      } finally {
        // Node evidence is already available even when the page was closed by timeout.
        await writeRaw(lastCheckpoint);
        for (const [name, capture] of [
          [
            'observer',
            async () => {
              if (page.isClosed()) throw new Error('Page closed');
              lastObserver = await page.evaluate(() => (window as ProbeWindow).__outlineProbe);
            },
          ],
          [
            'server',
            async () => {
              lastServer = await server(page, projectId);
            },
          ],
          [
            'localStorage',
            async () => {
              if (page.isClosed()) throw new Error('Page closed');
              lastLocalStorage = await page.evaluate(() =>
                Object.fromEntries(
                  Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
                ),
              );
            },
          ],
          [
            'screenshot',
            async () => {
              if (page.isClosed()) throw new Error('Page closed');
              await page.screenshot({ path: info.outputPath('finally.png') });
            },
          ],
        ] as const) {
          try {
            await capture();
          } catch (error) {
            output.push({
              phase: 'finally',
              capture: name,
              availability: 'NOT_AVAILABLE',
              error: String(error),
            });
          }
          await writeRaw(lastCheckpoint);
        }
        await info.attach(`e11-outline-${scenario}-${width}-raw`, {
          path: rawPath,
          contentType: 'application/json',
        });
      }
    });
  }
