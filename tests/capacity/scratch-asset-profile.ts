import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type pg from 'pg';
import { vi } from 'vitest';
import { PgProjectRepository } from '../../contexts/projects/dist/index.js';
import { S3BlocksBlobStore } from '../../apps/api/dist/blocks-asset-storage.js';
import { quantiles } from '../../tools/capacity/contracts.mjs';

const sizes = [1, 10, 30] as const;
const variants = ['with-version-history', 'candidate'] as const;
const repetitions = 4;
type Variant = (typeof variants)[number];
type Timings = { elapsedMs: number[]; failures: number };
const timings = (): Timings => ({ elapsedMs: [], failures: 0 });

const sqlStages = [
  ['transaction', /^(BEGIN|COMMIT|ROLLBACK)\b/],
  ['tenant-context', /SELECT set_config\(/],
  ['project-context', /FROM project_context_for_principal\(/],
  ['project-authority', /^SELECT p\.id,p\.module_key,p\.status/],
  ['current-draft', /JOIN project_drafts d/],
  ['version-history', /FROM project_versions\b/],
  ['asset-metadata', /FROM public\.blocks_asset_aliases alias/],
  ['account-verification', /auth_(verification|account_verification)_/],
] as const;
type SqlStage = (typeof sqlStages)[number][0] | 'other';

function sqlStage(query: unknown): SqlStage {
  const statement = typeof query === 'string' ? query.trim() : '';
  return sqlStages.find(([, pattern]) => pattern.test(statement))?.[0] ?? 'other';
}

function newSample(users: number, variant: Variant) {
  return {
    users,
    variant,
    peakWaiting: 0,
    pending: 0,
    versionRows: 0,
    sql: new Map<SqlStage, Timings>(),
    checkout: timings(),
    minioOpen: timings(),
    http: timings(),
  };
}
type Sample = ReturnType<typeof newSample>;

function sampleTiming(sample: Sample, bucket: Timings) {
  const started = performance.now();
  let completed = false;
  sample.pending++;
  return (problem?: unknown) => {
    if (completed) return;
    completed = true;
    sample.pending--;
    bucket.elapsedMs.push(performance.now() - started);
    if (problem) bucket.failures++;
  };
}

// pg exposes both callback and promise forms. Preserve the driver's checkout,
// callback and release ordering by measuring completion in the same form.
function observePgCall(
  invoke: (args: unknown[]) => unknown,
  args: unknown[],
  finish: (problem?: unknown) => void,
): unknown {
  const callback = args.at(-1);
  try {
    if (typeof callback === 'function') {
      return invoke([
        ...args.slice(0, -1),
        function (this: unknown, problem: unknown, ...values: unknown[]) {
          finish(problem);
          return Reflect.apply(callback, this, [problem, ...values]);
        },
      ]);
    }
    return (invoke(args) as Promise<unknown>).then(
      (result) => {
        finish();
        return result;
      },
      (problem: unknown) => {
        finish(problem);
        throw problem;
      },
    );
  } catch (problem) {
    finish(problem);
    throw problem;
  }
}

type Participant = {
  projectId: string;
  identity: string;
  read: () => Promise<void>;
};

function describeTiming(bucket: Timings) {
  return { latencyMs: quantiles(bucket.elapsedMs), failures: bucket.failures };
}

/** Measures one test run. Never serializes SQL, binds, HTTP bodies, identities or credentials. */
export async function profileScratchAssetReads(input: {
  pool: pg.Pool;
  checkpointsPerProject: number;
  prepare: () => Promise<readonly Participant[]>;
}): Promise<void> {
  const { pool } = input;
  const samples = sizes.flatMap((users) => variants.map((variant) => newSample(users, variant)));
  const originalConnect = pool.connect;
  const originalQueries = new Map<pg.PoolClient, pg.PoolClient['query']>();
  const originalLoad = PgProjectRepository.prototype.load;
  const originalOpen = S3BlocksBlobStore.prototype.open;
  let active: Sample | null = null;
  let participantCount = 0;
  let correctness = 'FAIL';

  const onAcquire = (client: pg.PoolClient) => {
    if (!active || originalQueries.has(client)) return;
    const original = client.query;
    originalQueries.set(client, original);
    client.query = function (this: pg.PoolClient, ...args: unknown[]) {
      const scope = active;
      if (!scope) return Reflect.apply(original, this, args);
      const stage = sqlStage(args[0]);
      let bucket = scope.sql.get(stage);
      if (!bucket) {
        bucket = timings();
        scope.sql.set(stage, bucket);
      }
      return observePgCall(
        (parameters) => Reflect.apply(original, this, parameters),
        args,
        sampleTiming(scope, bucket),
      );
    } as typeof client.query;
  };
  const load = vi.spyOn(PgProjectRepository.prototype, 'load').mockImplementation(async function (
    this: PgProjectRepository,
    tenant,
    project,
    actor,
    options,
  ) {
    const scope = active;
    if (!scope) return originalLoad.call(this, tenant, project, actor, options);
    assert.equal(options?.includeVersions, false, 'candidate asset GET must omit history');
    // Same runtime, fixtures, reads and permissions. Only request the unused
    // version history for the comparator, as the previous runtime did.
    const result = await originalLoad.call(
      this,
      tenant,
      project,
      actor,
      scope.variant === 'with-version-history' ? undefined : options,
    );
    scope.versionRows += result?.versions.length ?? 0;
    return result;
  });
  const minio = vi.spyOn(S3BlocksBlobStore.prototype, 'open').mockImplementation(async function (
    this: S3BlocksBlobStore,
    ...args
  ) {
    const scope = active;
    if (!scope) return originalOpen.apply(this, args);
    const finish = sampleTiming(scope, scope.minioOpen);
    try {
      const result = await originalOpen.apply(this, args);
      finish(result === null);
      return result;
    } catch (problem) {
      finish(problem);
      throw problem;
    }
  });

  pool.on('acquire', onAcquire);
  pool.connect = function (this: pg.Pool, ...args: unknown[]) {
    const scope = active;
    if (!scope) return Reflect.apply(originalConnect, this, args);
    const result = observePgCall(
      (parameters) => Reflect.apply(originalConnect, this, parameters),
      args,
      sampleTiming(scope, scope.checkout),
    );
    scope.peakWaiting = Math.max(scope.peakWaiting, this.waitingCount);
    return result;
  } as typeof pool.connect;

  try {
    const actors = await input.prepare();
    participantCount = actors.length;
    assert.equal(participantCount, 30);
    assert.equal(new Set(actors.map((actor) => actor.identity)).size, participantCount);
    assert.equal(new Set(actors.map((actor) => actor.projectId)).size, participantCount);
    await Promise.allSettled(actors.map((actor) => actor.read())).then((settled) => {
      assert(
        settled.every((result) => result.status === 'fulfilled'),
        'Scratch warm-up failed',
      );
    });
    for (const users of sizes) {
      const participants = actors.slice(0, users);
      for (let repeat = 0; repeat < repetitions; repeat++) {
        const order = repeat % 2 === 0 ? variants : [...variants].reverse();
        for (const variant of order) {
          const scope = samples.find(
            (sample) => sample.users === users && sample.variant === variant,
          )!;
          active = scope;
          const results = await Promise.allSettled(
            participants.map(async (actor) => {
              const finish = sampleTiming(scope, scope.http);
              try {
                await actor.read();
                finish();
              } catch (problem) {
                finish(problem);
                throw problem;
              }
            }),
          );
          active = null;
          assert.equal(scope.pending, 0, 'profile finished with active measurements');
          assert(
            results.every((result) => result.status === 'fulfilled'),
            'profile read failed',
          );
        }
      }
    }
    for (const scope of samples) {
      const requests = scope.users * repetitions;
      assert.equal(scope.http.elapsedMs.length, requests);
      assert.equal(scope.minioOpen.elapsedMs.length, requests);
      assert.equal(scope.minioOpen.failures, 0);
      assert.equal(scope.checkout.failures, 0);
      assert(scope.checkout.elapsedMs.length >= requests, 'missing pool checkout evidence');
      assert.equal(scope.sql.get('project-authority')?.elapsedMs.length, 2 * requests);
      assert.equal(scope.sql.get('current-draft')?.elapsedMs.length, requests);
      assert.equal(scope.sql.get('asset-metadata')?.elapsedMs.length, requests);
      const history = scope.variant === 'with-version-history';
      assert.equal(scope.sql.get('version-history')?.elapsedMs.length ?? 0, history ? requests : 0);
      assert(
        history
          ? scope.versionRows >= requests * input.checkpointsPerProject
          : scope.versionRows === 0,
      );
      assert(
        [...scope.sql.values()].every((bucket) => bucket.failures === 0),
        'profile query failed',
      );
    }
    correctness = 'PASS';
  } finally {
    active = null;
    pool.connect = originalConnect;
    pool.off('acquire', onAcquire);
    for (const [client, query] of originalQueries) client.query = query;
    minio.mockRestore();
    load.mockRestore();

    const report = {
      schemaVersion: 1,
      sourceSha: process.env.GITHUB_SHA,
      correctness,
      participantCount,
      checkpointsCreatedPerProject: input.checkpointsPerProject,
      wavesPerVariant: repetitions,
      topology: 'loopback HTTP, real PostgreSQL and MinIO in disposable GitHub services',
      comparator: 'same build; test-only request to include unused project version history',
      runtimePoolMax: pool.options.max,
      samples: samples.map((scope) => ({
        users: scope.users,
        variant: scope.variant,
        fullResponse: describeTiming(scope.http),
        minioOpenToBodyHeaders: describeTiming(scope.minioOpen),
        sqlCalls: [...scope.sql.values()].reduce(
          (count, bucket) => count + bucket.elapsedMs.length,
          0,
        ),
        sqlByStage: Object.fromEntries(
          [...scope.sql.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([stage, bucket]) => [stage, describeTiming(bucket)]),
        ),
        versionRows: scope.versionRows,
        poolCheckout: describeTiming(scope.checkout),
        peakPoolWaiting: scope.peakWaiting,
        unfinishedSamples: scope.pending,
      })),
    };
    mkdirSync('reports/capacity', { recursive: true });
    writeFileSync('reports/capacity/scratch-asset-profile.json', JSON.stringify(report, null, 2));
  }
}
