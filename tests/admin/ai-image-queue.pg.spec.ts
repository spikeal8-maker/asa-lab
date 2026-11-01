import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { AiImageService } from '../../apps/api/src/ai-image.service';
import type { ComfyImageRecovery, ComfyImageTransport } from '../../apps/api/src/ai-image-comfyui';

let admin: pg.Pool, runtime: pg.Pool;
let legacyBefore: unknown, legacyAfter: unknown;
const beginSql = 'SELECT ai_image_begin($1,$2,$3,$4,768,$5,42,$6,$7,$8) AS value';
const transport = {
  readiness: vi.fn(async () => ({ ready: true, reason: null })),
  dispatch: vi.fn<ComfyImageTransport['dispatch']>(async () => undefined),
  recover: vi.fn<() => Promise<ComfyImageRecovery>>(async () => ({ state: 'missing' })),
  cancelPending: vi.fn(async () => false),
};
const blobs = {
  putImmutable: vi.fn(async () => undefined),
  verify: vi.fn(async () => false),
  read: vi.fn(async () => null),
  remove: vi.fn(async () => true),
};
const service = () => new AiImageService(runtime, { transport, blobs, maintenance: false });
async function owner() {
  const a = (
    await admin.query(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'synthetic','1990-01-01','RU') RETURNING id",
      [randomUUID() + '@example.test'],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO profiles(account_id,username,display_name) VALUES($1,$2,'Synthetic pupil')",
    [a, randomUUID()],
  );
  const id = (
    await admin.query("INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id", [
      a,
    ])
  ).rows[0].id as string;
  const thread = (await runtime.query('SELECT ai_chat_create($1) AS id', [id])).rows[0]
    .id as string;
  return { id, thread };
}
async function begin(
  actor: Awaited<ReturnType<typeof owner>>,
  request = randomUUID(),
  text = 'Synthetic image',
) {
  const provider = randomUUID();
  return (
    await runtime.query(beginSql, [
      actor.id,
      actor.thread,
      request,
      text,
      provider,
      true,
      'a'.repeat(64),
      'flux2-klein-4b-v1',
    ])
  ).rows[0].value;
}
async function dispatch(
  actor: Awaited<ReturnType<typeof owner>>,
  request: string,
  client: pg.Pool | pg.PoolClient = runtime,
) {
  return (await client.query('SELECT ai_image_dispatch($1,$2) AS value', [actor.id, request]))
    .rows[0].value as boolean;
}
async function claim(client: pg.Pool | pg.PoolClient = runtime) {
  return (await client.query('SELECT ai_image_claim($1) AS value', [randomUUID()])).rows[0].value;
}
async function failKnown(actor: Awaited<ReturnType<typeof owner>>, request: string) {
  await admin.query('UPDATE ai_image_jobs SET lease_until=NULL WHERE request_id=$1', [request]);
  const j = await claim();
  expect(j.request_id).toBe(request);
  expect(
    (
      await runtime.query(
        "SELECT ai_image_transition($1,$2,$3,'failed',NULL,NULL,'ai_image_provider_failed') AS value",
        [actor.id, request, j.lease_id],
      )
    ).rows[0].value,
  ).toBe(true);
}

