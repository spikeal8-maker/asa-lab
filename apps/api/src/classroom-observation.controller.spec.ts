import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { ClassroomObservationController } from './classroom-observation.controller.js';
import { ClassroomJoinController } from './classroom-join.controller.js';

const classId = '10000000-0000-4000-8000-000000000001';
const seatId = '20000000-0000-4000-8000-000000000001';
function fixture() {
  const resolve = vi.fn().mockResolvedValue({ principalId: 'teacher' });
  const query = vi.fn().mockResolvedValue({ rows: [{ data: { items: [], totals: {} } }] });
  const controller = new ClassroomObservationController(
    { resolve } as unknown as ActiveContextUseCase,
    { query } as unknown as pg.Pool,
  );
  const request = {
    cookies: { asa_session: 'account', asa_student_session: 'seat' },
  } as unknown as FastifyRequest;
  return { controller, resolve, query, request };
}
describe('observation request boundary', () => {
  it('uses revalidated Account credentials; no Seat fallback and no database query on missing authentication', async () => {
    const f = fixture();
    f.resolve.mockResolvedValue(null);
    await expect(
      f.controller.summary(f.request, { classroomIds: [classId] }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(f.controller.projects(f.request, classId)).rejects.toMatchObject({ status: 401 });
    await expect(f.controller.history(f.request, classId)).rejects.toMatchObject({ status: 401 });
    expect(f.resolve).toHaveBeenCalledWith('account');
    expect(f.query).not.toHaveBeenCalled();
  });
  it('reads one set without preparing identities and reports denied data as errors', async () => {
    const f = fixture();
    await f.controller.summary(f.request, { classroomIds: [classId] });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledWith('SELECT classroom_observation_summary($1,$2) AS data', [
      'teacher',
      [classId],
    ]);
    f.query.mockResolvedValue({ rows: [{ data: null }] });
    await expect(f.controller.projects(f.request, classId)).rejects.toMatchObject({ status: 404 });
    await expect(f.controller.history(f.request, classId)).rejects.toMatchObject({ status: 404 });
  });
  it('authorizes the entire class set before separate explicit preparation', async () => {
    const f = fixture();
    f.query.mockResolvedValueOnce({ rows: [{ data: null }] });
    await expect(
      f.controller.prepare(f.request, { classroomIds: [classId] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.query).toHaveBeenCalledTimes(1);
    f.query.mockClear();
    await f.controller.prepare(f.request, { classroomIds: [classId] });
    expect(f.query.mock.calls.map((call) => call[0])).toEqual([
      'SELECT classroom_observation_summary($1,$2) AS data',
      'SELECT classroom_participant_prepare($1,$2) AS data',
    ]);
  });
  it('validates batch shape, filters, page size, identifiers and cursor before any query', async () => {
    const f = fixture();
    for (const body of [
      { classroomIds: [classId, classId] },
      { classroomIds: ['wrong'] },
      { classroomIds: [], actor: 'other' },
      { classroomIds: Array.from({ length: 201 }, () => classId) },
    ]) {
      await expect(f.controller.summary(f.request, body)).rejects.toMatchObject({ status: 400 });
    }
    await expect(f.controller.projects(f.request, classId, 'chess')).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      f.controller.projects(
        f.request,
        classId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '100001',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.projects(
        f.request,
        classId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '100',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.history(f.request, classId, seatId, 'anything'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.history(f.request, classId, undefined, 'all', undefined, undefined, 'invalid'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.history(f.request, classId, undefined, 'all', '2026-02-30'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.history(f.request, classId, undefined, 'all', '2026-10-12', '2026-10-11'),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.query).not.toHaveBeenCalled();
  });
});

describe('existing join-request reply boundary', () => {
  it('accepts an optional 500-character plain-text reply, trims it and rejects markup/control/oversize input', async () => {
    const resolve = vi.fn().mockResolvedValue({ principalId: 'teacher', accountId: 'account' });
    const query = vi.fn().mockResolvedValue({ rows: [{ code: 'ok' }] });
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      { resolve } as unknown as ActiveContextUseCase,
    );
    const request = { cookies: { asa_session: 'account' } } as unknown as FastifyRequest;
    await controller.decideJoin(request, classId, seatId, {
      decision: 'approved',
      reason: '  Спасибо  ',
    });
    expect(query.mock.calls[0]?.[1]).toEqual([
      'account',
      'teacher',
      classId,
      seatId,
      'approved',
      'Спасибо',
    ]);
    await controller.decideJoin(request, classId, seatId, {
      decision: 'rejected',
      reason: 'x'.repeat(500),
    });
    query.mockClear();
    for (const reason of ['x'.repeat(501), '<b>reply</b>', 'control\u0000', 42]) {
      await expect(
        controller.decideJoin(request, classId, seatId, { decision: 'rejected', reason }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(query).not.toHaveBeenCalled();
    resolve.mockResolvedValue(null);
    await expect(
      controller.decideJoin(request, classId, seatId, { decision: 'approved', reason: 'reply' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalled();
  });
});
