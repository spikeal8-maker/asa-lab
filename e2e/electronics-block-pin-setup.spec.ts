import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { devices, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { SchematicDocument } from '../apps/web/src/api';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

// Immutable public revision dc6cd288-1334-429e-95be-d9edd952b86a. Only the
// public-view wrapper is converted to an editable project; owner data is intact.
const owner = JSON.parse(
  readFileSync(resolve('e2e/fixtures/owner-7ad29bb5-pin-setup-document.json'), 'utf8'),
) as SchematicDocument;
const ownerBoard = owner.components.find((c) => c.componentTypeId === 'arduino-uno')!;
const pins = [
  ...Array.from({ length: 14 }, (_, n) => String(n)),
  ...Array.from({ length: 6 }, (_, n) => `A${n}`),
];
const board = (doc: SchematicDocument, id = ownerBoard.id) =>
  doc.components.find((c) => c.id === id)!;
const source = (doc: SchematicDocument, id = ownerBoard.id) =>
  String(board(doc, id).stateProperties?.['arduinoSource']);
const workspace = (doc: SchematicDocument, id = ownerBoard.id) =>
  JSON.parse(String(board(doc, id).stateProperties?.['arduinoWorkspace']));

const touchPages = new WeakSet<Page>();

async function activate(control: Locator) {
  if (touchPages.has(control.page())) await control.tap();
  else await control.click();
}

async function checkInput(control: Locator) {
  await expect(control).not.toBeChecked();
  await activate(control);
  await expect(control).toBeChecked();
}

// Inspect rendered text, not just the checkbox rectangle. Each control may be
// scrolled into view, but only the modal may own that vertical scrolling.
async function settingsLayout(page: Page, dialog: Locator, info: TestInfo) {
  const snapshot = () =>
    dialog.evaluate((element) => ({
      top: element.scrollTop,
      height: element.clientHeight,
      contentHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      rect: element.getBoundingClientRect().toJSON(),
      pageX: window.scrollX,
      pageY: window.scrollY,
      ancestors: Array.from(
        (function* () {
          for (let node = element.parentElement; node; node = node.parentElement) yield node;
        })(),
      ).map((node) => ({ tag: node.tagName, top: node.scrollTop, left: node.scrollLeft })),
    }));
  const before = await snapshot();
  expect(before.overflowY).toMatch(/auto|scroll/);
  const evidence: unknown[] = [];
  const captions = dialog.locator('header strong, p, legend, label, footer button');
  for (const caption of await captions.all()) {
    await caption.scrollIntoViewIfNeeded();
    await expect(caption).toBeInViewport();
    const bounds = await caption.evaluate((element) => {
      const modal = element.closest('[role="dialog"]')!;
      const modalRect = modal.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = [...range.getClientRects()];
      const tolerance = 1;
      const inside = (r: DOMRect, outer: DOMRect) =>
        r.left >= outer.left - tolerance &&
        r.right <= outer.right + tolerance &&
        r.top >= outer.top - tolerance &&
        r.bottom <= outer.bottom + tolerance;
      return {
        text: element.textContent,
        bounded:
          inside(rect, modalRect) &&
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight,
        fullText: lines.length > 0 && lines.every((line) => inside(line, rect)),
        noClipping: [...element.querySelectorAll('*'), element].every(
          (node) =>
            node.scrollWidth <= node.clientWidth + tolerance &&
            node.scrollHeight <= node.clientHeight + tolerance,
        ),
        modalNoHorizontalOverflow: modal.scrollWidth <= modal.clientWidth + tolerance,
        pageNoHorizontalOverflow:
          document.documentElement.scrollWidth <= innerWidth &&
          document.body.scrollWidth <= innerWidth,
      };
    });
    expect(bounds, `complete caption: ${bounds.text}`).toMatchObject({
      bounded: true,
      fullText: true,
      noClipping: true,
      modalNoHorizontalOverflow: true,
      pageNoHorizontalOverflow: true,
    });
    evidence.push(bounds);
  }
  for (const name of ['Применить', 'Отмена']) {
    const action = dialog.getByRole('button', { name, exact: true });
    await action.focus();
    await expect(action).toBeFocused();
    await expect(action).toBeInViewport();
  }
  const after = await snapshot();
  expect(after.pageX).toBe(before.pageX);
  expect(after.pageY).toBe(before.pageY);
  expect(after.ancestors).toEqual(before.ancestors);
  expect(after.rect).toEqual(before.rect);
  if (before.contentHeight > before.height) expect(after.top).toBeGreaterThan(before.top);
  await receipt(info, 'settings-layout', { before, after, captions: evidence });
  await info.attach('settings-actions-reached', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  // Restore the initial keyboard-trap position for the rest of the journey.
  const close = dialog.getByRole('button', { name: 'Закрыть настройки Arduino' });
  await close.focus();
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport();
}

async function receipt(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
}

async function serverDocument(page: Page, id: string): Promise<SchematicDocument> {
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).draft.document;
}

async function project(page: Page, document: SchematicDocument) {
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/projects', {
    headers: { origin, 'idempotency-key': crypto.randomUUID() },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: '944 owner pin setup',
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).project.id as string;
  const opened = await page.request.get(`/api/projects/${id}`);
  expect(opened.status()).toBe(200);
  const saved = await page.request.put(`/api/projects/${id}/draft`, {
    headers: { origin },
    data: {
      document,
      baseRevision: (await opened.json()).draft.revision,
      mutationId: crypto.randomUUID(),
    },
  });
  expect(saved.status()).toBe(200);
  await page.goto(`/#/home/${id}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await activate(page.getByRole('button', { name: 'Открыть редактор кода', exact: true }));
  return id;
}

async function settings(page: Page) {
  const menu = page.locator('.arduino-mode-menu');
  if ((await menu.getAttribute('open')) === null) await activate(menu.locator('summary'));
  await activate(page.getByRole('button', { name: 'Настройки Arduino', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Настройки Arduino', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(20);
  await expect(dialog.getByRole('button', { name: 'Закрыть настройки Arduino' })).toBeFocused();
  return dialog;
}

async function generated(page: Page) {
  const editor = page.getByRole('textbox', { name: 'Сгенерированный код Arduino', exact: true });
  await expect(editor).toBeVisible();
  return editor.inputValue();
}

function assertModes(text: string, inputs: string[]) {
  expect([...text.matchAll(/pinMode\((\w+), (INPUT|OUTPUT)\);/g)].map((m) => [m[1], m[2]])).toEqual(
    pins.map((pin) => [pin, inputs.includes(pin) ? 'INPUT' : 'OUTPUT']),
  );
  expect(text.split('void loop()')[1]).not.toContain('pinMode');
  expect(text).not.toContain('asaOutputPin');
}

async function save(page: Page, id: string, expected?: SchematicDocument) {
  const request = page.waitForRequest(
    (r) => r.method() === 'PUT' && new URL(r.url()).pathname === `/api/projects/${id}/draft`,
  );
  const saveButton = page.getByRole('button', { name: 'Сохранить проект', exact: true });
  await saveButton.scrollIntoViewIfNeeded();
  await expect(saveButton).toBeInViewport();
  await activate(saveButton);
  const sent = (await request).postDataJSON().document as SchematicDocument;
  if (expected) expect(sent).toEqual(expected);
  await expect(page.locator('.workbench-main')).toHaveAttribute(
    'data-project-save-status',
    'saved',
  );
  const persisted = await serverDocument(page, id);
  expect(persisted).toEqual(sent);
  return { sent, persisted };
}

// Observe real production Worker messages without intercepting requests, clock,
// calculations or delivery. Keep full preflight documents and compact electrical
// samples; the engine's opaque continuation is deliberately not interpreted.
async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const journal = { documents: [] as unknown[], samples: [] as unknown[] };
    (window as Window & { pinSetupWorker?: typeof journal }).pinSetupWorker = journal;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const original = worker.postMessage.bind(worker);
        worker.postMessage = ((message: { kind?: string; document?: unknown }) => {
          if (message.kind === 'preflight') journal.documents.push(message.document);
          original(message);
        }) as Worker['postMessage'];
        worker.addEventListener('message', (event) => {
          const r = event.data;
          if (r.kind !== 'advance' || !r.ok || !r.advance.result) return;
          journal.samples.push({
            at: r.advance.committedHorizonMicroseconds,
            status: r.advance.executionStatus,
            solved: r.advance.result.solved,
            leds: r.advance.result.components.map(
              (c: {
                componentId: string;
                brightness?: number;
                current: number;
                terminalVoltages: Record<string, number>;
              }) => ({
                id: c.componentId,
                brightness: c.brightness,
                current: c.current,
                terminalVoltages: c.terminalVoltages,
              }),
            ),
            diagnostics: r.advance.diagnostics,
          });
        });
        return worker;
      },
    });
  });
}

async function boardIsolation(page: Page, info: TestInfo) {
  const text =
    '// owner text: retain spaces and newline\nvoid setup() { }\nvoid loop() { delay(10); }\n';
  const read = (id: string, type: string, pin: string, next?: unknown) => ({
    type: 'asa_var_set',
    id,
    fields: { NAME: { id: 'reading-variable' } },
    inputs: {
      VALUE: {
        block: {
          type,
          id: `${id}-read`,
          inputs: {
            PIN: {
              shadow: {
                type: type === 'asa_analog_read' ? 'asa_analog_pin' : 'asa_pin',
                id: `${id}-pin`,
                fields: { VALUE: pin },
              },
            },
          },
        },
      },
    },
    ...(next ? { next: { block: next } } : {}),
  });
  const blocks = JSON.stringify({
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'asa_setup',
          id: 'settings-setup',
          x: 24,
          y: 24,
          inputs: {
            DO: {
              block: {
                type: 'asa_comment',
                id: 'settings-comment',
                fields: { TEXT: 'native settings edit' },
                next: {
                  block: read(
                    'digital',
                    'asa_digital_read',
                    '2',
                    read('analog', 'asa_analog_read', 'A1'),
                  ),
                },
              },
            },
          },
        },
        { type: 'asa_loop', id: 'settings-loop', x: 24, y: 240 },
      ],
    },
    variables: [{ name: 'reading', id: 'reading-variable', type: '' }],
  });
  const a = structuredClone(ownerBoard);
  a.id = 'input-board';
  a.name = 'Input board';
  a.position = { x: 200, y: 200 };
  a.stateProperties = {
    arduinoCodeMode: 'blocks-text',
    arduinoWorkspace: blocks,
    arduinoSource: '',
    arduinoInputPins: [],
  };
  const b = structuredClone(a);
  b.id = 'text-board';
  b.name = 'Text board';
  b.position = { x: 600, y: 200 };
  b.stateProperties = {
    arduinoCodeMode: 'text',
    arduinoWorkspace: '',
    arduinoSource: text,
    arduinoInputPins: ['13'],
    arduinoSerialOpen: false,
    arduinoBaudRate: 9600,
  };
  const fixture: SchematicDocument = {
    schemaVersion: 4,
    components: [a, b],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  const id = await project(page, fixture);
  let dialog = await settings(page);
  for (const pin of ['2', 'A1']) {
    const input = dialog.getByRole('checkbox', { name: `Входной порт ${pin}`, exact: true });
    await expect(input).toBeChecked();
    await expect(input).toBeDisabled();
    await expect(input.locator('..')).toContainText('(авто)');
  }
  await activate(dialog.getByRole('button', { name: 'Применить', exact: true }));
  assertModes(await generated(page), ['2', 'A1']);
  const baseline = await save(page, id);
  const edited = page.locator(
    '[data-testid="arduino-block-workspace"] [data-id="settings-comment"] .blocklyEditableText',
  );
  await edited.scrollIntoViewIfNeeded();
  await activate(edited);
  const field = page.locator('input.blocklyHtmlInput');
  await expect(field).toBeVisible();
  await field.fill('native settings edit committed');
  await field.press('Enter');
  // Open settings immediately after a genuine Blockly field event. No fake DOM
  // input or workspace API substitutes for the pending native edit.
  dialog = await settings(page);
  await checkInput(dialog.getByRole('checkbox', { name: 'Входной порт 12', exact: true }));
  await activate(dialog.getByRole('button', { name: 'Применить', exact: true }));
  const native = await save(page, id);
  assertModes(source(native.sent, a.id), ['2', 'A1', '12']);
  expect(source(native.sent, a.id)).toContain('// native settings edit committed');
  const expectedWorkspace = workspace(baseline.sent, a.id);
  expectedWorkspace.blocks.blocks[0].inputs.DO.block.fields.TEXT = 'native settings edit committed';
  expect(workspace(native.sent, a.id)).toEqual(expectedWorkspace);
  expect(board(native.sent, b.id)).toEqual(board(baseline.sent, b.id));
  const select = page.getByRole('combobox', { name: 'Программируемая плата', exact: true });
  await select.selectOption(b.id);
  const editor = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
  await expect(editor).toHaveValue(text);
  dialog = await settings(page);
  await expect(
    dialog.getByRole('checkbox', { name: 'Входной порт 13', exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: 'Входной порт 12', exact: true }),
  ).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Входной порт 2', exact: true })).toBeEnabled();
  await checkInput(dialog.getByRole('checkbox', { name: 'Входной порт A0', exact: true }));
  await activate(dialog.getByRole('button', { name: 'Применить', exact: true }));
  const expected = structuredClone(native.persisted);
  board(expected, b.id).stateProperties!['arduinoInputPins'] = ['13', 'A0'];
  const saved = await save(page, id, expected);
  await expect(editor).toHaveValue(text);
  await select.selectOption(a.id);
  dialog = await settings(page);
  await expect(
    dialog.getByRole('checkbox', { name: 'Входной порт 12', exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: 'Входной порт A0', exact: true }),
  ).not.toBeChecked();
  await activate(dialog.getByRole('button', { name: 'Отмена', exact: true }));
  await page.reload();
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await activate(page.getByRole('button', { name: 'Открыть редактор кода', exact: true }));
  await select.selectOption(b.id);
  await expect(editor).toHaveValue(text);
  expect(await serverDocument(page, id)).toEqual(expected);
  await receipt(info, 'native-edit-board-isolation-text-preservation', {
    baseline,
    native,
    expected,
    ...saved,
    reopened: await serverDocument(page, id),
  });
}

for (const viewport of [
  { width: 1536, height: 864 },
  { width: 390, height: 844 },
]) {
  const mobile = viewport.width === 390;
  const run = test.extend({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    ...(mobile
      ? {
          userAgent: devices['Pixel 7'].userAgent,
          deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
        }
      : {}),
  });
  run(
    `944 owner setup and input settings ${viewport.width}x${viewport.height}`,
    async ({ page }, info) => {
      // New full journey budget, including real multi-effect simulation; no retries.
      test.setTimeout(180_000);
      expect(page.context().browser()?.browserType().name()).toBe('chromium');
      if (mobile) touchPages.add(page);
      const capabilities = await page.evaluate(() => ({
        touch: navigator.maxTouchPoints > 0,
        coarse: matchMedia('(pointer: coarse)').matches,
        mobileAgent: /Mobile/.test(navigator.userAgent),
      }));
      expect(capabilities).toEqual({ touch: mobile, coarse: mobile, mobileAgent: mobile });
      expect(page.viewportSize()).toEqual(viewport);
      await receipt(info, 'browser-capabilities', { viewport, mobile, ...capabilities });
      const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
      const events: unknown[] = [];
      page.on('console', (m) =>
        events.push({ kind: 'console', type: m.type(), text: m.text(), location: m.location() }),
      );
      page.on('pageerror', (e) => events.push({ kind: 'pageerror', message: e.message }));
      await observeWorker(page);
      const pool = e2eAdminPool();
      try {
        const teacher = await seedTeacher(pool, `pin-setup-944-${viewport.width}`);
        await loginWithOrganization(page, teacher);
        const document = structuredClone(owner);
        board(document).stateProperties!['arduinoCodeMode'] = 'blocks-text';
        expect(document.components).toHaveLength(21);
        expect(document.connections).toHaveLength(30);
        const id = await project(page, document);
        const originalBlocks = workspace(owner);
        // Blockly 12 omits the legacy empty scalar type on serialization.
        // Keep every other field, including saved block coordinates, exact.
        for (const variable of originalBlocks.variables ?? []) {
          if (variable.type === '') delete variable.type;
        }
        let dialog = await settings(page);
        await settingsLayout(page, dialog, info);
        for (const pin of pins) {
          const checkbox = dialog.getByRole('checkbox', {
            name: `Входной порт ${pin}`,
            exact: true,
          });
          await checkbox.scrollIntoViewIfNeeded();
          await expect(checkbox).toBeInViewport();
          await expect(checkbox).not.toBeChecked();
          expect(
            await checkbox.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              if (
                !(element instanceof HTMLInputElement) ||
                element.type !== 'checkbox' ||
                !(element.parentElement instanceof HTMLLabelElement) ||
                element.parentElement.control !== element ||
                element.closest('[role="dialog"]')?.getAttribute('aria-label') !==
                  'Настройки Arduino'
              )
                return false;
              return (
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) ===
                element
              );
            }),
            `native hit target for ${pin}`,
          ).toBe(true);
        }
        // Apply commits regenerated source and the original block document together.
        await activate(dialog.getByRole('button', { name: 'Применить', exact: true }));
        const initialSource = await generated(page);
        assertModes(initialSource, []);
        const expanded = String(ownerBoard.stateProperties!['arduinoSource']).replace(
          /\{\s*int asaOutputPin = ([^;]+);\s*pinMode\(asaOutputPin, OUTPUT\);\s*digitalWrite\(asaOutputPin, (HIGH|LOW)\);\s*\}/g,
          'digitalWrite($1, $2);',
        );
        expect(initialSource.split('void loop()')[1]!.replace(/\s/g, '')).toBe(
          expanded.split('void loop()')[1]!.replace(/\s/g, ''),
        );
        const baseline = await save(page, id);
        expect(workspace(baseline.sent)).toEqual(originalBlocks);
        expect(baseline.sent.connections).toEqual(owner.connections);
        await receipt(info, 'owner-baseline', baseline);

        dialog = await settings(page);
        await checkInput(dialog.getByRole('checkbox', { name: 'Входной порт 12', exact: true }));
        await activate(dialog.getByRole('button', { name: 'Отмена', exact: true }));
        expect(await generated(page)).toBe(initialSource);
        dialog = await settings(page);
        await expect(
          dialog.getByRole('checkbox', { name: 'Входной порт 12', exact: true }),
        ).not.toBeChecked();
        await checkInput(dialog.getByRole('checkbox', { name: 'Входной порт A0', exact: true }));
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: 'Настройки Arduino', exact: true }),
        ).toBeFocused();
        dialog = await settings(page);
        await expect(
          dialog.getByRole('checkbox', { name: 'Входной порт A0', exact: true }),
        ).not.toBeChecked();
        const close = dialog.getByRole('button', { name: 'Закрыть настройки Arduino' });
        await close.press('Shift+Tab');
        await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        for (const pin of ['12', 'A0']) {
          const checkbox = dialog.getByRole('checkbox', {
            name: `Входной порт ${pin}`,
            exact: true,
          });
          await checkbox.scrollIntoViewIfNeeded();
          if (mobile) await activate(checkbox);
          else await checkbox.press('Space');
          await expect(checkbox).toBeChecked();
        }
        await info.attach('settings', {
          body: await dialog.screenshot(),
          contentType: 'image/png',
        });
        await activate(dialog.getByRole('button', { name: 'Применить', exact: true }));
        // No debounce sleep or intermediate server poll between Apply and Save.
        const expected = structuredClone(baseline.persisted);
        board(expected).stateProperties!['arduinoInputPins'] = ['12', 'A0'];
        board(expected).stateProperties!['arduinoSource'] = initialSource
          .replace('pinMode(12, OUTPUT)', 'pinMode(12, INPUT)')
          .replace('pinMode(A0, OUTPUT)', 'pinMode(A0, INPUT)');
        const changed = await save(page, id, expected);
        assertModes(await generated(page), ['12', 'A0']);
        await receipt(info, 'desired-request-server', { expected, ...changed });

        await activate(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }));
        expect(await generated(page)).toBe(initialSource);
        dialog = await settings(page);
        await expect(
          dialog.getByRole('checkbox', { name: 'Входной порт 12', exact: true }),
        ).not.toBeChecked();
        await activate(dialog.getByRole('button', { name: 'Отмена', exact: true }));
        await activate(page.getByRole('button', { name: 'Повторить (Ctrl+Shift+Z)', exact: true }));
        expect(await generated(page)).toBe(source(expected));
        dialog = await settings(page);
        for (const pin of ['12', 'A0'])
          await expect(
            dialog.getByRole('checkbox', { name: `Входной порт ${pin}`, exact: true }),
          ).toBeChecked();
        await activate(dialog.getByRole('button', { name: 'Отмена', exact: true }));
        await page.reload();
        await expect(page.locator('.workbench-stage')).toBeVisible();
        await activate(page.getByRole('button', { name: 'Открыть редактор кода', exact: true }));
        expect(await generated(page)).toBe(source(expected));
        expect(await serverDocument(page, id)).toEqual(expected);
        dialog = await settings(page);
        for (const pin of ['12', 'A0'])
          await expect(
            dialog.getByRole('checkbox', { name: `Входной порт ${pin}`, exact: true }),
          ).toBeChecked();
        await activate(dialog.getByRole('button', { name: 'Отмена', exact: true }));
        await receipt(info, 'reopened', await serverDocument(page, id));

        await activate(page.getByRole('button', { name: 'Закрыть панель кода', exact: true }));
        await activate(page.getByRole('button', { name: 'Начать моделирование', exact: true }));
        const observations = () =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  pinSetupWorker?: {
                    documents: SchematicDocument[];
                    samples: Array<{
                      at: number;
                      solved: boolean;
                      status: string;
                      diagnostics: unknown[];
                      leds: Array<{
                        id: string;
                        brightness?: number;
                        current: number;
                        terminalVoltages: Record<string, number>;
                      }>;
                    }>;
                  };
                }
              ).pinSetupWorker!,
          );
        // Cross multiple phases of the actual owner effect sequence using committed
        // engine horizons. This is output evidence, never a wall-clock speed claim.
        await expect
          .poll(async () => (await observations()).samples.some((s) => s.at >= 22_000_000), {
            timeout: 120_000,
          })
          .toBe(true);
        const worker = await observations();
        expect(worker.documents.some((d) => source(d) === source(expected))).toBe(true);
        const ledIds = owner.components
          .filter((c) => c.componentTypeId === 'led-5mm')
          .map((c) => c.id);
        const samples = worker.samples.filter((s) => s.solved);
        expect(samples.length).toBeGreaterThan(2);
        expect(samples.every((s) => s.status !== 'fault' && s.diagnostics.length === 0)).toBe(true);
        const highPins = new Set<string>();
        for (const sample of samples) {
          for (const component of sample.leds) {
            expect(Number.isFinite(component.current)).toBe(true);
            if (component.id !== ownerBoard.id) continue;
            for (const [pin, voltage] of Object.entries(component.terminalVoltages)) {
              expect(Number.isFinite(voltage)).toBe(true);
              if (/^d(?:[0-9]|1[01])$/.test(pin) && voltage > 4) highPins.add(pin);
            }
          }
        }
        expect([...highPins].sort()).toEqual(
          Array.from({ length: 12 }, (_, pin) => `d${pin}`).sort(),
        );
        const signatures = new Set(
          samples.map((s) =>
            JSON.stringify(
              s.leds.filter((c) => ledIds.includes(c.id)).map((c) => (c.brightness ?? 0) > 0),
            ),
          ),
        );
        expect(signatures.size).toBeGreaterThan(2);
        for (const phase of [
          [0, 5_000_000],
          [5_000_000, 10_000_000],
          [10_000_000, 20_000_000],
          [20_000_000, 22_000_001],
        ]) {
          expect(
            samples.some(
              (s) =>
                s.at >= phase[0]! &&
                s.at < phase[1]! &&
                s.leds.some((c) => ledIds.includes(c.id) && (c.brightness ?? 0) > 0),
            ),
          ).toBe(true);
        }
        await receipt(info, 'worker-electrical-effects', worker);
        await info.attach('owner-effects', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await activate(page.getByRole('button', { name: 'Остановить моделирование', exact: true }));
        await page.goto('/#/home');
        await boardIsolation(page, info);
        failures.assertEmpty();
      } finally {
        await receipt(info, 'complete-console-journal', { events, counts: failures.counts });
        await pool.end();
      }
    },
  );
}
