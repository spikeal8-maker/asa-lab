// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CrmSeatDetail } from '../CrmSeatDetail';
import { crmApi, type CrmSeatDetailPage } from '../crm-user-api';
let host: HTMLDivElement, root: Root;
const subject = {
  kind: 'student' as const,
  targetId: '20000000-0000-4000-8000-000000000001',
  classroomId: '20000000-0000-4000-8000-000000000002',
};
const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('uses exact Seat/class for retained detail and ignores a late old subject page', async () => {
  let finish!: (value: ReturnType<typeof ok<CrmSeatDetailPage>>) => void;
  const read = vi
    .spyOn(crmApi, 'seatDetail')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(
      ok({
        items: [
          { id: 'new', title: 'Новый ученик', type: 'project', occurredAt: '2026-10-25T10:00:00Z' },
        ],
        next: null,
      }),
    );
  await act(async () =>
    root.render(createElement(CrmSeatDetail, { subject, onAccessDenied: vi.fn() })),
  );
  const next = { ...subject, targetId: '20000000-0000-4000-8000-000000000003' };
  await act(async () =>
    root.render(createElement(CrmSeatDetail, { subject: next, onAccessDenied: vi.fn() })),
  );
  await act(async () =>
    finish(
      ok({
        items: [{ id: 'old', text: 'PRIVILEGED_OLD', occurredAt: '2026-10-25T10:00:00Z' }],
        next: null,
      }),
    ),
  );
  expect(read).toHaveBeenLastCalledWith(next, 'projects', null);
  expect(host.textContent).toContain('Новый ученик');
  expect(host.textContent).not.toContain('PRIVILEGED_OLD');
});
it('renders immutable note text literally, clears retained data after denial and sends concurrency version', async () => {
  const denied = vi.fn();
  vi.spyOn(crmApi, 'seatDetail').mockResolvedValue(
    ok({
      items: [{ id: 'note', text: '<script>literal</script>', occurredAt: '2026-10-25T10:00:00Z' }],
      next: null,
      version: 'a'.repeat(64),
      canWrite: true,
    }),
  );
  const add = vi.spyOn(crmApi, 'addSeatNote').mockResolvedValue({
    ok: false,
    status: 403,
    error: { code: 'crm_forbidden', message: 'Нет доступа' },
  });
  await act(async () =>
    root.render(createElement(CrmSeatDetail, { subject, notes: true, onAccessDenied: denied })),
  );
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toContain('<script>literal</script>');
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(add.mock.calls[0][1].version).toBe('a'.repeat(64));
  expect(denied).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('<script>literal</script>');
});
it('keeps archived note history readable but never offers a form without current canWrite', async () => {
  const add = vi.spyOn(crmApi, 'addSeatNote');
  const read = vi
    .spyOn(crmApi, 'seatDetail')
    .mockResolvedValue(
      ok({
        items: [
          { id: 'retained', text: 'Сохранённая заметка', occurredAt: '2026-10-25T10:00:00Z' },
        ],
        next: null,
        version: 'a'.repeat(64),
        canWrite: false,
      }),
    );
  await act(async () =>
    root.render(createElement(CrmSeatDetail, { subject, notes: true, onAccessDenied: vi.fn() })),
  );
  expect(host.textContent).toContain('Сохранённая заметка');
  expect(host.querySelector('form')).toBeNull();
  expect(add).not.toHaveBeenCalled();
  read.mockResolvedValue(ok({ items: [], next: null, version: 'a'.repeat(64) }));
  await act(async () =>
    [...host.querySelectorAll('button')].find((x) => x.textContent === 'Обновить')!.click(),
  );
  expect(host.querySelector('form')).toBeNull();
});
