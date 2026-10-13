import { describe, expect, it, vi } from 'vitest';
import { call } from './api-call';
import { journalApi } from './classroom-journal-api';
vi.mock('./api-call', () => ({ call: vi.fn() }));
const gradeInput = {
  columnId: 'column',
  seatId: 'seat',
  value: 0,
  reason: null,
  expectedRevision: 0,
  requestId: 'request-1',
};
const quickInput = {
  slotKey: '2026-10:1',
  date: '2026-10-11',
  category: 'Работа 1',
  expectedScaleVersion: 0,
  expectedHeaderRevision: 0,
  requestId: 'request-2',
  seatId: 'seat',
  value: 0,
  expectedRevision: 0,
};
describe('server confirmations for quick journal saves', () => {
  it('makes a lost GET body retryable without accepting an empty snapshot', async () => {
    vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: null });
    expect(await journalApi.read('class')).toMatchObject({
      ok: false,
      status: 0,
      error: { code: 'incomplete_response' },
    });
  });
  it.each([
    null,
    {},
    { id: 'grade', columnId: 'other', seatId: 'seat', revision: 1, value: 0 },
    { id: 'grade', columnId: 'column', seatId: 'seat', revision: 1, value: 5 },
  ])('never accepts incomplete or unrelated grade confirmation', async (data: unknown) => {
    vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data });
    expect((await journalApi.grade('class', gradeInput)).ok).toBe(false);
  });
  it('preserves zero in a matching server-confirmed grade', async () => {
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { id: 'grade', columnId: 'column', seatId: 'seat', revision: 1, value: 0 },
    });
    expect((await journalApi.grade('class', gradeInput)).ok).toBe(true);
  });
  it('treats a successful status without the atomic grade as retryable, not saved', async () => {
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { column: { id: 'column', slotKey: '2026-10:1' }, scale: { version: 1 }, grade: null },
    });
    expect(await journalApi.quick('class', quickInput)).toMatchObject({
      ok: false,
      status: 0,
      error: { code: 'incomplete_response' },
    });
  });
  it('accepts only the matching atomic slot and first grade', async () => {
    const data = {
      column: { id: 'column', slotKey: '2026-10:1' },
      scale: { version: 1 },
      grade: { id: 'grade', columnId: 'column', seatId: 'seat', revision: 1, value: 0 },
    };
    vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data });
    expect((await journalApi.quick('class', quickInput)).ok).toBe(true);
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...data, column: { ...data.column, slotKey: '2026-10:2' } },
    });
    expect((await journalApi.quick('class', quickInput)).ok).toBe(false);
  });
});
