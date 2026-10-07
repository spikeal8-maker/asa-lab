// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { api, type CatalogueCoursePreview, type CatalogueEntry } from '../../api';
import { CataloguePanel } from '../../components/CataloguePanel';
import { TaskBlocks } from '../../components/TaskBlocks';

const v1 = '11111111-1111-4111-8111-111111111111';
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
const v2 = '22222222-2222-4222-8222-222222222222';
const entry = (id: string): CatalogueEntry => ({
  id,
  kind: 'course',
  title: id,
  summary: null,
  moduleKey: null,
  ageBand: null,
  visibility: 'public',
  sampleImage: null,
  itemCount: 1,
  authorName: 'Author',
  authorSchool: null,
  createdAt: '',
});
const preview = (versionId = v1): CatalogueCoursePreview => ({
  versionId,
  contentHash: 'a'.repeat(32),
  destinationTenantId: v2,
  versionNumber: 1,
  title: 'Exact v1',
  summary: null,
  publishedAt: '',
  sections: [],
  pinnedItems: {},
});
let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
async function mount(onTaken = vi.fn(), register = vi.fn()) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(CataloguePanel, { modules: [], onTaken, onRegisterLeaveGuard: register }),
    );
    await flush();
  });
  return { onTaken, register };
}
async function click(name: string, within: Element = host, index = 0) {
  const button = Array.from(within.querySelectorAll('button')).filter(
    (item) => item.textContent?.trim() === name,
  )[index]!;
  expect(button).toBeTruthy();
  await act(async () => {
    button.click();
    await flush();
  });
}
function dialog() {
  return host.querySelector('[role="dialog"]')!;
}
it('accepts the contained catalogue image route but refuses a generic API or external replacement', () => {
  const hash = 'a'.repeat(64);
  const exact = `/api/catalogue/courses/${v1}/versions/${v2}/pins/${v1}/image/${hash}`;
  for (const src of [exact, '/api/admin/private-image', 'https://outside.example/image']) {
    const html = renderToStaticMarkup(
      createElement(TaskBlocks, {
        blocks: [{ type: 'image', contentHash: hash, alt: 'Pin', src }],
      }),
    );
    expect(html).toContain(
      `src="${src === exact ? exact : `/api/assignments/task-images/${hash}`}"`,
    );
  }
});
it('waits for an exact preview and ignores an older item response before freezing take', async () => {
  vi.spyOn(api, 'catalogue').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [entry('A'), entry('B')] },
  });
  let old!: (value: Awaited<ReturnType<typeof api.catalogueCourse>>) => void;
  vi.spyOn(api, 'catalogueCourse').mockImplementation((id) =>
    id === 'A'
      ? new Promise((resolve) => (old = resolve))
      : Promise.resolve({ ok: true, status: 200, data: preview(v2) }),
  );
  const take = vi.spyOn(api, 'takeFromCatalogue').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      id: v1,
      sourceVersionId: v2,
      sourceContentHash: 'a'.repeat(32),
      sourceVersionNumber: 1,
      reused: false,
    },
  });
  const { onTaken } = await mount();
  await click('Посмотреть');
  expect(
    Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === 'Забрать себе')
      ?.disabled,
  ).toBe(true);
  await click('Закрыть', dialog());
  await click('Посмотреть', host, 1);
  await act(async () => {
    old({ ok: true, status: 200, data: preview(v1) });
    await flush();
  });
  await click('Забрать себе', dialog());
  expect(take).toHaveBeenCalledWith(
    'course',
    'B',
    expect.objectContaining({ versionId: v2, destinationTenantId: v2 }),
  );
  expect(onTaken).toHaveBeenCalledWith(
    'course',
    expect.objectContaining({ id: v1, sourceVersionId: v2 }),
  );
});
it('keeps one unknown receipt across close/reopen, blocks leaving/new item and retries frozen bytes', async () => {
  vi.spyOn(api, 'catalogue').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [entry('A'), entry('B'), { ...entry('C'), kind: 'assignment' }] },
  });
  const load = vi
    .spyOn(api, 'catalogueCourse')
    .mockResolvedValue({ ok: true, status: 200, data: preview() });
  const take = vi
    .spyOn(api, 'takeFromCatalogue')
    .mockResolvedValueOnce({ ok: false, status: 0, error: { code: 'network', message: 'Lost' } })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        id: v2,
        sourceVersionId: v1,
        sourceContentHash: 'a'.repeat(32),
        sourceVersionNumber: 1,
        reused: true,
      },
    });
  const { onTaken, register } = await mount();
  await click('Посмотреть');
  await click('Забрать себе', dialog());
  const frozen = take.mock.calls[0]![2];
  expect(frozen?.requestId).toBeTruthy();
  await click('Закрыть', dialog());
  await act(async () => {
    expect(register.mock.calls[0]![0]()).toBe(false);
    await flush();
  });
  await click('Посмотреть', host, 1);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await click('Забрать себе', host, 2);
  expect(take).toHaveBeenCalledTimes(1);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await click('Подтвердить копирование');
  await click('Забрать себе', dialog());
  expect(load).toHaveBeenCalledTimes(1);
  expect(take.mock.calls[1]).toEqual(['course', 'A', frozen]);
  expect(onTaken).toHaveBeenCalledTimes(1);
  expect(register.mock.calls[0]![0]()).toBe(true);
});
it('does not claim success or discard its request when the server acknowledges another version', async () => {
  vi.spyOn(api, 'catalogue').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [entry('A')] },
  });
  vi.spyOn(api, 'catalogueCourse').mockResolvedValue({ ok: true, status: 200, data: preview() });
  vi.spyOn(api, 'takeFromCatalogue').mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: v2, sourceVersionId: v2, sourceContentHash: 'a'.repeat(32) },
  });
  const { onTaken, register } = await mount();
  await click('Посмотреть');
  await click('Забрать себе', dialog());
  expect(onTaken).not.toHaveBeenCalled();
  expect(host.textContent).toContain('не подтвердил точную копию');
  await act(async () => {
    expect(register.mock.calls[0]![0]()).toBe(false);
    await flush();
  });
});
it('allows a new attempt after a server-confirmed atomic refusal, while preserving a conflict as unknown', async () => {
  vi.spyOn(api, 'catalogue').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [entry('A')] },
  });
  vi.spyOn(api, 'catalogueCourse').mockResolvedValue({ ok: true, status: 200, data: preview() });
  vi.spyOn(api, 'takeFromCatalogue')
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'idempotency_conflict', message: 'Conflict' },
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'copy_unavailable', message: 'Atomic refusal' },
    });
  const { register } = await mount();
  await click('Посмотреть');
  await click('Забрать себе', dialog());
  await act(async () => {
    expect(register.mock.calls[0]![0]()).toBe(false);
    await flush();
  });
  await click('Забрать себе', dialog());
  expect(register.mock.calls[0]![0]()).toBe(true);
});
