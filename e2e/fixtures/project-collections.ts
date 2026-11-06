import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { telemetryReceipt } from './telemetry-receipts';
import type { api, Project } from '../../apps/web/src/api';
import type { PublicProjectList } from '../../apps/web/src/projects-public/api';

// This fixture runs the actual built SPA with controlled REST, without a
// listening server. It does not provide authorization, RLS or persistence evidence.
export const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
export const PROJECT_TITLE = 'Моя проверочная схема';
export const LONG_PROJECT_TITLE =
  'Исследование электрических цепей и полезные заметки для следующего учебного проекта';
const origin = 'http://127.0.0.1:4612';
const accountId = '20000000-0000-4000-8000-000000000001';
const workspaceId = '10000000-0000-4000-8000-000000000001';
const timestamp = '2026-10-30T12:00:00.000Z';

type HomeProjectList = Extract<Awaited<ReturnType<typeof api.listProjects>>, { ok: true }>['data'];
type HomeKnowledgeList = Extract<
  Awaited<ReturnType<typeof api.publicKnowledge>>,
  { ok: true }
>['data'];

export interface CollectionRecord {
  id: string;
  title: string;
  itemCount: number;
  createdAt: string;
}

export const COLLECTIONS: readonly CollectionRecord[] = [
  { id: 'collection-1', title: 'Избранные схемы', itemCount: 2, createdAt: timestamp },
  { id: 'collection-2', title: 'Новые идеи', itemCount: 0, createdAt: timestamp },
];

export interface ProjectCollectionsOptions {
  collections?: readonly CollectionRecord[];
  holding?: readonly string[];
  longContent?: boolean;
  emptyProjects?: boolean;
}

export type CollectionOperation = 'list' | 'holding' | 'toggle' | 'create';
export interface RequestRecord {
  operation: CollectionOperation;
  method: string;
  path: string;
  body: unknown;
}

export function picker(page: Page) {
  return page.getByRole('dialog', { name: 'Добавить в коллекцию', exact: true });
}

