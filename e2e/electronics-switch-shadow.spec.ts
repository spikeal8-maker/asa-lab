import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { configureProductionLibrary } from '../apps/web/src/electronics/production-manifest-adapter';
import { addComponentToDocument } from '../apps/web/src/electronics/workbench-document';
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

const SWITCH = 'shadow-switch';
const BUTTON = 'control-button';
const glow = /25, 151, 205/;

type ReadyFrame = {
  requested: number;
  committed: number;
  status: string;
  solved: boolean | null;
  qualityPassed: boolean;
  finite: boolean;
  at: number;
};
type ShadowProbe = {
  frames: Array<{ at: number; response: unknown }>;
  latest: ReadyFrame | null;
  inputs: Array<{ type: string; trusted: boolean; component: string | null; at: number }>;
};
type ProbeWindow = Window & { __switchShadowProbe?: ShadowProbe };

function documentFixture(): SchematicDocument {
  let document: SchematicDocument = {
    schemaVersion: 4,
    components: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  for (const [variant, id, x, y] of [
    ['battery-holder-aa-2', 'source', 120, 120],
    ['resistor-axial', 'load', 260, 120],
    ['switch-spdt', SWITCH, 160, 260],
    ['button-tactile-6mm', BUTTON, 290, 260],
  ] as const) {
    document = addComponentToDocument(document, variant, { x, y }, id).document;
  }
  document = {
    ...document,
    components: document.components.map((component) =>
      component.id === 'load' ? { ...component, value: 220 } : component,
    ),
    connections: [
      {
        id: 'positive-common',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: SWITCH, terminal: 'common' },
        color: '#e3212b',
        vertices: [{ x: 110, y: 240 }],
      },
      ...(['throw-left', 'throw-right'] as const).map((terminal, index) => ({
        id: `throw-load-${index}`,
        from: { componentId: SWITCH, terminal },
        to: { componentId: 'load', terminal: 'lead-1' },
        color: '#149447',
        vertices: [{ x: 220 + index * 15, y: 220 }],
      })),
      {
        id: 'load-negative',
        from: { componentId: 'load', terminal: 'lead-2' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [{ x: 340, y: 90 }],
      },
    ],
  };
  return document;
}

async function installObserver(page: Page) {
  await page.addInitScript(() => {
    const probe: ShadowProbe = { frames: [], latest: null, inputs: [] };
    (window as ProbeWindow).__switchShadowProbe = probe;
    for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          probe.inputs.push({
            type,
            trusted: event.isTrusted,
            component:
              target?.closest('[data-component-id]')?.getAttribute('data-component-id') ?? null,
            at: performance.now(),
          });
          if (probe.inputs.length > 2000) throw new Error('SPDT native input observer overflow');
        },
        true,
      );
    }
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(target, thisArg, messages) {
            if ((messages[0] as { kind?: string })?.kind === 'preflight') probe.latest = null;
            return Reflect.apply(target, thisArg, messages);
          },
        });
        worker.addEventListener('message', (event: MessageEvent) => {
          const response = event.data as {
            ok?: boolean;
            kind?: string;
            advance?: {
              requestedHorizonMicroseconds: number;
              committedHorizonMicroseconds: number;
              executionStatus: string;
              result?: { solved: boolean; quality: { passed: boolean; finite: boolean } } | null;
            };
          };
          const at = performance.now();
          probe.frames.push({ at, response: event.data });
          if (probe.frames.length > 2000) throw new Error('SPDT real Worker observer overflow');
          if (response.ok && response.kind === 'advance' && response.advance) {
            probe.latest = {
              requested: response.advance.requestedHorizonMicroseconds,
              committed: response.advance.committedHorizonMicroseconds,
              status: response.advance.executionStatus,
              solved: response.advance.result?.solved ?? null,
              qualityPassed: response.advance.result?.quality.passed === true,
              finite: response.advance.result?.quality.finite === true,
              at,
            };
          }
        });
        return worker;
      },
    });
  });
}

