import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { availableParallelism, totalmem, freemem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import pg from 'pg';
import { describe, it, expect } from 'vitest';
import {
  createApiApp,
  poolSettings,
  analyticsPoolSettings,
} from '../../apps/api/dist/app.factory.js';
import { BLOCKS_DRAFT_CONTENT_TYPE } from '../../apps/api/dist/blocks-runtime-transport.js';
import { edit, CAPACITY_PNG, CAPACITY_ASSET } from './documents';
import {
  assertIsolatedEnvironment,
  digest,
  quantiles,
  sessionIdentity,
  FixtureCookieJar,
  requestFailure,
} from '../../tools/capacity/contracts.mjs';
import {
  SOAK,
  instrumentPool,
  scheduledStage,
  stageVerdict,
  summarizePool,
} from '../../tools/capacity/soak.mjs';

const ORIGIN = 'http://127.0.0.1:4612';
type Data = Record<string, any>;
type Actor = {
  index: number;
  kind: 'account' | 'seat';
  module: 'blocks' | 'electronics';
  jar: FixtureCookieJar;
  credentials: Data;
  identity?: string;
  project?: string;
  revision?: number;
  capability?: string;
  saves: number;
};
const object = (value: any): Data => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_fixture_response');
  return value;
};
const uuid = (value: any): string => {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
    throw new Error('invalid_fixture_uuid');
  return value;
};