export async function createProjectCollectionsFixture(page: Page) {
  const dist = realpathSync(resolve('apps/web/dist'));
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  const requests: RequestRecord[] = [];
  const completed: RequestRecord[] = [];
  const diagnostics: unknown[] = [];
  const rejectedStatuses = new Set<number>();
  const pendingReleases = new Set<() => void>();
  let collections = COLLECTIONS.map((entry) => ({ ...entry }));
  let holding = new Set<string>();
  let options: ProjectCollectionsOptions = {};
  let entry: 'projects' | 'home' = 'projects';
  let created = 0;
  const controls = new Map<
    CollectionOperation,
    {
      status: number;
      wait: Promise<void>;
      release: () => void;
      started: (r: RequestRecord) => void;
    }
  >();
  page.on('pageerror', (error) => pageErrors.push(error.message));

  function pauseNext(operation: CollectionOperation, status = 200) {
    if (controls.has(operation)) throw new Error(`Already paused: ${operation}`);
    let release!: () => void;
    let started!: (request: RequestRecord) => void;
    const wait = new Promise<void>((done) => (release = done));
    const finish = () => {
      release();
      pendingReleases.delete(finish);
    };
    pendingReleases.add(finish);
    const requested = new Promise<RequestRecord>((done) => (started = done));
    controls.set(operation, { status, wait, release: finish, started });
    return { requested, release: finish };
  }

  async function response(operation: CollectionOperation, record: RequestRecord) {
    requests.push(record);
    const control = controls.get(operation);
    controls.delete(operation);
    if (!control) return 200;
    control.started(record);
    await control.wait;
    return control.status;
  }

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // The portal's optional MAX bootstrap is unrelated to this controlled UI journey.
    if (
      url.href === 'https://st.max.ru/js/max-web-app.js' &&
      request.method() === 'GET' &&
      request.resourceType() === 'script'
    )
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    if (url.origin !== origin) {
      unexpected.push(`Outside fixture origin: ${request.method()} ${url.href}`);
      return route.abort();
    }
    const path = url.pathname;
    const method = request.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (!path.startsWith('/api/')) {
      let file: string;
      try {
        file = resolve(dist, `.${decodeURIComponent(path === '/' ? '/index.html' : path)}`);
        if (
          !file.startsWith(`${dist}${sep}`) ||
          !existsSync(file) ||
          !statSync(file).isFile() ||
          !realpathSync(file).startsWith(`${dist}${sep}`)
        )
          throw new Error('Outside built SPA or missing file');
      } catch {
        unexpected.push(`Unexpected built SPA request: ${method} ${path}`);
        return route.abort();
      }
      if (method !== 'GET') {
        unexpected.push(`Unexpected static method: ${method} ${path}`);
        return route.abort();
      }
      return route.fulfill({ path: file });
    }

    // Reuse validated telemetry receipts rather than accepting arbitrary POSTs.
    const telemetry = telemetryReceipt(request);
    if (telemetry) return route.fulfill(telemetry);
    if (path === '/api/diagnostics/client' && method === 'POST') {
      const diagnostic = request.postDataJSON();
      // Only the deliberate HTTP rejections below may emit client failures.
      // JavaScript/unknown-route errors must still fail this fixture.
      expect(diagnostic).toMatchObject({
        code: 'request_failed',
        module: 'portal',
        phase: 'request',
        failureKind: 'http',
      });
      expect(rejectedStatuses.has(diagnostic.httpStatus)).toBe(true);
      diagnostics.push(diagnostic);
      return reply({ accepted: true }, 202);
    }
    if (method === 'GET') {
      // The shared portal polls its private game inbox even outside Games.
      if (
        (path === '/api/games/chess/notifications' ||
          path === '/api/games/checkers/notifications') &&
        url.search === ''
      ) {
        expect(request.headers()['x-game-presence']).toBe('1');
        return reply({ playerId: 'collections-game-player', incoming: [] });
      }
      if (path === '/api/auth/me')
        return reply({
          authenticated: true,
          user: { id: accountId, email: 'collections@example.test', displayName: 'Автор схем' },
          account: { id: accountId, email: 'collections@example.test', displayName: 'Автор схем' },
          capabilities: [{ capability: 'creator', state: 'verified' }],
          workspaces: [
            { workspaceId, kind: 'personal', title: 'Личное пространство', role: 'owner' },
          ],
          activeWorkspace: { workspaceId, kind: 'personal' },
          navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
          timeZone: 'Europe/Moscow',
        });
      if (path === '/api/account/presentation')
        return reply({ motion: 'reduce', sidebar: 'expanded', revision: 0 });
      if (path === '/api/account/avatar') return reply({ avatarDataUrl: null });
      if (path === '/api/class-join/account/assignments') return reply({ items: [] });
      if (path === '/api/projects/feedback') return reply({ items: {} });
      if (path === '/api/modules')
        return reply({
          items: [
            {
              moduleKey: 'electronics',
              displayName: 'Электроника',
              availability: 'active',
              creatable: true,
              shortDescription: 'Электрические схемы',
              defaultProjectTitlePrefix: 'Схема',
              previewKind: 'schematic',
            },
          ],
        });
      if (entry === 'home' && path === '/api/projects') {
        const module = url.searchParams.get('module');
        if (
          (module === 'three-d' ||
            module === 'electronics' ||
            module === 'blocks' ||
            module === 'robotics') &&
          url.search ===
            `?${new URLSearchParams({ scope: 'personal', module, limit: '10', excludeGames: 'true' })}`
        ) {
          const project: Project = {
            id: PROJECT_ID,
            scope: 'personal',
            classroomId: null,
            moduleKey: 'electronics',
            title: options.longContent ? LONG_PROJECT_TITLE : PROJECT_TITLE,
            status: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
            preview: null,
            snapshotRevision: null,
            copiedFrom: null,
          };
          const response: HomeProjectList = {
            items: module === 'electronics' && !options.emptyProjects ? [project] : [],
            nextCursor: null,
          };
          return reply(response);
        }
      }
      if (
        entry === 'home' &&
        path === '/api/public-projects' &&
        url.search === '?offset=0&limit=24&catalog=projects'
      ) {
        const response: PublicProjectList = { items: [], nextOffset: null };
        return reply(response);
      }
      if (
        entry === 'home' &&
        path === '/api/gallery/knowledge' &&
        url.search === '?offset=0&limit=10'
      ) {
        const response: HomeKnowledgeList = { items: [], nextOffset: null };
        return reply(response);
      }
      if (path === '/api/projects' && entry === 'projects')
        return reply({
          items: options.emptyProjects
            ? []
            : [
                {
                  id: PROJECT_ID,
                  scope: 'personal',
                  classroomId: null,
                  moduleKey: 'electronics',
                  title: options.longContent ? LONG_PROJECT_TITLE : PROJECT_TITLE,
                  status: 'active',
                  createdAt: timestamp,
                  updatedAt: timestamp,
                  preview: null,
                  snapshotRevision: null,
                  copiedFrom: null,
                },
              ],
          nextCursor: null,
        });
    }

    let operation: CollectionOperation | undefined;
    if (path === '/api/collections' && method === 'GET') operation = 'list';
    if (path === `/api/collections/holding/${PROJECT_ID}` && method === 'GET')
      operation = 'holding';
    if (path === '/api/collections' && method === 'POST') operation = 'create';
    const item = /^\/api\/collections\/([^/]+)\/items\/([^/]+)$/.exec(path);
    if (item && item[2] === PROJECT_ID && method === 'PUT') operation = 'toggle';
    if (operation) {
      const body: unknown = method === 'GET' ? null : request.postDataJSON();
      const record = { operation, method, path, body };
      const status = await response(operation, record);
      if (status !== 200) {
        rejectedStatuses.add(status);
        await reply({ error: { code: 'unavailable', message: 'Проверочный отказ' } }, status);
      } else if (operation === 'list') {
        await reply({ items: collections.map((entry) => ({ ...entry })) });
      } else if (operation === 'holding') {
        await reply({ collectionIds: [...holding] });
      } else if (operation === 'create') {
        const input = body as { title: string };
        expect(Object.keys(input)).toEqual(['title']);
        expect(input.title).toBe(input.title.trim());
        const id = `created-${++created}`;
        collections.push({ id, title: input.title, itemCount: 0, createdAt: timestamp });
        await reply({ id });
      } else {
        const input = body as { inside: boolean };
        expect(Object.keys(input)).toEqual(['inside']);
        expect(typeof input.inside).toBe('boolean');
        const entry = collections.find((entry) => entry.id === item![1]);
        expect(entry, 'Mutation must address an existing controlled collection').toBeDefined();
        if (input.inside !== holding.has(entry!.id)) entry!.itemCount += input.inside ? 1 : -1;
        if (input.inside) holding.add(entry!.id);
        else holding.delete(entry!.id);
        await reply({ ok: true });
      }
      completed.push(record);
      return;
    }

    const description = `Unexpected API request: ${method} ${path}${url.search}`;
    unexpected.push(description);
    return reply({ error: { code: 'unexpected_fixture_request', message: description } }, 501);
  });

  return {
    requests,
    completed,
    diagnostics,
    unexpected,
    pageErrors,
    pauseNext,
    failNext(operation: CollectionOperation, status = 503) {
      const control = pauseNext(operation, status);
      control.release();
      return control.requested;
    },
    async openProjects(next: ProjectCollectionsOptions = {}) {
      entry = 'projects';
      options = next;
      collections = (next.collections ?? COLLECTIONS).map((entry) => ({ ...entry }));
      holding = new Set(next.holding ?? []);
      await page.goto('/#/projects');
      await expect(page.getByRole('heading', { name: 'Мои проекты', exact: true })).toBeVisible();
      if (!next.emptyProjects) await expect(page.getByTestId('project-card')).toHaveCount(1);
    },
    async openHome(next: ProjectCollectionsOptions = {}) {
      entry = 'home';
      options = next;
      collections = (next.collections ?? COLLECTIONS).map((item) => ({ ...item }));
      holding = new Set(next.holding ?? []);
      await page.goto('/#/home');
      await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
      await expect(page.getByTestId('creator-recent-projects')).toBeVisible();
      await expect(page.getByTestId('project-card')).toHaveCount(next.emptyProjects ? 0 : 1);
    },
    async openPicker() {
      await page.getByTestId('project-card').hover();
      const menu = page.getByLabel(
        `Действия с проектом ${options.longContent ? LONG_PROJECT_TITLE : PROJECT_TITLE}`,
        { exact: true },
      );
      if (!(await menu.evaluate((element) => element.parentElement?.hasAttribute('open'))))
        await menu.click();
      await page.getByRole('button', { name: 'Добавить в коллекцию', exact: true }).click();
      await expect(picker(page)).toBeVisible();
      return picker(page);
    },
    assertClean() {
      expect(
        unexpected,
        'Every request must stay in the fixture and have an explicit handler',
      ).toEqual([]);
      expect(pageErrors, 'Actual built SPA must not throw browser errors').toEqual([]);
    },
    releaseAll() {
      for (const release of pendingReleases) release();
    },
  };
}