function component(page: Page, id: string) {
  return page.locator(`[data-testid="schematic-component"][data-component-id="${id}"]`);
}

async function neutralSelection(page: Page) {
  const point = await page.locator('.workbench-canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    for (const ry of [0.15, 0.85, 0.25, 0.75, 0.5]) {
      for (const rx of [0.15, 0.85, 0.25, 0.75, 0.5]) {
        const x = rect.left + rect.width * rx;
        const y = rect.top + rect.height * ry;
        if (document.elementFromPoint(x, y)?.classList.contains('workbench-grid-hit'))
          return { x, y };
      }
    }
    throw new Error('No native empty-grid selection target');
  });
  await page.mouse.click(point.x, point.y);
  await expect(component(page, SWITCH)).not.toHaveClass(/workbench-component-selected/);
}

async function capture(page: Page, phase: string, info: TestInfo) {
  const sample = await component(page, SWITCH).evaluate(async (group) => {
    const part = group.querySelector<SVGGraphicsElement>('.workbench-part')!;
    // Read the computed style to flush the real CSS transition, then wait only
    // for that existing finite animation. No style or clock is modified.
    const transitionFilter = getComputedStyle(part).filter;
    await Promise.all(part.getAnimations().map((animation) => animation.finished));
    const actuator = group.querySelector('[data-testid="spdt-actuator"] > g')!;
    const rect = group.querySelector('[data-testid="spdt-actuator"]')!.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const active = document.activeElement;
    return {
      transitionFilter,
      filter: getComputedStyle(part).filter,
      className: group.getAttribute('class'),
      selected: group.classList.contains('workbench-component-selected'),
      active: group.classList.contains('workbench-component-actuator-active'),
      selectionMarks: group.querySelectorAll('.workbench-tinkercad-selection').length,
      actuatorTransform: actuator.getAttribute('transform'),
      focus: {
        tag: active?.tagName,
        className: active?.getAttribute('class'),
        component:
          active?.closest('[data-component-id]')?.getAttribute('data-component-id') ?? null,
        partFocused: active === part,
      },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: {
        width: innerWidth,
        height: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
      },
      actuatorHit: Boolean(hit?.closest('[data-testid="spdt-actuator"]')),
      darkPreference: matchMedia('(prefers-color-scheme: dark)').matches,
      stageBackground: getComputedStyle(document.querySelector('.workbench-stage')!)
        .backgroundColor,
      viewBox: document.querySelector('.workbench-canvas')?.getAttribute('viewBox'),
      ready: (window as ProbeWindow).__switchShadowProbe?.latest,
    };
  });
  expect(sample.rect.width).toBeGreaterThan(0);
  expect(sample.rect.x).toBeGreaterThanOrEqual(0);
  expect(sample.rect.y).toBeGreaterThanOrEqual(0);
  expect(sample.rect.x + sample.rect.width).toBeLessThanOrEqual(sample.viewport.width);
  expect(sample.rect.y + sample.rect.height).toBeLessThanOrEqual(sample.viewport.height);
  expect(sample.actuatorHit).toBe(true);
  expect(sample.viewport.pageWidth).toBeLessThanOrEqual(sample.viewport.width + 1);
  const path = info.outputPath(`${phase}.png`);
  await page.screenshot({ path });
  await info.attach(phase, { path, contentType: 'image/png' });
  return { phase, ...sample };
}

async function actuate(page: Page, on: boolean) {
  const group = component(page, SWITCH);
  const before = await page.evaluate(
    () => (window as ProbeWindow).__switchShadowProbe!.inputs.length,
  );
  await group.getByTestId('spdt-actuator').click();
  if (on) await expect(group).toHaveClass(/workbench-component-actuator-active/);
  else await expect(group).not.toHaveClass(/workbench-component-actuator-active/);
  const inputs = await page.evaluate(
    (before) => (window as ProbeWindow).__switchShadowProbe!.inputs.slice(before),
    before,
  );
  expect(
    inputs.some(
      (event) => event.type === 'pointerdown' && event.trusted && event.component === SWITCH,
    ),
  ).toBe(true);
  expect(
    inputs.some((event) => event.type === 'click' && event.trusted && event.component === SWITCH),
  ).toBe(true);
}