describe.skipIf(process.env.ASA_CAPACITY_SOAK !== '1')('isolated gradual backend soak', () => {
  it('holds each passing stage for ten minutes and measures actual pool borrowing', async () => {
    assertIsolatedEnvironment(process.env);
    const runtime = new pg.Pool({
      connectionString: process.env.APP_TEST_DATABASE_URL,
      ...poolSettings(),
    });
    const analytics = new pg.Pool({
      connectionString: process.env.APP_TEST_DATABASE_URL,
      ...analyticsPoolSettings(),
    });
    const observer = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 2000,
      statement_timeout: 1000,
      query_timeout: 1500,
      options: '-c default_transaction_read_only=on',
    });
    const loop = monitorEventLoopDelay({ resolution: 20 });
    const stages: Data[] = [],
      setupRequests: Data[] = [];
    const actors: Actor[] = Array.from({ length: 100 }, (_, index) => ({
      index,
      kind: index % 2 === 0 ? 'account' : 'seat',
      module: index % 4 < 2 ? 'blocks' : 'electronics',
      jar: new FixtureCookieJar(),
      credentials: {},
      saves: 0,
    }));
    let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
    let stage: Data | undefined,
      fatalReason: string | null = null,
      setupComplete = false;
    let sampler: ReturnType<typeof setInterval> | undefined, sampling: Promise<void> | undefined;
    const started = performance.now();
    const report: Data = {
      schemaVersion: 1,
      sourceSha: process.env.GITHUB_SHA,
      profile: 'BACKEND-SOAK-30-60-100-V1',
      policy: SOAK,
      verdict: 'RUNNING',
      setupComplete: false,
      capacityAcceptance: 'NOT_EVALUATED',
      stages,
      environment: {
        runner: 'GitHub hosted isolated',
        node: process.version,
        logicalCpus: availableParallelism(),
        memoryBytes: totalmem(),
        runtimePoolMax: runtime.options.max,
        analyticsPoolMax: analytics.options.max,
        observerConnectionsReserved: 1,
        topology:
          'API and open-arrival scheduler share one Node process; disposable PostgreSQL and MinIO',
      },
      restrictions: [
        'not-production-capacity',
        'not-3000-or5000-acceptance',
        'no-browser-VM-or-rendering',
        'tiny-documents-and-one-tiny-asset',
        'no-external-ingress-or-Caddy',
        'no-host-restart-or-dependency-failure',
        'all100-identities-precreated-admission-not-capacity-tested',
        'save-every10s-is-diagnostic-stress-not60s-autosave',
        'shared-generator-API-event-loop',
      ],
    };
    const instrument = (pool: pg.Pool, name: string) =>
      instrumentPool(pool, (row: Data) => {
        const destination = stage;
        if (destination) destination.pool[name].push(row);
        return (holdMs: number) => {
          row.holdMs = holdMs;
        };
      });
    const restoreMain = instrument(runtime, 'main'),
      restoreAnalytics = instrument(analytics, 'analytics');
    function summarize(s: Data) {
      const groups = Object.fromEntries(
        [...new Set(s.requests.map((r: Data) => r.operation))].map((operation) => {
          const rows = s.requests.filter((r: Data) => r.operation === operation);
          return [
            operation,
            {
              offered: rows.length,
              completed: rows.filter((r: Data) => r.complete).length,
              unexpected: rows.filter((r: Data) => !r.ok).length,
              latencyMs: quantiles(rows.map((r: Data) => r.durationMs)),
              status: Object.fromEntries(
                [...new Set(rows.map((r: Data) => r.status))].map((status) => [
                  status,
                  rows.filter((r: Data) => r.status === status).length,
                ]),
              ),
              failures: Object.fromEntries(
                ['timeout', 'transport', 'response'].map((failure) => [
                  failure,
                  rows.filter((r: Data) => r.failure === failure).length,
                ]),
              ),
            },
          ];
        }),
      );
      const pools = {
        main: summarizePool(s.pool.main),
        analytics: summarizePool(s.pool.analytics),
      };
      return {
        sessions: s.sessions,
        durationSeconds: (performance.now() - s.started) / 1000,
        completed: s.completed,
        verdict: s.verdict,
        checks: s.checks,
        groups,
        pools,
        acknowledged: s.acknowledged,
        verifiedReads: s.verified,
        identitiesVerified: s.identities.size,
        saveChainsPerIdentity: {
          min: Math.min(...s.actorChains),
          max: Math.max(...s.actorChains),
        },
        schedule: s.schedule ? { ...s.schedule, lagMs: quantiles(s.schedule.lagMs) } : null,
        resourceSampleErrors: s.sampleErrors,
        resources: s.samples,
        eventLoopP95Ms: loop.percentile(95) / 1e6,
        eventLoopMaxMs: loop.max / 1e6,
        processCpuMicros: process.cpuUsage(s.cpuStarted),
      };
    }
    function checkpoint() {
      mkdirSync('reports/capacity', { recursive: true });
      const output = {
        ...report,
        elapsedSeconds: (performance.now() - started) / 1000,
        fatalReason,
        setupComplete,
        setup: {
          requests: setupRequests.length,
          unexpected: setupRequests.filter((r) => !r.ok).length,
          admittedDistinctIdentities: new Set(actors.map((a) => a.identity).filter(Boolean)).size,
          openedProjects: actors.filter((a) => a.project).length,
        },
        stages: stages.map((s) => s.final ?? summarize(s)),
      };
      writeFileSync('reports/capacity/backend-soak.tmp.json', JSON.stringify(output, null, 2));
      renameSync('reports/capacity/backend-soak.tmp.json', 'reports/capacity/backend-soak.json');
    }
    async function call(
      actor: Actor,
      operation: string,
      method: string,
      path: string,
      body?: unknown,
      expected = 200,
      capability?: string,
    ): Promise<Data> {
      if (!path.startsWith('/api/') || path.includes('://'))
        throw new Error('invalid_fixture_target');
      const begin = performance.now(),
        destination = stage?.requests ?? setupRequests;
      const binary = body instanceof Uint8Array;
      const text =
        body === undefined ? undefined : binary ? Buffer.from(body) : JSON.stringify(body);
      let status = 0,
        ok = false,
        complete = false,
        failure: string | null = null;
      try {
        const response = await fetch(`${ORIGIN}${path}`, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(SOAK.requestTimeoutMs),
          headers: {
            origin: ORIGIN,
            cookie: actor.jar.header(path),
            ...(text
              ? {
                  'content-type': binary
                    ? 'image/png'
                    : path.startsWith('/api/blocks/runtime/')
                      ? BLOCKS_DRAFT_CONTENT_TYPE
                      : 'application/json',
                }
              : {}),
            ...(capability ? { authorization: `Bearer ${capability}` } : {}),
            ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
          },
          body: binary ? new Uint8Array(text as Buffer).buffer : (text as string | undefined),
        });
        status = response.status;
        actor.jar.receive(response.headers.getSetCookie(), path);
        const raw = Buffer.from(await response.arrayBuffer());
        complete = true;
        if (status !== expected) throw new Error('unexpected_fixture_status');
        const data =
          binary && response.headers.get('content-type')?.startsWith('image/png')
            ? { assetSha256: createHash('sha256').update(raw).digest('hex') }
            : object(JSON.parse(raw.toString('utf8')));
        ok = true;
        return data;
      } catch (error) {
        failure = requestFailure(error, status);
        fatalReason ??= `${operation}_${failure}_${status}`;
        throw new Error(fatalReason);
      } finally {
        destination.push({
          operation,
          status,
          ok,
          complete,
          failure,
          durationMs: performance.now() - begin,
        });
      }
    }
    async function identity(actor: Actor) {
      const me = await call(
        actor,
        'identity',
        'GET',
        actor.kind === 'account' ? '/api/auth/me' : '/api/class-join/me',
      );
      actor.identity = sessionIdentity(actor.kind, me, actor.identity);
      stage?.identities.add(actor.index);
    }
    async function capability(actor: Actor) {
      const session = await call(
        actor,
        'runtime_renewal',
        'POST',
        `/api/projects/${actor.project}/blocks/runtime-session`,
        {},
      );
      if (typeof session.runtimeToken !== 'string') throw new Error('missing_runtime_capability');
      actor.capability = session.runtimeToken;
    }
    async function chain(actor: Actor) {
      try {
        if (actor.saves % 6 === 0) {
          await identity(actor);
          if (actor.module === 'blocks') await capability(actor);
        }
        const document = edit(actor.module, actor.saves + 1);
        const response = await call(
          actor,
          'save',
          'PUT',
          actor.module === 'blocks'
            ? `/api/blocks/runtime/projects/${actor.project}/draft`
            : `/api/projects/${actor.project}/draft`,
          { document, baseRevision: actor.revision, mutationId: randomUUID() },
          200,
          actor.capability,
        );
        const revision = Number(
          actor.module === 'blocks' ? response.revision : object(response.draft).revision,
        );
        if (!Number.isSafeInteger(revision) || revision !== Number(actor.revision) + 1)
          throw new Error('invalid_acknowledged_revision');
        stage!.acknowledged++;
        const read = await call(actor, 'project_read', 'GET', `/api/projects/${actor.project}`);
        const draft = object(read.draft);
        if (draft.revision !== revision || digest(draft.document) !== digest(document))
          throw new Error('acknowledged_save_mismatch');
        stage!.verified++;
        stage!.actorChains[actor.index]++;
        actor.revision = revision;
        actor.saves++;
      } catch {
        fatalReason ??= 'save_chain_correctness_failure';
        throw new Error(fatalReason);
      }
    }
    function sample() {
      if (sampling) return sampling;
      const s = stage;
      if (!s) return Promise.resolve();
      sampling = (async () => {
        try {
          const row = (
            await observer.query(`SELECT count(*)::int AS connections,
            count(*) FILTER(WHERE cardinality(pg_blocking_pids(pid)) > 0)::int AS blocked,
            count(*) FILTER(WHERE wait_event_type='Lock')::int AS lock_waiters
            FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`)
          ).rows[0];
          s.samples.push({
            elapsedMs: Math.round(performance.now() - s.started),
            mainTotal: runtime.totalCount,
            mainIdle: runtime.idleCount,
            mainWaiting: runtime.waitingCount,
            analyticsTotal: analytics.totalCount,
            analyticsIdle: analytics.idleCount,
            analyticsWaiting: analytics.waitingCount,
            databaseConnections: row.connections,
            blockedConnections: row.blocked,
            lockWaiters: row.lock_waiters,
            processRssBytes: process.memoryUsage().rss,
            hostFreeBytes: freemem(),
          });
          if (freemem() < totalmem() * 0.05 || process.memoryUsage().rss > totalmem() * 0.6)
            fatalReason ??= 'resource_pressure_guard';
          if (s.samples.length % 30 === 0) checkpoint();
        } catch {
          s.sampleErrors++;
          fatalReason ??= 'observer_failure';
        }
      })().finally(() => {
        sampling = undefined;
      });
      return sampling;
    }
    try {
      app = await createApiApp({
        pool: runtime,
        analyticsPool: analytics,
        webDist: null,
        allowedWebOrigin: ORIGIN,
        localApiPort: 4612,
        logRequests: false,
      });
      await app.listen(4612, '127.0.0.1');
      const teacher: Actor = {
        index: -1,
        kind: 'account',
        module: 'blocks',
        jar: new FixtureCookieJar(),
        credentials: {},
        saves: 0,
      };
      const registration = (index: number) => ({
        email: `soak-${process.env.GITHUB_RUN_ID}-${index}@example.invalid`,
        username: `soak_${process.env.GITHUB_RUN_ID}_${index}`,
        displayName: 'Synthetic capacity fixture',
        password: `Test-${randomUUID()}-Only`,
        birthDate: '1990-01-01',
        country: 'RU',
      });
      await call(teacher, 'setup_register', 'POST', '/api/auth/register', registration(999), 201);
      await call(
        teacher,
        'setup_educator',
        'POST',
        '/api/capabilities/educator/self-attest',
        {},
        201,
      );
      const classroom = object(
        (
          await call(
            teacher,
            'setup_class',
            'POST',
            '/api/classrooms',
            { title: 'Synthetic soak class' },
            201,
          )
        ).classroom,
      );
      const classroomId = uuid(classroom.id);
      const info = object(
        (await call(teacher, 'setup_class_read', 'GET', `/api/classrooms/${classroomId}`))
          .classroom,
      );
      for (const actor of actors) {
        if (actor.kind === 'account') {
          const input = registration(actor.index);
          await call(actor, 'setup_register', 'POST', '/api/auth/register', input, 201);
          actor.credentials = { email: input.email, password: input.password };
          actor.jar.clear();
        } else {
          const student = object(
            (
              await call(
                teacher,
                'setup_seat',
                'POST',
                `/api/classrooms/${classroomId}/seats`,
                { displayLabel: 'Synthetic learner', safeMode: true },
                201,
              )
            ).student,
          );
          actor.credentials = { code: info.joinCode, studentCode: student.studentCode };
        }
        await call(
          actor,
          'setup_login',
          'POST',
          actor.kind === 'account' ? '/api/auth/login' : '/api/class-join/studentseat',
          actor.credentials,
        );
        await identity(actor);
        const project = object(
          (
            await call(
              actor,
              'setup_project',
              'POST',
              '/api/projects',
              { module: actor.module, scope: 'personal', title: 'Synthetic soak project' },
              201,
            )
          ).project,
        );
        actor.project = uuid(project.id);
        actor.revision = Number(
          object((await call(actor, 'setup_read', 'GET', `/api/projects/${actor.project}`)).draft)
            .revision,
        );
        if (!Number.isSafeInteger(actor.revision)) throw new Error('invalid_initial_revision');
        if (actor.module === 'blocks') {
          await capability(actor);
          const upload = await call(
            actor,
            'setup_asset',
            'PUT',
            `/api/blocks/runtime/projects/${actor.project}/assets/${CAPACITY_ASSET.assetId}.png`,
            CAPACITY_PNG,
            200,
            actor.capability,
          );
          if (object(upload.asset).sha256 !== CAPACITY_ASSET.sha256)
            throw new Error('asset_upload_mismatch');
        }
      }
      if (
        new Set(actors.map((a) => a.identity)).size !== actors.length ||
        new Set(actors.map((a) => [...a.jar.values()].join('|'))).size !== actors.length
      )
        throw new Error('identities_not_independent');
      setupComplete = true;
      for (const sessions of SOAK.stages) {
        if (fatalReason) break;
        stage = {
          sessions,
          started: performance.now(),
          completed: false,
          verdict: 'RUNNING',
          requests: [],
          pool: { main: [], analytics: [] },
          samples: [],
          sampleErrors: 0,
          acknowledged: 0,
          verified: 0,
          identities: new Set(),
          actorChains: Array(sessions).fill(0),
          cpuStarted: process.cpuUsage(),
        };
        stages.push(stage);
        loop.reset();
        loop.enable();
        await sample();
        sampler = setInterval(() => {
          void sample();
        }, 1000);
        checkpoint();
        console.info(
          JSON.stringify({ soakStageStarted: sessions, plannedSeconds: SOAK.stageMs / 1000 }),
        );
        stage.schedule = await scheduledStage({
          actors: actors.slice(0, sessions),
          durationMs: SOAK.stageMs,
          periodMs: SOAK.periodMs,
          lateLimitMs: SOAK.lateLimitMs,
          work: chain,
          fatal: () => Boolean(fatalReason),
          onProgress: (progress: Data) => {
            stage!.schedule = progress;
          },
        });
        clearInterval(sampler);
        sampler = undefined;
        await sampling;
        await sample();
        loop.disable();
        const main = summarizePool(stage.pool.main);
        const assessment = stageVerdict({
          schedule: stage.schedule,
          saves: quantiles(
            stage.requests
              .filter((r: Data) => r.operation === 'save')
              .map((r: Data) => r.durationMs),
          ),
          reads: quantiles(
            stage.requests
              .filter((r: Data) => r.operation === 'project_read')
              .map((r: Data) => r.durationMs),
          ),
          checkout: main.checkoutMs,
          failedAcquires: main.failedAcquires,
          unreleasedAcquires: main.unreleasedAcquires,
          errors: stage.requests.filter((r: Data) => !r.ok).length + (fatalReason ? 1 : 0),
          sampleErrors: stage.sampleErrors,
          actorsVerified: stage.actorChains.filter((n: number) => n > 0).length,
          actorsExpected: sessions,
          acknowledged: stage.acknowledged,
          verified: stage.verified,
        });
        stage.verdict = assessment.verdict;
        stage.checks = assessment.checks;
        stage.completed = !fatalReason;
        stage.final = summarize(stage);
        checkpoint();
        console.info(
          JSON.stringify({
            soakStageCompleted: sessions,
            verdict: stage.verdict,
            saveP95Ms: stage.final.groups.save?.latencyMs.p95,
            checkoutP95Ms: main.checkoutMs.p95,
          }),
        );
        if (stage.verdict !== 'PASS') break;
        stage = undefined;
      }
      report.verdict =
        stages.length === SOAK.stages.length && stages.every((s) => s.verdict === 'PASS')
          ? 'PASS'
          : 'FAIL';
      expect(report.verdict, 'stage diagnostics failed; inspect preserved aggregate report').toBe(
        'PASS',
      );
    } catch (error) {
      fatalReason ??=
        error instanceof Error &&
        error.message === 'stage diagnostics failed; inspect preserved aggregate report'
          ? 'stage_gate_failed'
          : 'fixture_or_workload_failure';
      report.verdict = 'FAIL';
      throw new Error(`Backend soak ${fatalReason}; aggregate report preserved`);
    } finally {
      if (sampler) clearInterval(sampler);
      await sampling;
      loop.disable();
      try {
        checkpoint();
      } finally {
        await observer.end();
        if (app) await app.close();
        else {
          await runtime.end();
          await analytics.end();
        }
        restoreMain();
        restoreAnalytics();
      }
    }
  }, 2100000);
});
