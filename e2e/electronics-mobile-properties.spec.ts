import { writeFileSync } from 'node:fs';
import { devices, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { SchematicDocument } from '../apps/web/src/api';
import { parseElectronicsDocument } from '../contexts/electronics/domain/document';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

// Playwright owns tracing for every browser.newContext below, including the
// fresh reopen. Retain its combined trace on success as well as failure.
test.use({ trace: { mode: 'on', screenshots: true, snapshots: true, sources: true } });

// Initial API fixture only. Every measured edit/Save/gesture uses native UI input.
const parsed = parseElectronicsDocument({
  schemaVersion: 4,
  components: [
    {
      id: 'battery',
      kind: 'source',
      componentTypeId: 'battery-holder-aa-2',
      variantId: 'battery-holder-aa-2',
      name: 'Источник 3 В',
      position: { x: 450, y: 380 },
      rotation: 0,
      value: 3,
      pinIds: ['BAT-', 'BAT+'],
      stateProperties: { cells: 2, owner952: 'retain battery metadata' },
    },
    {
      id: 'resistor',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: 'R952',
      position: { x: 750, y: 380 },
      rotation: 0,
      value: 220,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: {
        resistanceUnit: 'Ω',
        tolerancePercent: 5,
        powerRatingWatt: 0.25,
        owner952: 'retain resistor metadata',
        ownerConfiguration952: '{"source":"unmodified"}',
      },
    },
    {
      id: 'led',
      kind: 'led',
      componentTypeId: 'led-5mm',
      variantId: 'led-5mm',
      name: 'LED952',
      position: { x: 1000, y: 380 },
      rotation: 0,
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: {
        ledColour: 'red',
        ledBrightness: 0,
        ledFault: 'none',
        owner952: 'retain LED metadata',
      },
    },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'battery', terminal: 'BAT+' },
      to: { componentId: 'resistor', terminal: 'lead-1' },
      color: '#e3212b',
      vertices: [{ x: 650, y: 320 }],
    },
    {
      id: 'load',
      from: { componentId: 'resistor', terminal: 'lead-2' },
      to: { componentId: 'led', terminal: 'anode' },
      color: '#149447',
      vertices: [],
    },
    {
      id: 'return',
      from: { componentId: 'led', terminal: 'cathode' },
      to: { componentId: 'battery', terminal: 'BAT-' },
      color: '#2a3035',
      vertices: [
        { x: 1100, y: 650 },
        { x: 400, y: 650 },
      ],
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
});
if (!parsed.ok) throw new Error(parsed.message);
const initial: SchematicDocument = JSON.parse(JSON.stringify(parsed.document));
const expected: SchematicDocument = {
  ...initial,
  components: initial.components.map((part) =>
    part.id === 'resistor' ? { ...part, value: 680 } : part,
  ),
};
for (const document of [initial, expected]) {
  const checked = parseElectronicsDocument(document);
  if (!checked.ok || JSON.stringify(checked.document) !== JSON.stringify(document))
    throw new Error('Task952 fixture must be canonical and parser-idempotent');
}

// Read only the committed tree that supplies the rendered stage. Never invoke
// controller methods or write React state/storage/workspace from the test.
async function committed(page: Page, project: string) {
  return page.locator('.workbench-stage').evaluate((stage, project) => {
    type Controller = {
      project?: { id: string };
      document?: SchematicDocument;
      selectedComponent?: SchematicDocument['components'][number];
      selection?: unknown;
    };
    type Fiber = {
      stateNode?: unknown;
      child?: Fiber;
      sibling?: Fiber;
      return?: Fiber;
      memoizedProps?: { controller?: Controller };
    };
    let element: Element | null = stage;
    let current: Fiber | undefined;
    while (element && !current) {
      const key = Object.keys(element).find((key) => key.startsWith('__reactContainer$'));
      if (key)
        current = (
          (element as unknown as Record<string, Fiber>)[key]!.stateNode as { current?: Fiber }
        ).current;
      element = element.parentElement;
    }
    const queue = current ? [current] : [];
    while (queue.length) {
      const node = queue.pop()!;
      if (node.stateNode === stage) {
        for (let owner = node.return; owner; owner = owner.return) {
          const controller = owner.memoizedProps?.controller;
          if (controller?.project?.id === project && controller.document)
            return {
              document: controller.document,
              selected: controller.selectedComponent,
              selection: controller.selection,
            };
        }
      }
      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
    }
    throw new Error('Actual project/controller not ready');
  }, project);
}

async function nativeDrag(page: Page, points: { x: number; y: number }[][]) {
  const session = await page.context().newCDPSession(page);
  try {
    for (let i = 0; i < points.length; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: i === 0 ? 'touchStart' : 'touchMove',
        touchPoints: points[i]!.map((point, id) => ({ id: id + 1, ...point })),
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<SVGSVGElement>('.workbench-canvas')!;
    const matrix = canvas.getScreenCTM();
    const panel = document.querySelector<HTMLElement>('.workbench-inspector');
    const rect = (node: Element) => {
      const b = node.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
    };
    return {
      canvas: rect(canvas),
      panel: rect(panel ?? canvas),
      inspectorPresent: !!panel,
      viewBox: canvas.getAttribute('viewBox'),
      matrix: matrix
        ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }
        : null,
      scrollTop: panel?.scrollTop ?? 0,
      scrollHeight: panel?.scrollHeight ?? 0,
      clientHeight: panel?.clientHeight ?? 0,
      overflowY: panel ? getComputedStyle(panel).overflowY : null,
      coarse: matchMedia('(pointer: coarse)').matches,
      userAgent: navigator.userAgent,
      scale: visualViewport?.scale,
      visualViewport: visualViewport
        ? {
            width: visualViewport.width,
            height: visualViewport.height,
            offsetTop: visualViewport.offsetTop,
            offsetLeft: visualViewport.offsetLeft,
          }
        : null,
      keyboardOpen: document.querySelector('.workbench-shell')?.getAttribute('data-keyboard-open'),
      viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      controls: [...(panel?.querySelectorAll('input,select,button') ?? [])].map((node) => ({
        tag: node.tagName,
        caption:
          node.getAttribute('aria-label') ??
          node.closest('label')?.querySelector('span')?.textContent ??
          '',
        bounds: rect(node),
      })),
      labels: [
        ...(panel?.querySelectorAll('label > span,.workbench-inspector-heading span') ?? []),
      ].map((node) => ({
        text: node.textContent,
        bounds: rect(node),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      })),
      parts: [...canvas.querySelectorAll('[data-testid="schematic-component"]')].map((node) => ({
        id: node.getAttribute('data-component-id'),
        x: node.getAttribute('data-x'),
        y: node.getAttribute('data-y'),
        transform: node.querySelector('.workbench-part')?.getAttribute('transform'),
      })),
      canvasClass: canvas.getAttribute('class'),
    };
  });
}

