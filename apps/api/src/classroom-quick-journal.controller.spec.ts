import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { SeatContextUseCase } from './seat-context.js';
import { ClassroomJournalController } from './classroom-journal.controller.js';

const classroomId = '123e4567-e89b-42d3-a456-426614174000';
const request = {
  cookies: { asa_session: 'account-token', asa_student_session: 'seat-token' },
} as unknown as FastifyRequest;
const input = {
  slotKey: '2026-10:1',
  date: '2026-10-11',
  category: 'Работа 1',
  expectedScaleVersion: 0,
  expectedHeaderRevision: 0,
  requestId: 'quick-request-0001',
  seatId: classroomId,
  value: 0,
  expectedRevision: 0,
  reason: null,
};
function fixture(value: unknown = {}) {
  const query = vi.fn(async () => ({ rows: [{ value }] }));
  const account = vi.fn(async () => ({ principalId: 'server-account-principal' }));
  const seat = vi.fn();
  const controller = new ClassroomJournalController(
    { resolve: account } as unknown as ActiveContextUseCase,
    { resolve: seat } as unknown as SeatContextUseCase,
    { query } as unknown as pg.Pool,
  );
  return { query, account, seat, controller };
}
describe('quick journal HTTP contract', () => {
  it('reads one exact-class column or slot across a moved month, using only the Account actor', async () => {
    const f = fixture();
    await f.controller.read(request, classroomId, { columnId: classroomId });
    expect(f.query).toHaveBeenLastCalledWith(
      'SELECT classroom_journal_quick_read($1,$2,$3,$4,$5,$6,$7,$8) AS value',
      ['server-account-principal', classroomId, null, null, 0, 50, classroomId, null],
    );
    await f.controller.read(request, classroomId, { slotKey: '2026-10:1' });
    expect(f.query).toHaveBeenLastCalledWith(expect.any(String), [
      'server-account-principal',
      classroomId,
      null,
      null,
      0,
      50,
      null,
      '2026-10:1',
    ]);
    for (const query of [
      { columnId: 'spoof' },
      { slotKey: '2026-10:0' },
      { columnId: classroomId, slotKey: '2026-10:1' },
    ])
      await expect(f.controller.read(request, classroomId, query)).rejects.toMatchObject({
        status: 400,
      });
    expect(f.seat).not.toHaveBeenCalled();
  });
  it('uses the server Account actor and real bounded SQL operation for a first zero', async () => {
    const f = fixture({ column: { id: classroomId }, grade: { value: 0 } });
    await expect(f.controller.write(request, classroomId, 'quick', input)).resolves.toMatchObject({
      grade: { value: 0 },
    });
    expect(f.query).toHaveBeenCalledWith(
      'SELECT classroom_journal_quick_write($1,$2,$3::jsonb) AS value',
      ['server-account-principal', classroomId, JSON.stringify(input)],
    );
    expect(f.account).toHaveBeenCalledWith('account-token');
    expect(f.seat).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, actorId: 'spoof' },
    { ...input, date: '2026-02-30' },
    { ...input, date: '2026-09-30' },
    { ...input, columnId: classroomId },
    { ...input, slotKey: '2026-10:0' },
    { ...input, value: 0.5 },
    { ...input, expectedHeaderRevision: -1 },
    { ...input, expectedScaleVersion: '0' },
    { ...input, seatId: 'foreign' },
    { ...input, value: undefined },
    { ...input, requestId: 'x'.repeat(111) },
  ])('rejects malformed or spoofed quick input before any database call', async (body) => {
    const f = fixture();
    await expect(f.controller.write(request, classroomId, 'quick', body)).rejects.toMatchObject({
      status: 400,
    });
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each(['revision_conflict', 'idempotency_conflict', 'classroom_archived'])(
    'returns a comprehensible 409 for %s',
    async (error) => {
      const f = fixture({ error });
      await expect(f.controller.write(request, classroomId, 'quick', input)).rejects.toMatchObject({
        status: 409,
        response: { error: { code: error, message: expect.any(String) } },
      });
    },
  );
  it('accepts a header confirmation with no Seat or grade fields', async () => {
    const f = fixture();
    const header = {
      slotKey: input.slotKey,
      date: input.date,
      category: input.category,
      expectedScaleVersion: input.expectedScaleVersion,
      expectedHeaderRevision: input.expectedHeaderRevision,
      requestId: input.requestId,
    };
    await f.controller.write(request, classroomId, 'quick', header);
    expect(f.query).toHaveBeenCalledOnce();
    await expect(
      f.controller.write(request, classroomId, 'quick', { ...header, value: 0 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
