import { EventEmitter } from 'node:events';
import type pg from 'pg';
import { expect, it, vi } from 'vitest';
import { acquireLlamaCppSlot, withLlamaCppSlot } from './ai-llamacpp-slot';

const identity = { owner: 'owner', threadId: 'thread', requestId: 'request' };
function fixture(acquired = true) {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async (sql: string) => ({
      rows: [sql.includes('acquire') ? { acquired } : { released: true }],
    })),
    release: vi.fn(),
  });
  const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;
  return { pool, client };
}

it('holds a dedicated connection until provider completion and releases the exact owner once', async () => {
  const { pool, client } = fixture();
  const slot = await acquireLlamaCppSlot(pool, identity);
  expect(slot.client).toBe(client);
  expect(client.release).not.toHaveBeenCalled();
  expect(slot.signal.aborted).toBe(false);
  await slot.release();
  await slot.release();
  expect(client.query).toHaveBeenLastCalledWith(
    'SELECT ai_llamacpp_slot_release($1,$2,$3::varchar) AS released',
    ['owner', 'thread', 'request'],
  );
  expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  expect(client.listenerCount('error')).toBe(0);
});

it('rejects busy admission without starting inference', async () => {
  const { pool, client } = fixture(false);
  const infer = vi.fn(async () => 'answer');
  await expect(withLlamaCppSlot(pool, identity, infer)).rejects.toMatchObject({
    code: 'ai_llamacpp_busy',
    status: 409,
  });
  expect(infer).not.toHaveBeenCalled();
  expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
});

it('aborts only its own upstream after database connection loss and destroys the failed session', async () => {
  const first = fixture();
  const second = fixture();
  const slot = await acquireLlamaCppSlot(first.pool, identity);
  const other = await acquireLlamaCppSlot(second.pool, { ...identity, requestId: 'other' });
  first.client.emit('error', new Error('connection lost'));
  expect(slot.signal.aborted).toBe(true);
  expect(other.signal.aborted).toBe(false);
  await slot.release();
  await other.release();
  expect(first.client.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(first.client.query).toHaveBeenCalledTimes(1);
  expect(second.client.release).toHaveBeenCalledExactlyOnceWith(false);
});

it('cleans the slot after a provider exception and destroys a session whose unlock failed', async () => {
  const { pool, client } = fixture();
  client.query
    .mockImplementationOnce(async () => ({ rows: [{ acquired: true }] }))
    .mockRejectedValueOnce(new Error('lost unlock'));
  await expect(
    withLlamaCppSlot(pool, identity, async () => {
      throw new Error('upstream failed');
    }),
  ).rejects.toThrow('upstream failed');
  expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(client.listenerCount('error')).toBe(0);
});