export type ProjectCollectionsFixture = Awaited<ReturnType<typeof createProjectCollectionsFixture>>;

export const test = base.extend<{ collectionApp: ProjectCollectionsFixture }>({
  collectionApp: async ({ page }, use) => {
    const fixture = await createProjectCollectionsFixture(page);
    try {
      await use(fixture);
      fixture.assertClean();
    } finally {
      fixture.releaseAll();
    }
  },
});

// The recorded values describe current production geometry. The 44px touch
// target policy remains unchanged and requires the later actual UI trial.
export async function capturePickerGeometry(page: Page, info: TestInfo, name: string) {
  const geometry = await picker(page).evaluate((dialog) => {
    const rect = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        right: bounds.right,
        bottom: bounds.bottom,
      };
    };
    const controls = [...dialog.querySelectorAll<HTMLElement>('input,button,label,small,h2,p')].map(
      (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          text: element.textContent,
          type: element.getAttribute('type'),
          bounds: rect(element),
          textBounds: {
            x: text.x,
            y: text.y,
            right: text.right,
            bottom: text.bottom,
            width: text.width,
            height: text.height,
          },
          minHeight: style.minHeight,
          disabled: element.matches(':disabled'),
          ariaBusy: element.getAttribute('aria-busy'),
        };
      },
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      dialog: rect(dialog),
      dialogScrollWidth: dialog.scrollWidth,
      dialogClientWidth: dialog.clientWidth,
      ariaBusy: dialog.getAttribute('aria-busy'),
      controls,
      rows: [...dialog.querySelectorAll('li')].map((row) => ({
        label: rect(row.querySelector('label')!),
        count: rect(row.querySelector('small')!),
      })),
      createControls: [
        ...dialog.querySelectorAll(
          '.collect-picker-create > input,.collect-picker-create > button',
        ),
      ].map(rect),
    };
  });
  await info.attach(`${name}-geometry`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  return geometry;
}

