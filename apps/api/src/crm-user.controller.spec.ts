import { it, expect, vi } from 'vitest';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import { CrmUserController, crmIdentity, crmProfileInput } from './crm-user.controller';
const ID = '20000000-0000-4000-8000-000000000001';
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