async function runReady(page: Page) {
  await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Остановить моделирование', exact: true }),
  ).toHaveAttribute('data-simulation-status', 'running');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const frame = (window as ProbeWindow).__switchShadowProbe?.latest;
        return Boolean(
          frame &&
          frame.status === 'ready' &&
          frame.solved === true &&
          frame.qualityPassed &&
          frame.finite &&
          Number.isSafeInteger(frame.committed) &&
          frame.committed === frame.requested,
        );
      }),
    )
    .toBe(true);
}

async function checkControlButton(page: Page) {
  const part = component(page, BUTTON).locator('.workbench-part');
  const point = await part.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (
      document
        .elementFromPoint(x, y)
        ?.closest('[data-component-id]')
        ?.getAttribute('data-component-id') !== 'control-button'
    )
      throw new Error('Control button body is not a native reachable target');
    return { x, y };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  try {
    await expect(component(page, BUTTON)).toHaveClass(/workbench-component-actuator-active/);
    const filter = await part.evaluate(async (element) => {
      void getComputedStyle(element).filter;
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
      return getComputedStyle(element).filter;
    });
    expect(filter).toMatch(glow);
    return { filter, pressed: true };
  } finally {
    await page.mouse.up();
  }
}

async function matrix(
  page: Page,
  prefix: string,
  info: TestInfo,
  samples: unknown[],
  full: boolean,
) {
  await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
  for (const zoom of full ? ['fit', 'in', 'out'] : ['fit']) {
    if (zoom === 'in')
      await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
    if (zoom === 'out')
      await page.getByRole('button', { name: 'Уменьшить масштаб', exact: true }).click();
    const phase = `${prefix}-${zoom}`;
    await runReady(page);
    await neutralSelection(page);
    const off = await capture(page, `${phase}-off-unselected`, info);
    samples.push(off);
    expect(off.active).toBe(false);
    expect(off.selectionMarks).toBe(0);
    await actuate(page, true);
    await neutralSelection(page);
    const on = await capture(page, `${phase}-on-unselected`, info);
    samples.push(on);
    expect(on.active).toBe(true);
    expect(on.selectionMarks).toBe(0);
    expect(on.actuatorTransform).not.toBe(off.actuatorTransform);
    expect(on.focus).toEqual(off.focus);
    expect(on.focus.partFocused, 'Primary shadow proof uses an unfocused part').toBe(false);
    // These assertions intentionally fail on unchanged production BEFORE. Soft
    // assertions preserve all later native states and whole Save/reopen evidence.
    expect
      .soft(on.filter, `${phase}: ON must preserve ordinary unfocused OFF shadow`)
      .toBe(off.filter);
    expect
      .soft(on.filter, `${phase}: SPDT has no extra generic blue active glow`)
      .not.toMatch(glow);
    await component(page, SWITCH).locator('.workbench-part').press('Enter');
    const selectedOn = await capture(page, `${phase}-on-selected`, info);
    samples.push(selectedOn);
    expect(selectedOn.selected).toBe(true);
    expect(selectedOn.selectionMarks).toBeGreaterThan(0);
    await actuate(page, false);
    const selectedOff = await capture(page, `${phase}-off-selected`, info);
    samples.push(selectedOff);
    expect(selectedOff.selected).toBe(true);
    expect(selectedOff.selectionMarks).toBe(selectedOn.selectionMarks);
    expect(selectedOff.actuatorTransform).toBe(off.actuatorTransform);
    expect(selectedOff.focus).toEqual(selectedOn.focus);
    expect
      .soft(selectedOn.filter, `${phase}: selection/focus remains separate from ON glow`)
      .toBe(selectedOff.filter);
    samples.push({ phase: `${phase}-other-component`, control: await checkControlButton(page) });
    await actuate(page, true);
    await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Начать моделирование', exact: true }),
    ).toBeVisible();
    const stopped = await capture(page, `${phase}-stopped`, info);
    samples.push(stopped);
    expect(stopped.active).toBe(false);
    expect(stopped.filter).not.toMatch(glow);
    expect(stopped.actuatorTransform).toBe(off.actuatorTransform);
    await neutralSelection(page);
    const stoppedUnselected = await capture(page, `${phase}-stopped-unselected`, info);
    samples.push(stoppedUnselected);
    expect(stoppedUnselected.selected).toBe(false);
    expect(stoppedUnselected.selectionMarks).toBe(0);
    await component(page, SWITCH).getByTestId('spdt-actuator').click();
    const stoppedClick = await capture(page, `${phase}-stopped-click`, info);
    samples.push(stoppedClick);
    expect(stoppedClick.active).toBe(false);
    expect(stoppedClick.actuatorTransform).toBe(stopped.actuatorTransform);
  }
}

