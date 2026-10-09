import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { ClassroomJournalController, validJournalDate } from './classroom-journal.controller.js';
import type { SeatContextUseCase } from './seat-context.js';

const classId = '123e4567-e89b-42d3-a456-426614174000';
const request = {
  cookies: { asa_session: 'account-token', asa_student_session: 'seat-token' },
} as unknown as FastifyRequest;
function fixture(value: unknown = {}) {
  const query = vi.fn(async () => ({ rows: [{ value, items: [] }] }));
  const account = vi.fn(async () => ({ principalId: 'account-principal' }));
  const seat = vi.fn(async () => ({ principalId: 'seat-principal' }));
  const controller = new ClassroomJournalController(
    { resolve: account } as unknown as ActiveContextUseCase,
    { resolve: seat } as unknown as SeatContextUseCase,
    { query } as unknown as pg.Pool,
  );
  return { controller, query, account, seat };
}
describe('classroom journal controller', () => {
  it('validates real calendar dates and bounded input', async () => {
    expect(validJournalDate('2024-02-29')).toBe(true);
    for (const date of ['2026-02-29', '2026-02-30', '2026-1-01', '1999-12-31', '2101-01-01', null])
      expect(validJournalDate(date)).toBe(false);
    const f = fixture();
    const input = {
      requestId: 'request-0001',
      expectedRevision: 0,
      date: '2026-10-09',
      category: 'Работа на уроке',
    };
    for (const bad of [
      { ...input, accountId: 'spoof' },
      { ...input, category: ' ' },
      { ...input, date: '2026-02-30' },
      { ...input, expectedRevision: -1 },
    ]) {
      await expect(f.controller.write(request, classId, 'column', bad)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(f.query).not.toHaveBeenCalled();
  });
  it('teacher writes use only the Account session with mixed cookies', async () => {
    const f = fixture({ id: 'confirmed' });
    const input = { requestId: 'request-0001', expectedRevision: 0, preset: 'five' };
    expect(await f.controller.write(request, classId, 'scale', input)).toEqual({ id: 'confirmed' });
    expect(f.query).toHaveBeenCalledWith(expect.any(String), [
      'account-principal',
      classId,
      'scale',
      JSON.stringify(input),
    ]);
    expect(f.seat).not.toHaveBeenCalled();
  });
  it('Seat results ignore Account cookies and never call the Account resolver', async () => {
    const f = fixture({ items: [{ value: 0 }] });
    expect(await f.controller.seatResults(request)).toEqual({ items: [{ value: 0 }] });
    expect(f.query).toHaveBeenLastCalledWith(expect.any(String), [
      'seat-principal',
      null,
      null,
      0,
      20,
      null,
    ]);
    expect(f.account).not.toHaveBeenCalled();
    expect(f.seat).toHaveBeenCalledWith('seat-token');
  });
  it('Account learner results ignore Seat cookies and never call the Seat resolver', async () => {
    const f = fixture({ items: [{ value: 5 }] });
    expect(await f.controller.results(request)).toEqual({ items: [{ value: 5 }] });
    expect(f.query).toHaveBeenLastCalledWith(expect.any(String), [
      'account-principal',
      null,
      null,
      0,
      20,
      null,
    ]);
    expect(f.seat).not.toHaveBeenCalled();
    expect(f.account).toHaveBeenCalledWith('account-token');
  });
  it('missing or expired required cookies are 401 even with a valid other session', async () => {
    for (const missing of [false, true]) {
      const f = fixture();
      const onlyAccount = {
        cookies: {
          asa_session: 'account-token',
          ...(missing ? {} : { asa_student_session: 'expired' }),
        },
      } as unknown as FastifyRequest;
      f.seat.mockResolvedValue(null as never);
      await expect(f.controller.seatResults(onlyAccount)).rejects.toMatchObject({ status: 401 });
      expect(f.account).not.toHaveBeenCalled();
      expect(f.query).not.toHaveBeenCalled();
      const g = fixture();
      const onlySeat = {
        cookies: {
          asa_student_session: 'seat-token',
          ...(missing ? {} : { asa_session: 'expired' }),
        },
      } as unknown as FastifyRequest;
      g.account.mockResolvedValue(null as never);
      await expect(g.controller.results(onlySeat)).rejects.toMatchObject({ status: 401 });
      await expect(g.controller.read(onlySeat, classId)).rejects.toMatchObject({ status: 401 });
      await expect(g.controller.settings(onlySeat, classId)).rejects.toMatchObject({ status: 401 });
      await expect(g.controller.history(onlySeat, classId, classId, classId)).rejects.toMatchObject(
        { status: 401 },
      );
      await expect(
        g.controller.write(onlySeat, classId, 'scale', {
          requestId: 'request-0001',
          expectedRevision: 0,
          preset: 'five',
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(g.seat).not.toHaveBeenCalled();
      expect(g.query).not.toHaveBeenCalled();
    }
  });
  it('teacher reads/history/settings never use Seat resolver, and history does not fetch the matrix', async () => {
    const f = fixture({ items: [], nextBeforeRevision: null });
    await f.controller.read(request, classId);
    await f.controller.settings(request, classId);
    await f.controller.history(request, classId, classId, classId, {
      beforeRevision: '41',
      limit: '20',
    });
    expect(f.query).toHaveBeenLastCalledWith(
      'SELECT classroom_journal_history($1,$2,$3,$4,$5,$6) AS value',
      ['account-principal', classId, classId, classId, 41, 20],
    );
    expect(f.query).toHaveBeenCalledTimes(3);
    expect(f.seat).not.toHaveBeenCalled();
  });
  it('enforces calendar/range/page limits before a database query', async () => {
    const f = fixture();
    for (const query of [
      { from: '2026-01-01' },
      { to: '2026-01-01' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-10-10', to: '2026-10-09' },
      { from: '2026-01-01', to: '2026-04-04' },
      { limit: '51' },
      { limit: '0' },
      { offset: '-1' },
      { offset: '1000001' },
      { offset: ['0'] },
    ]) {
      await expect(f.controller.read(request, classId, query)).rejects.toMatchObject({
        status: 400,
      });
      await expect(f.controller.results(request, query)).rejects.toMatchObject({ status: 400 });
      await expect(f.controller.seatResults(request, query)).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      f.controller.history(request, classId, classId, classId, { beforeRevision: '0' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(f.controller.seatResults(request, { columnId: 'spoof' })).rejects.toMatchObject({
      status: 400,
    });
    expect(f.query).not.toHaveBeenCalled();
    await f.controller.read(request, classId, {
      from: '2026-01-01',
      to: '2026-04-03',
      offset: '50',
      limit: '50',
    });
    expect(f.query).toHaveBeenLastCalledWith(expect.any(String), [
      'account-principal',
      classId,
      '2026-01-01',
      '2026-04-03',
      50,
      50,
    ]);
  });
  it('propagates emission failure without returning success; retries keep their requestId', async () => {
    const f = fixture({ id: 'confirmed' });
    f.query.mockRejectedValueOnce(new Error('injected emission failure'));
    const command = {
      requestId: 'request-0001',
      expectedRevision: 0,
      columnId: classId,
      seatId: classId,
      value: 0,
      reason: null,
    };
    await expect(f.controller.write(request, classId, 'grade', command)).rejects.toThrow(
      'injected emission failure',
    );
    expect(await f.controller.write(request, classId, 'grade', command)).toEqual({
      id: 'confirmed',
    });
    expect(f.query.mock.calls[0]).toEqual(f.query.mock.calls[1]);
  });
  it.each([
    ['revision_conflict', 409],
    ['idempotency_conflict', 409],
    ['classroom_archived', 409],
    ['forbidden', 403],
    ['not_found', 404],
  ])('maps %s without claiming a save', async (error, status) => {
    const f = fixture({ error });
    await expect(
      f.controller.write(request, classId, 'grade', {
        columnId: classId,
        seatId: classId,
        value: 0,
        reason: null,
        expectedRevision: 0,
        requestId: 'request-0001',
      }),
    ).rejects.toMatchObject({ status });
  });
  it('rejects fractional/nonfinite/unknown grades and invalid IDs before querying', async () => {
    const f = fixture();
    const input = {
      columnId: classId,
      seatId: classId,
      value: 0,
      reason: null,
      expectedRevision: 0,
      requestId: 'request-0001',
    };
    for (const value of [undefined, NaN, Infinity, -1, 2.5, 101, '0'])
      await expect(
        f.controller.write(request, classId, 'grade', { ...input, value }),
      ).rejects.toMatchObject({ status: 400 });
    await expect(f.controller.read(request, 'spoof')).rejects.toMatchObject({ status: 400 });
    expect(f.query).not.toHaveBeenCalled();
  });
});