export function expectPickerLayout(geometry: Awaited<ReturnType<typeof capturePickerGeometry>>) {
  expect(geometry.pageWidth, 'No page-level horizontal overflow').toBeLessThanOrEqual(
    geometry.clientWidth,
  );
  expect(geometry.dialog.x).toBeGreaterThanOrEqual(0);
  expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.dialogScrollWidth, 'No clipped horizontal dialog content').toBeLessThanOrEqual(
    geometry.dialogClientWidth,
  );
  for (const row of geometry.rows) {
    expect(row.label.right, 'Collection name must not overlap its count').toBeLessThanOrEqual(
      row.count.x,
    );
  }
  const [input, create] = geometry.createControls;
  expect(
    input.right <= create.x ||
      create.right <= input.x ||
      input.bottom <= create.y ||
      create.bottom <= input.y,
    'Creation input and CTA must not overlap',
  ).toBe(true);
  for (const control of geometry.controls.filter((entry) => entry.tag === 'BUTTON')) {
    expect(control.bounds.x).toBeGreaterThanOrEqual(geometry.dialog.x);
    expect(control.bounds.right).toBeLessThanOrEqual(geometry.dialog.right);
    expect(control.bounds.y).toBeGreaterThanOrEqual(geometry.dialog.y);
    expect(control.bounds.bottom, 'CTA remains visible inside the dialog').toBeLessThanOrEqual(
      geometry.dialog.bottom,
    );
    expect(control.bounds.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(control.textBounds.x).toBeGreaterThanOrEqual(control.bounds.x);
    expect(control.textBounds.right, 'CTA label is not clipped').toBeLessThanOrEqual(
      control.bounds.right,
    );
  }
}