async function serverDraft(page: Page, projectId: string) {
  const response = await page.context().request.get(`/api/projects/${projectId}`, {
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    draft: { revision: number; document: SchematicDocument; updatedAt: string };
  };
}

let admin: pg.Pool;
test.beforeAll(() => {
  admin = e2eAdminPool();
});
test.afterAll(async () => {
  await admin.end();
});

for (const width of [1440, 1024, 390, 320]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`SPDT extra ON shadow: native states save reopen ${width}px ${colorScheme}`, async ({
      page,
      browser,
    }, info) => {
      const samples: unknown[] = [];
      const puts: unknown[] = [];
      const teacher = await seedTeacher(
        admin,
        `e2e-spdt-shadow-${width}-${colorScheme}-${info.workerIndex}-${info.retry}`,
      );
      const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme });
      await installObserver(page);
      await loginWithOrganization(page, teacher);
      const sessionResponse = await page.context().request.get('/api/auth/me');
      expect(sessionResponse.status()).toBe(200);
      const session = (await sessionResponse.json()) as {
        authenticated: boolean;
        user: { id: string };
      };
      expect(session.authenticated).toBe(true);
      const created = await page.context().request.post('/api/projects', {
        headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
        data: {
          scope: 'personal',
          classroomId: null,
          module: 'electronics',
          title: `Переключатель ${width} ${colorScheme}`,
        },
      });
      expect(created.status()).toBe(201);
      const projectId = ((await created.json()) as { project: { id: string } }).project.id;
      const empty = await serverDraft(page, projectId);
      const fixture = documentFixture();
      const seeded = await page.context().request.put(`/api/projects/${projectId}/draft`, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          document: fixture,
          baseRevision: empty.draft.revision,
          mutationId: crypto.randomUUID(),
        },
      });
      expect(seeded.status()).toBe(200);
      const seed = await serverDraft(page, projectId);
      expect(seed.draft.document).toEqual(fixture);
      page.on('request', (request) => {
        if (
          request.method() === 'PUT' &&
          new URL(request.url()).pathname === `/api/projects/${projectId}/draft`
        )
          puts.push(request.postDataJSON());
      });
      let reopenedProbe: unknown = null;
      let savedProof: unknown = null;
      try {
        await page.goto(`/#/home/${projectId}`);
        await expect(page.locator('.workbench-stage')).toBeVisible();
        const collapse = page.getByRole('button', { name: 'Свернуть библиотеку', exact: true });
        if (await collapse.isVisible()) await collapse.click();
        await page.setViewportSize({ width, height: 900 });
        await matrix(page, 'initial', info, samples, true);
        expect((await serverDraft(page, projectId)).draft).toEqual(seed.draft);
        expect(puts).toHaveLength(0);
        // A real explicit edit supplies a durable whole-document Save proof;
        // runtime switch/button/Run/Stop state is not a project mutation.
        await page.setViewportSize({ width: 1440, height: 900 });
        await component(page, 'load').locator('.workbench-part').press('Enter');
        const input = page
          .locator('.workbench-inspector label')
          .filter({ hasText: 'Сопротивление' })
          .locator('input[type="number"]');
        await input.fill('333.3');
        await expect(input).toHaveValue('333.3');
        const key = `asa-project-local-draft:user:account:${encodeURIComponent(session.user.id)}:${encodeURIComponent(projectId)}`;
        const whole = await page.evaluate(
          ({ key, userId, projectId }) => {
            const raw = localStorage.getItem(key);
            if (!raw) throw new Error('Missing full scoped local draft for explicit edit');
            const record = JSON.parse(raw);
            if (
              record.schemaVersion !== 3 ||
              record.identityKind !== 'account' ||
              record.userId !== userId ||
              record.projectId !== projectId ||
              record.moduleKey !== 'electronics'
            )
              throw new Error('Local draft identity or scope mismatch');
            return record.document as SchematicDocument;
          },
          { key, userId: session.user.id, projectId },
        );
        expect(whole.components).toHaveLength(4);
        expect(whole.components).toEqual(
          fixture.components.map((item) => (item.id === 'load' ? { ...item, value: 333.3 } : item)),
        );
        expect(whole.connections).toEqual(fixture.connections);
        expect(whole.components.find((item) => item.id === 'load')?.value).toBe(333.3);
        await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
        await expect
          .poll(async () => (await serverDraft(page, projectId)).draft.document)
          .toEqual(whole);
        const saved = await serverDraft(page, projectId);
        expect(saved.draft.revision).toBe(seed.draft.revision + 1);
        expect(puts).toHaveLength(1);
        savedProof = { seed: seed.draft, wholeEdited: whole, saved: saved.draft, puts };
        const fresh = await browser.newContext({
          baseURL: new URL(page.url()).origin,
          viewport: { width, height: 900 },
          colorScheme,
        });
        try {
          await fresh.addCookies(await page.context().cookies());
          const reopened = await fresh.newPage();
          const freshFailures = collectBrowserFailures(reopened, {
            allowAnonymousSessionProbe: true,
          });
          await installObserver(reopened);
          try {
            await reopened.goto(`/#/home/${projectId}`);
            await expect(reopened.locator('.workbench-stage')).toBeVisible();
            expect(
              await reopened.evaluate(() =>
                Object.keys(localStorage).filter((key) =>
                  key.startsWith('asa-project-local-draft:'),
                ),
              ),
            ).toEqual([]);
            expect((await serverDraft(reopened, projectId)).draft).toEqual(saved.draft);
            await component(reopened, 'load').locator('.workbench-part').press('Enter');
            await expect(
              reopened
                .locator('.workbench-inspector label')
                .filter({ hasText: 'Сопротивление' })
                .locator('input[type="number"]'),
            ).toHaveValue('333.3');
            await neutralSelection(reopened);
            const collapse = reopened.getByRole('button', {
              name: 'Свернуть библиотеку',
              exact: true,
            });
            if (await collapse.isVisible()) await collapse.click();
            await matrix(reopened, 'cookies-reopen', info, samples, false);
            expect((await serverDraft(reopened, projectId)).draft).toEqual(saved.draft);
            freshFailures.assertEmpty();
          } finally {
            reopenedProbe = await reopened.evaluate(
              () => (window as ProbeWindow).__switchShadowProbe,
            );
          }
        } finally {
          await fresh.close();
        }
        failures.assertEmpty();
      } finally {
        const path = info.outputPath('switch-shadow-actual.json');
        await writeFile(
          path,
          JSON.stringify(
            {
              width,
              colorScheme,
              projectId,
              baselineDocument: fixture,
              samples,
              savedProof,
              puts,
              originalProbe: await page.evaluate(() => (window as ProbeWindow).__switchShadowProbe),
              reopenedProbe,
              server: await serverDraft(page, projectId),
            },
            null,
            2,
          ),
          'utf8',
        );
        await info.attach('switch-shadow-actual', { path, contentType: 'application/json' });
        await page.screenshot({ path: info.outputPath('switch-shadow-final.png') });
      }
    });
  }
}