async function journey(page: Page, info: TestInfo, phone: boolean) {
  const admin = e2eAdminPool();
  const journal: Record<string, unknown> = { initial, expected, title: info.title };
  journal['keyboardLimit'] =
    'Native focus/keyboard events and actual visualViewport recorded; desktop Chromium emulation does not prove an OS soft keyboard.';
  const checkpoints: unknown[] = [];
  const requests: unknown[] = [];
  const replies: unknown[] = [];
  const errors: string[] = [];
  const pending = new Set<Promise<void>>();
  const write = () =>
    writeFileSync(
      info.outputPath('mobile-properties.json'),
      JSON.stringify({ ...journal, checkpoints, requests, replies, errors }, null, 2),
    );
  let project = '';
  let user = '';
  const activate = async (locator: Locator) => (phone ? locator.tap() : locator.click());
  const selectionNavigation: unknown[] = [];
  journal['selectionNavigation'] = selectionNavigation;
  const selectPart = async (target: Page, id: string, phase: string) => {
    const locator = target.locator(
      `[data-testid="schematic-component"][data-component-id="${id}"] > .workbench-part`,
    );
    if (phone) return locator.tap();
    const before = (await committed(target, project)).document;
    const ownership = () =>
      locator.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          width: rect.width,
          height: rect.height,
          owned: !!hit && node.contains(hit),
          inspector: !!hit?.closest('.workbench-inspector'),
          hit: hit?.outerHTML.slice(0, 250) ?? null,
        };
      });
    await expect(locator).toBeVisible();
    let center = await ownership();
    selectionNavigation.push({ phase, id, before: center });
    write();
    // The retained inspector can cover another part's center. Navigate through
    // the existing desktop zoom control; never move the fixture or force a hit.
    for (let step = 0; step < 3 && !center.owned && center.inspector; step++) {
      const canvas = target.locator('.workbench-canvas');
      const viewBox = await canvas.getAttribute('viewBox');
      await target.getByRole('button', { name: 'Уменьшить масштаб', exact: true }).click();
      await expect.poll(() => canvas.getAttribute('viewBox')).not.toBe(viewBox);
      center = await ownership();
      selectionNavigation.push({
        phase,
        id,
        zoomOut: step + 1,
        center,
        viewBox: await canvas.getAttribute('viewBox'),
      });
      write();
    }
    await expect
      .poll(async () => {
        center = await ownership();
        return center.owned;
      })
      .toBe(true);
    selectionNavigation.push({ phase, id, ready: center });
    write();
    expect((await committed(target, project)).document).toEqual(before);
    await locator.click();
  };
  const server = async () => {
    const response = await page.context().request.get(`/api/projects/${project}`);
    const raw = await response.text();
    checkpoints.push({ kind: 'GET', status: response.status(), raw });
    write();
    expect(response.status()).toBe(200);
    return JSON.parse(raw) as { draft: { document: SchematicDocument; revision: number } };
  };
  const checkpoint = async (name: string, doc: SchematicDocument) => {
    const actual = await committed(page, project);
    const layout = await geometry(page);
    const raw = await page.evaluate(
      ({ user, project }) => ({
        local: localStorage.getItem(
          `asa-project-local-draft:user:account:${encodeURIComponent(user)}:${encodeURIComponent(project)}`,
        ),
        events: (window as Window & { properties952?: unknown[] }).properties952,
        active: {
          tag: document.activeElement?.tagName,
          label: document.activeElement?.getAttribute('aria-label'),
        },
      }),
      { user, project },
    );
    checkpoints.push({ name, actual, layout, raw, expected: doc });
    write();
    expect(actual.document).toEqual(doc);
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport.width);
    if (raw.local) expect(JSON.parse(raw.local).document).toEqual(doc);
    return layout;
  };
  try {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 1440, height: 900 });
    const teacher = await seedTeacher(
      admin,
      `properties952-${viewport.width}-${info.workerIndex}-${info.retry}`,
    );
    await loginWithOrganization(page, teacher);
    const me = await page.context().request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    user = ((await me.json()) as { user: { id: string } }).user.id;
    const origin = new URL(page.url()).origin;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin, 'idempotency-key': crypto.randomUUID() },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Properties952 ${viewport.width}`,
      },
    });
    expect(created.status()).toBe(201);
    project = ((await created.json()) as { project: { id: string } }).project.id;
    journal['project'] = project;
    const empty = await server();
    const seeded = await page.context().request.put(`/api/projects/${project}/draft`, {
      headers: { origin },
      data: {
        baseRevision: empty.draft.revision,
        mutationId: crypto.randomUUID(),
        document: initial,
      },
    });
    journal['seedRaw'] = await seeded.text();
    expect(seeded.status()).toBe(200);
    const seed = await server();
    expect(seed.draft.document).toEqual(initial);
    journal['seed'] = seed;
    page.on('pageerror', (error) => errors.push(error.message));
    const matches = (url: string) => new URL(url).pathname === `/api/projects/${project}/draft`;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && matches(request.url())) {
        requests.push({
          at: Date.now(),
          raw: request.postData(),
          document: request.postDataJSON(),
        });
        write();
      }
    });
    page.on('response', (response) => {
      if (response.request().method() !== 'PUT' || !matches(response.url())) return;
      const promise = (async () => {
        replies.push({
          status: response.status(),
          raw: await response.text(),
          requestRaw: response.request().postData(),
        });
        write();
      })().catch((error: unknown) => {
        errors.push(`response capture: ${String(error)}`);
      });
      pending.add(promise);
      void promise.finally(() => pending.delete(promise));
    });
    const installObserver = () => {
      if ((window as Window & { properties952?: unknown[] }).properties952) return;
      const events: unknown[] = [];
      (window as Window & { properties952?: unknown[] }).properties952 = events;
      for (const type of [
        'pointerdown',
        'pointerup',
        'pointercancel',
        'touchstart',
        'touchmove',
        'touchend',
        'keydown',
        'focusin',
      ]) {
        document.addEventListener(
          type,
          (event) => {
            const pointer = event as PointerEvent;
            events.push({
              type,
              trusted: event.isTrusted,
              pointer: pointer.pointerType,
              touches: (event as TouchEvent).touches?.length,
              key: (event as KeyboardEvent).key,
              target: (event.target as Element)?.getAttribute?.('class'),
              at: performance.now(),
            });
          },
          { capture: true, passive: true },
        );
      }
    };
    await page.addInitScript(installObserver);
    await page.evaluate(installObserver);
    await page.setViewportSize(viewport);
    await page.goto(`/#/home/${project}`);
    await expect(page.getByLabel('Название проекта')).toHaveValue(
      `Properties952 ${viewport.width}`,
    );
    await expect(page.getByTestId('schematic-component')).toHaveCount(3);
    await expect.poll(async () => (await committed(page, project)).document).toEqual(initial);
    const library = page.getByRole('button', { name: 'Свернуть библиотеку', exact: true });
    if (await library.isVisible()) await activate(library);
    await activate(page.getByRole('button', { name: 'Подогнать проект', exact: true }));
    await selectPart(page, 'resistor', 'initial');
    const inspector = page.getByRole('complementary', { name: 'Параметры выделения', exact: true });
    const disclosure = inspector.locator('.workbench-properties-disclosure');
    const value = inspector.locator('.workbench-value-field input').first();
    const selected = async () => {
      const actual = await committed(page, project);
      expect(actual.selected).toEqual(actual.document.components.find((p) => p.id === 'resistor'));
      expect(actual.selected?.electricalModelId).toBe('resistor');
    };
    if (phone) {
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(value).toBeHidden();
      const folded = await checkpoint('default-folded', initial);
      expect([folded.panel.width, folded.panel.height]).toEqual([48, 48]);
      await activate(disclosure);
    } else {
      await expect(disclosure).toBeHidden();
      await expect(value).toBeVisible();
    }
    await selected();
    for (const name of ['Увеличить масштаб', 'Уменьшить масштаб']) {
      const zoom = page.getByRole('button', { name, exact: true });
      if (phone) await expect(zoom).toBeHidden();
      else await expect(zoom).toBeVisible();
    }
    const inspectLayout = async (name: string) => {
      const layout = await checkpoint(name, initial);
      expect(layout.coarse).toBe(phone);
      const invalid = [
        ...(phone && layout.panel.height >= viewport.height / 2
          ? ['panel covers half viewport']
          : []),
        ...(!['auto', 'scroll'].includes(layout.overflowY ?? '')
          ? ['inspector is not internal scroll owner']
          : []),
        ...layout.controls
          .filter(
            (c) =>
              c.bounds.width > 0 &&
              (c.bounds.x < layout.panel.x - 1 || c.bounds.right > layout.panel.right + 1),
          )
          .map((c) => c.caption),
        ...layout.labels
          .filter(
            (l) =>
              l.bounds.width > 0 &&
              (l.scrollWidth > l.clientWidth + 1 || l.bounds.right > layout.panel.right + 1),
          )
          .map((l) => l.text),
      ];
      expect(invalid, JSON.stringify(layout)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
    };
    await inspectLayout('expanded-library-closed');
    if (phone) {
      await activate(page.getByRole('button', { name: 'Открыть библиотеку', exact: true }));
      await expect(inspector).toBeVisible();
      await inspectLayout('expanded-library-open');
      // Native touch scrolling of the inspector, never document scroll writes.
      const box = await inspector.boundingBox();
      if (!box) throw new Error('Inspector missing');
      const x = box.x + box.width / 2;
      const beforeNativeScroll = await geometry(page);
      await nativeDrag(
        page,
        Array.from({ length: 9 }, (_, i) => [{ x, y: box.y + box.height * (0.85 - i * 0.075) }]),
      );
      const afterNativeScroll = await geometry(page);
      const nativeScrollEvents = await page.evaluate(
        () =>
          (
            window as Window & {
              properties952?: { type: string; trusted: boolean; touches?: number }[];
            }
          ).properties952!,
      );
      journal['nativeScroll'] = {
        before: beforeNativeScroll,
        after: afterNativeScroll,
        events: nativeScrollEvents,
      };
      write();
      expect(
        nativeScrollEvents.some(
          (event) => event.type === 'touchmove' && event.trusted && event.touches === 1,
        ),
      ).toBe(true);
      if (beforeNativeScroll.scrollHeight > beforeNativeScroll.clientHeight)
        expect(afterNativeScroll.scrollTop).toBeGreaterThan(beforeNativeScroll.scrollTop);
      await value.scrollIntoViewIfNeeded();
      await expect(value).toBeInViewport({ ratio: 1 });
      const scrolled = await checkpoint('internal-scrolled-field', initial);
      if (scrolled.scrollHeight > scrolled.clientHeight)
        expect(scrolled.scrollTop).toBeGreaterThan(0);
      await disclosure.scrollIntoViewIfNeeded();
      await expect(disclosure).toBeInViewport({ ratio: 1 });
      await activate(disclosure);
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await activate(disclosure);
      await activate(page.getByRole('button', { name: 'Свернуть библиотеку', exact: true }));
      await activate(page.getByRole('button', { name: 'Открыть редактор кода', exact: true }));
      await expect(page.getByText('Добавьте Arduino Uno R3', { exact: true })).toBeVisible();
      await expect(inspector).toBeVisible();
      await inspectLayout('partial-code-inspector');
      await activate(page.getByRole('button', { name: 'Развернуть код', exact: true }));
      await expect(inspector).toBeHidden();
      await activate(page.getByRole('button', { name: 'Код на половину экрана', exact: true }));
      await expect(inspector).toBeVisible();
      await activate(page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }));
    }
    await value.scrollIntoViewIfNeeded();
    await activate(value);
    journal['editIntentAt'] = Date.now();
    write();
    await value.fill('680');
    // Manual Save is immediate if pending; an already acknowledged save is
    // accepted only after verifying its actual full request and response.
    const save = page.getByRole('button', { name: 'Сохранить проект', exact: true });
    if (await save.isEnabled()) await activate(save);
    await expect(page.locator('.workbench-main')).toHaveAttribute(
      'data-project-save-status',
      'saved',
    );
    await expect.poll(() => replies.length).toBeGreaterThan(0);
    await checkpoint('edited-saved', expected);
    await selected();
    await Promise.all([...pending]);
    const putRows = requests as { at: number; document: { document: SchematicDocument } }[];
    expect(putRows.map((row) => row.document.document)).toEqual([expected]);
    expect(putRows[0]!.at - (journal['editIntentAt'] as number)).toBeLessThan(10_000);
    const replyRows = replies as { status: number; raw: string }[];
    expect(
      replyRows.map((row) => ({
        status: row.status,
        document: JSON.parse(row.raw).draft.document,
      })),
    ).toEqual([{ status: 200, document: expected }]);
    expect((await server()).draft.document).toEqual(expected);
    await activate(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }));
    await checkpoint('undo', initial);
    await activate(page.getByRole('button', { name: 'Повторить (Ctrl+Shift+Z)', exact: true }));
    await checkpoint('redo', expected);
    if (phone) {
      await activate(disclosure);
      await expect(value).toBeHidden();
      await activate(disclosure);
      await value.scrollIntoViewIfNeeded();
      await value.fill('');
      await value.press('Escape');
      await expect(disclosure).toBeFocused();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await checkpoint('invalid-escape-fold', expected);
      await activate(disclosure);
      await value.scrollIntoViewIfNeeded();
      await value.fill('681');
      await activate(disclosure);
      await checkpoint('valid-pending-fold', {
        ...expected,
        components: expected.components.map((p) =>
          p.id === 'resistor' ? { ...p, value: 681 } : p,
        ),
      });
      await activate(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }));
      await checkpoint('undo-pending-fold', expected);
    }
    await selectPart(page, 'led', 'switch-to-led');
    await selectPart(page, 'resistor', 'reselect-resistor');
    await selected();
    if (phone) await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await checkpoint('reselected', expected);
    if (phone) {
      const before = await geometry(page);
      const b = before.canvas;
      // Both starts are on empty upper canvas, clear of the folded inspector,
      // component bodies, terminals and controls. Translate as well as enlarge.
      const center = { x: b.x + b.width * 0.4, y: b.y + b.height * 0.22 };
      const frames = Array.from({ length: 13 }, (_, i) => [
        { x: center.x - 24 - i * 1.5 + i, y: center.y + i * 0.5 },
        { x: center.x + 24 + i * 1.5 + i, y: center.y + i * 0.5 },
      ]);
      await nativeDrag(page, frames);
      await expect.poll(async () => (await geometry(page)).viewBox).not.toBe(before.viewBox);
      const after = await checkpoint('native-pinch-pan', expected);
      journal['gesture'] = { before, after, frames };
      write();
      expect(after.parts).toEqual(before.parts);
      expect(after.matrix).not.toEqual(before.matrix);
      const beforeViewBox = before.viewBox!.trim().split(/\s+/).map(Number);
      const afterViewBox = after.viewBox!.trim().split(/\s+/).map(Number);
      // Fingers separate: zoom-in must shrink BOTH SVG world dimensions.
      // Translation alone can change x/y and the CTM without changing these.
      expect(afterViewBox[2]).toBeLessThan(beforeViewBox[2]!);
      expect(afterViewBox[3]).toBeLessThan(beforeViewBox[3]!);
      expect(after.scale).toBe(before.scale);
      expect(after.canvasClass).not.toMatch(/placing|wiring/);
      const receipts = await page.evaluate(
        () =>
          (
            window as Window & {
              properties952?: { type: string; trusted: boolean; touches?: number }[];
            }
          ).properties952!,
      );
      expect(
        receipts.some(
          (event) => event.type === 'touchmove' && event.trusted && event.touches === 2,
        ),
      ).toBe(true);
      // Background first touch follows the existing empty-canvas deselection
      // path. Record it, then use native Fit/reselection of the same model.
      journal['selectionAfterBackgroundGesture'] = (await committed(page, project)).selection;
      await activate(page.getByRole('button', { name: 'Подогнать проект', exact: true }));
      await selectPart(page, 'resistor', 'after-background-gesture');
      await selected();
      await activate(disclosure);
      await value.scrollIntoViewIfNeeded();
      await expect(value).toHaveValue('680');
      await activate(disclosure);
    }
    if (await save.isEnabled()) await activate(save);
    await expect(page.locator('.workbench-main')).toHaveAttribute(
      'data-project-save-status',
      'saved',
    );
    const saved = await server();
    expect(saved.draft.document).toEqual(expected);
    journal['saved'] = saved;
    const fresh = await page
      .context()
      .browser()!
      .newContext({
        ...(phone ? devices['Pixel 7'] : {}),
        baseURL: origin,
        viewport,
      });
    try {
      await fresh.addCookies(await page.context().cookies());
      journal['freshOrigins'] = (await fresh.storageState()).origins;
      expect(journal['freshOrigins']).toEqual([]);
      await fresh.addInitScript((origin: string) => {
        if (window !== window.top || location.origin !== origin) return;
        (window as Window & { properties952PreApp?: unknown }).properties952PreApp = {
          local: Object.keys(localStorage),
          session: Object.keys(sessionStorage),
        };
      }, origin);
      const reopened = await fresh.newPage();
      reopened.on('pageerror', (error) => errors.push(`reopened: ${error.message}`));
      reopened.on('request', (request) => {
        if (request.method() === 'PUT' && matches(request.url()))
          errors.push('Unexpected reopen PUT');
      });
      const response = reopened.waitForResponse(
        (r) =>
          r.request().method() === 'GET' &&
          new URL(r.url()).pathname === `/api/projects/${project}`,
      );
      await reopened.goto(`/#/home/${project}`);
      const preApp = await reopened.evaluate(
        () => (window as Window & { properties952PreApp?: unknown }).properties952PreApp,
      );
      journal['reopenPreAppStorage'] = preApp;
      expect(preApp).toEqual({ local: [], session: [] });
      const delivered = await response;
      expect(delivered.status()).toBe(200);
      journal['reopenRaw'] = await delivered.text();
      expect(JSON.parse(journal['reopenRaw'] as string).draft).toEqual(saved.draft);
      await expect(reopened.getByLabel('Название проекта')).toHaveValue(
        `Properties952 ${viewport.width}`,
      );
      await expect
        .poll(async () => (await committed(reopened, project)).document)
        .toEqual(expected);
      const closeLibrary = reopened.getByRole('button', {
        name: 'Свернуть библиотеку',
        exact: true,
      });
      if (await closeLibrary.isVisible()) await (phone ? closeLibrary.tap() : closeLibrary.click());
      const fit = reopened.getByRole('button', { name: 'Подогнать проект', exact: true });
      await (phone ? fit.tap() : fit.click());
      await selectPart(reopened, 'resistor', 'fresh-reopen');
      if (phone) {
        const open = reopened.getByRole('button', {
          name: 'Открыть параметры компонента',
          exact: true,
        });
        await expect(open).toHaveAttribute('aria-expanded', 'false');
        await open.tap();
      }
      const reopenedValue = reopened
        .locator('.workbench-inspector .workbench-value-field input')
        .first();
      await reopenedValue.scrollIntoViewIfNeeded();
      await expect(reopenedValue).toHaveValue('680');
      expect((await committed(reopened, project)).selected).toEqual(
        expected.components.find((p) => p.id === 'resistor'),
      );
      await reopened.screenshot({ path: info.outputPath('reopened.png') });
    } finally {
      await fresh.close();
    }
    await Promise.all([...pending]);
    // Every later Undo/Redo/fold write preserves all other parts, wires and
    // unknown metadata too; transient 681 is the explicitly authored fold edit.
    const invalidWrites = (requests as typeof putRows).flatMap((row, index) => {
      const document = row.document.document;
      const resistor = document.components.find((p) => p.id === 'resistor');
      const normalized = {
        ...document,
        components: document.components.map((p) =>
          p.id === 'resistor' ? { ...p, value: 680 } : p,
        ),
      };
      return ![220, 680, 681].includes(resistor?.value ?? NaN) ||
        JSON.stringify(normalized) !== JSON.stringify(expected)
        ? [{ index, document }]
        : [];
    });
    expect(invalidWrites).toEqual([]);
    const invalidReplies = (
      replies as { status: number; raw: string; requestRaw: string }[]
    ).flatMap((row, index) =>
      row.status !== 200 ||
      JSON.stringify(JSON.parse(row.raw).draft.document) !==
        JSON.stringify(JSON.parse(row.requestRaw).document)
        ? [{ index, ...row }]
        : [],
    );
    expect(invalidReplies).toEqual([]);
    expect(replies).toHaveLength(requests.length);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('final.png') });
  } finally {
    await Promise.all([...pending]);
    write();
    await info.attach('mobile-properties-whole-document-native-receipts', {
      path: info.outputPath('mobile-properties.json'),
      contentType: 'application/json',
    });
    await admin.end();
  }
}

// Frozen leaf titles; no describe suites. Actual phone contexts, not viewport-only.
for (const [width, height] of [
  [390, 844],
  [568, 320],
  [1536, 864],
] as const) {
  const phone = width !== 1536;
  const title = phone
    ? `mobile properties ${width}x${height}: native edit, Save/reopen and circuit pinch preserve the whole document`
    : 'desktop properties 1536x864: immediate editor, Save/reopen and Undo/Redo preserve the whole document';
  test(title, async ({ browser, baseURL }, info) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      ...(phone ? devices['Pixel 7'] : {}),
      baseURL,
      viewport: { width, height },
      hasTouch: phone,
      isMobile: phone,
    });
    try {
      await journey(await context.newPage(), info, phone);
    } finally {
      await context.close();
    }
  });
}