describe.skipIf(process.env.ASA_IMAGE_QUEUE_TEST !== '1')(
  'durable queue on a dedicated real PostgreSQL',
  () => {
    beforeAll(async () => {
      if (process.env.ASA_IMAGE_QUEUE_TEST !== '1')
        throw new Error('Explicit isolated image-queue CI opt-in required');
      const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
        const url = new URL(process.env[key] || '');
        if (
          !decodeURIComponent(url.pathname).endsWith('_test') ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          url.search
        )
          throw new Error('Queue evidence requires a loopback disposable *_test database');
        return url;
      });
      if (urls[0].host !== urls[1].host || urls[0].pathname !== urls[1].pathname)
        throw new Error('Both roles must target the same isolated DB');
      admin = new pg.Pool({ connectionString: urls[0].href, max: 3 });
      runtime = new pg.Pool({ connectionString: urls[1].href, max: 8 });
      const client = await admin.connect();
      try {
        // Prove a forward upgrade from the actual school schema, not only an empty DB.
        const migrations = planMigrations('migrations');
        await applyPlan(
          client,
          migrations.filter((m: { version: string }) => m.version <= '0286'),
        );
        await client.query("ALTER ROLE asalab_app WITH LOGIN PASSWORD 'image-queue-ci-only'");
        expect(
          (
            await runtime.query(
              'SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
            )
          ).rows[0],
        ).toEqual({ current_user: 'asalab_app', rolsuper: false, rolbypassrls: false });
        await client.query(
          "UPDATE ai_image_settings SET enabled=true,sizes='[768]',global_concurrency=1",
        );
        const actor = await owner();
        const j = await begin(actor);
        await dispatch(actor, j.request_id);
        await client.query("UPDATE ai_image_jobs SET state='unknown' WHERE request_id=$1", [
          j.request_id,
        ]);
        legacyBefore = (
          await client.query(
            'SELECT to_jsonb(j) AS value FROM ai_image_jobs j WHERE request_id=$1',
            [j.request_id],
          )
        ).rows[0].value;
        await applyPlan(client, migrations);
        legacyAfter = (
          await client.query(
            'SELECT to_jsonb(j) AS value FROM ai_image_jobs j WHERE request_id=$1',
            [j.request_id],
          )
        ).rows[0].value;
        expect(await applyPlan(client, migrations)).toBe(0);
      } finally {
        client.release();
      }
    }, 120000);
    beforeEach(async () => {
      // This workflow owns a fresh synthetic DB. Never enabled against a live install.
      await admin.query('DELETE FROM ai_image_jobs');
      await admin.query("UPDATE ai_image_settings SET enabled=true,daily_limit=100,sizes='[768]'");
      vi.clearAllMocks();
      transport.recover.mockResolvedValue({ state: 'missing' });
    });
    afterAll(async () => {
      await runtime?.end();
      await admin?.end();
    });

    it('preserves a schema286 uncertain job byte-for-byte and retains single-GPU settings', async () => {
      expect(legacyAfter).toEqual(legacyBefore);
      expect((legacyAfter as { state: string }).state).toBe('unknown');
      expect(
        (await admin.query('SELECT global_concurrency FROM ai_image_settings')).rows[0]
          .global_concurrency,
      ).toBe(1);
      await expect(
        admin.query('UPDATE ai_image_settings SET global_concurrency=2'),
      ).rejects.toThrow();
      await expect(runtime.query('SELECT * FROM ai_image_queue_head()')).rejects.toThrow(
        /permission denied/,
      );
      await expect(runtime.query('SELECT * FROM ai_image_jobs')).rejects.toThrow(
        /permission denied/,
      );
    });

    it('admits 100 independent pupils while GPU active count stays exactly one', async () => {
      const actors = await Promise.all(Array.from({ length: 100 }, () => owner()));
      const jobs = await Promise.all(actors.map((a) => begin(a)));
      expect(jobs.every((j) => j.state === 'admitted')).toBe(true);
      const claims = await Promise.all(jobs.map((j, i) => dispatch(actors[i], j.request_id)));
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(
        (await admin.query("SELECT count(*)::int AS n FROM ai_image_jobs WHERE state='admitted'"))
          .rows[0].n,
      ).toBe(99);
      expect(
        (await admin.query("SELECT count(*)::int AS n FROM ai_image_jobs WHERE state='submitting'"))
          .rows[0].n,
      ).toBe(1);
    }, 30000);

    it('enforces bounded owner/global queues, charges each receipt once and permits owner cancellation', async () => {
      const actors = await Promise.all(Array.from({ length: 100 }, () => owner()));
      const jobs = [];
      for (const actor of actors) jobs.push(await begin(actor), await begin(actor));
      await expect(begin(actors[0])).rejects.toThrow(/AI_IMAGE_QUEUE_FULL/);
      await runtime.query('SELECT ai_image_cancel($1,$2,$3)', [
        actors[0].id,
        actors[0].thread,
        jobs[0].request_id,
      ]);
      const newcomer = await owner();
      await begin(newcomer);
      await expect(begin(newcomer)).rejects.toThrow(/AI_IMAGE_QUEUE_FULL/);
      await runtime.query('SELECT ai_image_cancel($1,$2,$3)', [
        actors[0].id,
        actors[0].thread,
        jobs[1].request_id,
      ]);
      await expect(begin(actors[1])).rejects.toThrow(/AI_IMAGE_OWNER_QUEUE_FULL/);
      expect(
        (
          await runtime.query(beginSql, [
            actors[1].id,
            actors[1].thread,
            jobs[2].request_id,
            'Synthetic image',
            randomUUID(),
            false,
            'b'.repeat(64),
            'flux2-klein-4b-fp8-izo-v1',
          ])
        ).rows[0].value.request_id,
      ).toBe(jobs[2].request_id);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM ai_assistant_request_quota WHERE owner_principal_id=$1',
            [actors[1].id],
          )
        ).rows[0].n,
      ).toBe(2);
    }, 30000);

    it('round-robins owners, preserves FIFO and serializes adversarial claims across independent SQL connections', async () => {
      const a = await owner(),
        b = await owner();
      const first = await begin(a),
        second = await begin(a),
        other = await begin(b);
      expect(await dispatch(a, first.request_id)).toBe(true);
      await failKnown(a, first.request_id);
      expect(await dispatch(a, second.request_id)).toBe(false); // Cannot jump the unserved owner.
      const one = await runtime.connect(),
        two = await runtime.connect();
      try {
        expect((await one.query('SELECT pg_backend_pid() AS id')).rows[0].id).not.toBe(
          (await two.query('SELECT pg_backend_pid() AS id')).rows[0].id,
        );
        await one.query('BEGIN');
        const c = await claim(one);
        expect(c.request_id).toBe(other.request_id);
        const pid = (await two.query('SELECT pg_backend_pid() AS id')).rows[0].id;
        const blocked = claim(two);
        let observed = false;
        for (let i = 0; i < 200; i++) {
          if (
            (await admin.query('SELECT cardinality(pg_blocking_pids($1))>0 AS waiting', [pid]))
              .rows[0].waiting
          ) {
            observed = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(observed).toBe(true);
        await one.query('COMMIT');
        expect(await blocked).toBeNull();
        const attempts = await Promise.all([
          dispatch(b, other.request_id, one),
          dispatch(b, other.request_id, two),
          dispatch(a, second.request_id),
        ]);
        expect(attempts.filter(Boolean)).toHaveLength(1);
      } finally {
        await one.query('ROLLBACK');
        one.release();
        two.release();
      }
      await failKnown(b, other.request_id);
      const next = await claim();
      expect(next.request_id).toBe(second.request_id);
      expect(await dispatch(a, second.request_id)).toBe(true);
    });

    it('recovers crashed pre-CAS workers, but lost post-CAS reply never repeats submission', async () => {
      const actor = await owner();
      const j = await begin(actor);
      // A lost admission reply is only replayed as a receipt. Dispatch belongs to
      // the recovered worker, even if the GPU happens to be free during replay.
      expect(
        (
          await service().create(actor.id, actor.thread, {
            requestId: j.request_id,
            prompt: 'Synthetic image',
            size: 768,
          })
        ).state,
      ).toBe('admitted');
      expect(transport.dispatch).not.toHaveBeenCalled();
      const abandoned = await claim();
      expect(abandoned.request_id).toBe(j.request_id);
      expect(await claim()).toBeNull();
      await admin.query(
        "UPDATE ai_image_jobs SET lease_until=clock_timestamp()-interval '1 second'",
      );
      const recovered = await claim();
      expect(recovered.request_id).toBe(j.request_id);
      expect(recovered.lease_id).not.toBe(abandoned.lease_id);
      let lose = true;
      const pool = {
        query: async (sql: string, args: unknown[]) => {
          const result = await runtime.query(sql, args);
          if (lose && sql.includes('ai_image_dispatch(')) {
            lose = false;
            throw new Error('synthetic lost CAS reply');
          }
          return result;
        },
      } as unknown as pg.Pool;
      const worker = new AiImageService(pool, { transport, blobs, maintenance: false });
      await admin.query('UPDATE ai_image_jobs SET lease_until=NULL');
      await worker.sweep();
      expect(transport.dispatch).not.toHaveBeenCalled();
      await service().sweep();
      expect(transport.dispatch).not.toHaveBeenCalled();
      expect((await admin.query('SELECT state FROM ai_image_jobs')).rows[0].state).toBe('unknown');
    });

    it('missing UUID pauses waiting jobs; only an exact owned terminal result advances, without interrupt/resubmit', async () => {
      const a = await owner(),
        b = await owner();
      const first = await begin(a),
        second = await begin(b);
      expect(await dispatch(a, first.request_id)).toBe(true);
      const s = service();
      await s.sweep();
      expect(await s.get(b.id, b.thread, second.request_id)).toMatchObject({
        state: 'admitted',
        queuePaused: true,
      });
      expect(await dispatch(b, second.request_id)).toBe(false);
      const replay = await begin(b, second.request_id);
      expect(replay.request_id).toBe(second.request_id);
      await expect(s.get(a.id, b.thread, second.request_id)).rejects.toThrow();
      await expect(s.bytes(b.id, b.thread, second.request_id)).rejects.toMatchObject({
        status: 409,
      });
      await s.cancel(b.id, b.thread, second.request_id);
      expect((await s.get(b.id, b.thread, second.request_id)).state).toBe('cancelled');
      expect(transport.cancelPending).not.toHaveBeenCalled();
      const next = await begin(b);
      await admin.query('UPDATE ai_image_jobs SET lease_until=NULL WHERE request_id=$1', [
        first.request_id,
      ]);
      transport.recover.mockResolvedValueOnce({ state: 'failed' });
      await s.sweep();
      expect(
        (
          await admin.query('SELECT status,finished_at FROM ai_usage_journal WHERE request_id=$1', [
            first.request_id,
          ])
        ).rows[0],
      ).toMatchObject({ status: 'failed', finished_at: expect.any(Date) });
      await s.sweep();
      expect(transport.dispatch).toHaveBeenCalledTimes(1);
      expect(transport.dispatch.mock.calls[0][0]).toBe(next.provider_id);
      expect(blobs.putImmutable).not.toHaveBeenCalled();
    });

    it('deleting/cancelling a queued receipt suppresses dispatch and private storage while keeping quota tombstones', async () => {
      const a = await owner(),
        b = await owner();
      const active = await begin(a),
        waiting = await begin(b);
      expect(await dispatch(a, active.request_id)).toBe(true);
      await runtime.query('SELECT ai_chat_delete($1,$2)', [b.id, b.thread]);
      const deleted = (
        await admin.query('SELECT state,prompt,deleted_at FROM ai_image_jobs WHERE request_id=$1', [
          waiting.request_id,
        ])
      ).rows[0];
      expect(deleted).toMatchObject({
        state: 'cancelled',
        prompt: null,
        deleted_at: expect.any(Date),
      });
      await expect(service().get(b.id, b.thread, waiting.request_id)).rejects.toThrow();
      expect(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM ai_assistant_request_quota WHERE request_id=$1',
            [waiting.request_id],
          )
        ).rows[0].n,
      ).toBe(1);
      await failKnown(a, active.request_id);
      expect(await claim()).toBeNull();
      expect(transport.dispatch).not.toHaveBeenCalled();
      expect(blobs.putImmutable).not.toHaveBeenCalled();
    });

    it('does not refund daily quota after queue cancellation and rechecks disabled admission before dispatch', async () => {
      await admin.query('UPDATE ai_image_settings SET daily_limit=2');
      const a = await owner();
      const first = await begin(a),
        second = await begin(a);
      await runtime.query('SELECT ai_image_cancel($1,$2,$3)', [a.id, a.thread, first.request_id]);
      await runtime.query('SELECT ai_image_cancel($1,$2,$3)', [a.id, a.thread, second.request_id]);
      await expect(begin(a)).rejects.toThrow(/AI_IMAGE_QUOTA_EXHAUSTED/);
      const b = await owner();
      const waiting = await begin(b);
      await admin.query('UPDATE ai_image_settings SET enabled=false');
      await service().sweep();
      expect((await service().get(b.id, b.thread, waiting.request_id)).state).toBe('cancelled');
      expect(transport.dispatch).not.toHaveBeenCalled();
    });

    it('prioritizes free-GPU dispatch over 121 recurring PUT tombstones and cleans while the active GPU is leased', async () => {
      const a = await owner();
      await admin.query(
        `INSERT INTO ai_image_jobs(owner_principal_id,request_id,thread_id,provider_id,marker,seed,prompt,payload_digest,graph_digest,size,settings_snapshot,state,cancel_requested,sha256,size_bytes,put_started,put_uncertain,cleanup_required,created_at)
        SELECT $1,gen_random_uuid(),$2,p.id,'ASA_'||replace(p.id::text,'-',''),1,NULL,$3,$3,768,'{}','cancelled',true,$3,3,true,true,true,clock_timestamp()-interval '1 day'
        FROM (SELECT gen_random_uuid() AS id FROM generate_series(1,121)) p`,
        [a.id, a.thread, 'a'.repeat(64)],
      );
      const queued = await begin(a);
      const s = service();
      await s.sweep();
      expect(transport.dispatch).toHaveBeenCalledTimes(1);
      expect(transport.dispatch.mock.calls[0][0]).toBe(queued.provider_id);
      expect(blobs.remove).not.toHaveBeenCalled();
      const waiting = await begin(a);
      transport.recover.mockResolvedValueOnce({ state: 'running' });
      await s.sweep();
      await admin.query(
        "UPDATE ai_image_jobs SET lease_until=clock_timestamp()+interval '2 minutes' WHERE request_id=$1",
        [queued.request_id],
      );
      await s.sweep();
      expect(blobs.remove).toHaveBeenCalledTimes(1);
      expect(transport.dispatch).toHaveBeenCalledTimes(1);
      expect((await s.get(a.id, a.thread, queued.request_id)).state).toBe('running');
      expect((await s.get(a.id, a.thread, waiting.request_id)).state).toBe('admitted');
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM ai_image_jobs WHERE owner_principal_id=$1 AND state='cancelled' AND cleanup_required AND put_uncertain",
            [a.id],
          )
        ).rows[0].n,
      ).toBe(121);
    });
  },
);
