import { it, expect, vi } from 'vitest';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import { CrmUserController, crmIdentity, crmProfileInput } from './crm-user.controller';
import { projectDatabaseEntry } from './database-diagnostics';
const ID = '20000000-0000-4000-8000-000000000001';
it('retains only the finite dashboard audit action without private audit metadata', () => {
  const projected = projectDatabaseEntry({
    id: 'a'.repeat(64),
    time: '2026-10-26T12:00:00Z',
    source: 'audit',
    origin: 'administrative_audit_events',
    module: 'portal',
    level: 'info',
    requestId: null,
    revision: null,
    truncated: false,
    message: JSON.stringify({
      action: 'crm.dashboard.read',
      reason: 'PRIVATE',
      metadata_json: { email: 'PRIVATE' },
    }),
  });
  expect(projected.message).toContain('crm.dashboard.read');
  expect(projected.message).not.toContain('PRIVATE');
});
it('loads the dashboard through the canonical actor and typed exact subject with an SQL timeout', async () => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.startsWith('SELECT crm_user_dashboard') ? [{ value: { activity: [] } }] : [],
  }));
  const controller = new CrmUserController(
    { resolve: vi.fn(async () => ({ principalId: ID })) } as unknown as ActiveContextUseCase,
    { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as pg.Pool,
  );
  const request = {
    cookies: { asa_session: 'test' },
    id: 'dashboard-request',
  } as unknown as FastifyRequest;
  await expect(controller.dashboard(request, 'student', ID, ID)).resolves.toEqual({ activity: [] });
  expect(query).toHaveBeenCalledWith('SELECT crm_user_dashboard($1,$2,$3,$4,$5) AS value', [
    ID,
    'student',
    ID,
    ID,
    'dashboard-request',
  ]);
  expect(query).toHaveBeenCalledWith("SET LOCAL statement_timeout = '8s'");
  await expect(controller.dashboard(request, 'student', ID, [ID])).rejects.toMatchObject({
    status: 400,
  });
});
it('rejects duplicate query identity, untyped subjects and credentials hidden in profile mutation', () => {
  for (const args of [
    ['account', ID, [ID]],
    ['person', ID, undefined],
    ['student', 'broken', ID],
  ])
    expect(() => crmIdentity(...(args as Parameters<typeof crmIdentity>))).toThrow();
  const valid = {
    version: 'a'.repeat(64),
    name: 'Ученик',
    birthDate: null,
    country: null,
    bio: '',
    reason: 'Обращение',
  };
  expect(crmProfileInput(valid)).toMatchObject({ birth: null, country: null });
  for (const input of [
    { ...valid, password: 'secret' },
    { ...valid, birthDate: 'tomorrow' },
    { ...valid, reason: '' },
    { ...valid, name: ['name'] },
  ])
    expect(() => crmProfileInput(input)).toThrow();
});
it('requires canonical Account session, returns SQL denial without data and destroys only failed-rollback owned clients', async () => {
  const release = vi.fn(),
    primary = Object.assign(new Error('denied'), { code: '42501' });
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT crm_')) throw primary;
    if (sql === 'ROLLBACK') throw new Error('rollback failed');
    return { rows: [] };
  });
  const controller = new CrmUserController(
    { resolve: vi.fn(async () => ({ principalId: ID })) } as unknown as ActiveContextUseCase,
    { connect: vi.fn(async () => ({ query, release })) } as unknown as pg.Pool,
  );
  const request = { cookies: { asa_session: 'test' }, id: 'request' } as unknown as FastifyRequest;
  await expect(controller.card(request, 'student', ID, undefined)).rejects.toMatchObject({
    status: 403,
  });
  expect(release).toHaveBeenCalledWith(true);
  expect(query.mock.calls.slice(0, 2).map(([sql]) => sql)).toEqual([
    'BEGIN',
    "SET LOCAL statement_timeout = '8s'",
  ]);
  const unauth = new CrmUserController(
    { resolve: vi.fn(async () => null) } as unknown as ActiveContextUseCase,
    {} as pg.Pool,
  );
  await expect(unauth.card(request, 'account', ID, undefined)).rejects.toMatchObject({
    status: 401,
  });
  await expect(
    controller.content(request, 'student', ID, undefined, 'messages', ['duplicate']),
  ).rejects.toMatchObject({ status: 400 });
});
it('validates exact Seat detail category/class and serializes note continuation after SQL', async () => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.startsWith('SELECT crm_')
      ? [{ value: { items: [], next: { v: 1, last: { id: ID } } } }]
      : [],
  }));
  const controller = new CrmUserController(
    { resolve: vi.fn(async () => ({ principalId: ID })) } as unknown as ActiveContextUseCase,
    { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as pg.Pool,
  );
  const request = {
    cookies: { asa_session: 'test' },
    id: 'request',
    headers: { origin: 'https://asa.test', host: 'asa.test', 'content-type': 'application/json' },
  } as unknown as FastifyRequest;
  for (const [classroom, category, cursor] of [
    [undefined, 'notes', undefined],
    [ID, 'secrets', undefined],
    [ID, 'notes', ['duplicate']],
  ])
    await expect(
      controller.seatDetail(request, ID, classroom, category, cursor),
    ).rejects.toMatchObject({ status: 400 });
  const value = await controller.seatDetail(request, ID, ID, 'notes', undefined);
  expect(typeof value.next).toBe('string');
  expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT crm_seat_notes_page'))).toBe(true);
  await expect(
    controller.seatNote(request, ID, {
      classroomId: ID,
      version: 'a'.repeat(64),
      text: 'Observe',
      reason: 'Classroom note',
      accountId: ID,
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    controller.seatNote(
      {
        ...request,
        headers: { ...request.headers, origin: 'https://foreign.test' },
      } as FastifyRequest,
      ID,
      { classroomId: ID, version: 'a'.repeat(64), text: 'Observe', reason: 'Classroom note' },
    ),
  ).rejects.toMatchObject({ status: 403 });
  await controller.seatNote(request, ID, {
    classroomId: ID,
    version: 'a'.repeat(64),
    text: 'Observe',
    reason: 'Classroom note',
  });
  expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT crm_seat_note_add'))).toBe(true);
});
