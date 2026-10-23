import { edit, CAPACITY_PNG, CAPACITY_ASSET } from './documents';
import { createHash, randomUUID } from 'node:crypto';
import { BLOCKS_DRAFT_CONTENT_TYPE } from '../../apps/api/dist/blocks-runtime-transport.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import pg from 'pg';
import { describe, it, expect, vi } from 'vitest';
import { OpenProjectUseCase, PgProjectRepository } from '../../contexts/projects/dist/index.js';
import {
  createApiApp,
  poolSettings,
  analyticsPoolSettings,
} from '../../apps/api/dist/app.factory.js';
import {
  assertIsolatedEnvironment,
  digest,
  profile,
  quantiles,
  validateProfile,
  sessionIdentity,
  baselineSlo,
  requestFailure,
  FixtureCookieJar,
} from '../../tools/capacity/contracts.mjs';

const ORIGIN = 'http://127.0.0.1:4612';
type Data = Record<string, unknown>;
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
  document?: Data;
};
type Observation = {
  phase: string;
  operation: string;
  status: number;
  ok: boolean;
  durationMs: number;
  sentBytes: number;
  receivedBytes: number;
  failure: string | null;
  responseComplete: boolean;
};
function object(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_fixture_response');
  return value as Data;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
    throw new Error('missing_fixture_identity');
  return value;
}
// Opt-in workload, not part of ordinary access/data/test runs.
describe.skipIf(process.env.ASA_CAPACITY_BASELINE !== '1')(
  'isolated classroom backend baseline',
  () => {
    it('measures30 independent sessions and verifies acknowledged save/reopen correctness', async () => {
      assertIsolatedEnvironment(process.env);
      const p = validateProfile(profile());
      const b = p.backendBaseline;
      const runtime = new pg.Pool({
        connectionString: process.env.APP_TEST_DATABASE_URL,
        ...poolSettings(),
      });
      const analytics = new pg.Pool({
        connectionString: process.env.APP_TEST_DATABASE_URL,
        ...analyticsPoolSettings(),
      });
      // One reserved observer connection; never borrow the application's pool.
      const observer = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 2000,
        statement_timeout: 1000,
        query_timeout: 1500,
        options: '-c default_transaction_read_only=on',
      });
      const loop = monitorEventLoopDelay({ resolution: 20 });
      // Observe the actual API reader; all repository/permission/SQL work still executes.
      const opened = vi.spyOn(OpenProjectUseCase.prototype, 'execute');
      const projectLoads = vi.spyOn(PgProjectRepository.prototype, 'load');
      let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
      const records: Observation[] = [];
      const samples: {
        elapsedMs: number;
        poolTotal: number;
        poolIdle: number;
        poolWaiting: number;
        analyticsTotal: number;
        analyticsIdle: number;
        analyticsWaiting: number;
        databaseConnections: number;
        blockedConnections: number;
        lockWaiters: number;
        rssBytes: number;
      }[] = [];
      let sampleErrors = 0;
      let samplePending: Promise<void> | undefined;
      let sampler: ReturnType<typeof setInterval> | undefined;
      let phase = 'setup',
        inFlight = 0,
        peakInFlight = 0,
        peakActorInFlight = 0;
      let identityChecks = 0;
      let mediaUploads = 0,
        mediaReads = 0;
      let acknowledged = 0,
        verified = 0,
        denied = 0,
        conflicts = 0,
        retriedReceipts = 0;
      let steadyStarted = 0,
        setupComplete = false,
        success = false;
      let workloadCpu = process.cpuUsage();
      const actors: Actor[] = Array.from({ length: b.sessions }, (_, index) => ({
        index,
        kind: index % 2 === 0 ? 'account' : 'seat',
        module: index < b.blocks ? 'blocks' : 'electronics',
        jar: new FixtureCookieJar(),
        credentials: {},
      }));
      const active = new Set<number>();
      const now = () => performance.now();
      async function call(
        actor: Actor,
        operation: string,
        method: string,
        path: string,
        body?: unknown,
        expected = [200],
        capability?: string,
      ): Promise<Data> {
        if (!path.startsWith('/api/') || path.includes('://'))
          throw new Error('invalid_fixture_target');
        const started = now(),
          requestPhase = phase;
        const binary = body instanceof Uint8Array;
        const text =
          body === undefined ? undefined : binary ? Buffer.from(body) : JSON.stringify(body);
        const measuredActor = actor.index >= 0;
        let status = 0,
          ok = false,
          receivedBytes = 0;
        let failure: string | null = null;
        let responseComplete = false;
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        if (measuredActor) active.add(actor.index);
        peakActorInFlight = Math.max(peakActorInFlight, active.size);
        try {
          const response = await fetch(`${ORIGIN}${path}`, {
            method,
            redirect: 'error',
            signal: AbortSignal.timeout(b.requestTimeoutMs),
            headers: {
              origin: ORIGIN,
              ...(text
                ? {
                    'content-type': binary
                      ? 'image/png'
                      : path.startsWith('/api/blocks/runtime/')
                        ? BLOCKS_DRAFT_CONTENT_TYPE
                        : 'application/json',
                  }
                : {}),
              cookie: actor.jar.header(path),
              ...(capability ? { authorization: `Bearer ${capability}` } : {}),
              ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
            },
            body: binary ? new Uint8Array(text as Buffer).buffer : (text as string | undefined),
          });
          status = response.status;
          actor.jar.receive(response.headers.getSetCookie(), path);
          const raw = Buffer.from(await response.arrayBuffer());
          responseComplete = true;
          receivedBytes = raw.length;
          if (!expected.includes(status)) throw new Error('unexpected_fixture_status');
          const data = response.headers.get('content-type')?.startsWith('image/png')
            ? { assetSha256: createHash('sha256').update(raw).digest('hex') }
            : object(JSON.parse(raw.toString('utf8')));
          ok = true;
          return { ...data, fixtureStatus: status };
        } catch (error) {
          failure = requestFailure(error, status);
          throw error;
        } finally {
          records.push({
            phase: requestPhase,
            operation,
            status,
            ok,
            durationMs: now() - started,
            sentBytes: text ? Buffer.byteLength(text) : 0,
            receivedBytes,
            failure,
            responseComplete,
          });
          inFlight--;
          if (measuredActor) active.delete(actor.index);
        }
      }
      function sample() {
        if (samplePending) return samplePending;
        samplePending = (async () => {
          try {
            const result = await observer.query(`
              SELECT count(*)::int AS connections,
                count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid)) > 0)::int AS blocked,
                count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_waiters
              FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
            `);
            const row = result.rows[0];
            samples.push({
              elapsedMs: Math.round(now() - steadyStarted),
              poolTotal: runtime.totalCount,
              poolIdle: runtime.idleCount,
              poolWaiting: runtime.waitingCount,
              analyticsTotal: analytics.totalCount,
              analyticsIdle: analytics.idleCount,
              analyticsWaiting: analytics.waitingCount,
              databaseConnections: row.connections,
              blockedConnections: row.blocked,
              lockWaiters: row.lock_waiters,
              rssBytes: process.memoryUsage().rss,
            });
          } catch {
            sampleErrors++;
          }
        })().finally(() => {
          samplePending = undefined;
        });
        return samplePending;
      }
      async function wave(work: (actor: Actor) => Promise<void>) {
        const results = await Promise.allSettled(actors.map(work));
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('workload_actor_failure');
      }
      async function verify(actor: Actor) {
        const read = await call(actor, 'project_read', 'GET', `/api/projects/${actor.project}`);
        const draft = object(read.draft);
        if (digest(draft.document) !== digest(actor.document) || draft.revision !== actor.revision)
          throw new Error('acknowledged_save_mismatch');
        verified++;
      }
      async function save(actor: Actor, waveIndex: number) {
        actor.document = edit(actor.module, waveIndex);
        const payload = {
          document: actor.document,
          baseRevision: actor.revision,
          mutationId: randomUUID(),
        };
        const path =
          actor.module === 'blocks'
            ? `/api/blocks/runtime/projects/${actor.project}/draft`
            : `/api/projects/${actor.project}/draft`;
        const response = await call(actor, 'save', 'PUT', path, payload, [200], actor.capability);
        actor.revision = Number(
          actor.module === 'blocks' ? response.revision : object(response.draft).revision,
        );
        if (!Number.isSafeInteger(actor.revision)) throw new Error('missing_save_revision');
        acknowledged++;
        await verify(actor);
        if (actor.module === 'blocks' && waveIndex === 1) {
          const media = await call(
            actor,
            'asset_read',
            'GET',
            `/api/blocks/runtime/projects/${actor.project}/assets/${CAPACITY_ASSET.assetId}.png`,
            undefined,
            [200],
            actor.capability,
          );
          if (media.assetSha256 !== CAPACITY_ASSET.sha256)
            throw new Error('asset_roundtrip_mismatch');
          mediaReads++;
        }
        if (waveIndex === 1 && [0, b.blocks].includes(actor.index)) {
          // Model a lost acknowledgement by replaying the exact mutation, not a new write.
          const retry = await call(
            actor,
            'save_receipt_retry',
            'PUT',
            path,
            payload,
            [200],
            actor.capability,
          );
          const revision = Number(
            actor.module === 'blocks' ? retry.revision : object(retry.draft).revision,
          );
          if (revision !== actor.revision) throw new Error('retry_created_new_revision');
          retriedReceipts++;
          await call(
            actor,
            'expected_revision_conflict',
            'PUT',
            path,
            { ...payload, mutationId: randomUUID(), document: edit(actor.module, 999) },
            [409],
            actor.capability,
          );
          conflicts++;
          await verify(actor);
        }
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
        };
        const registration = (index: number) => ({
          email: `capacity-${process.env.GITHUB_RUN_ID}-${index}@example.invalid`,
          username: `cap_${process.env.GITHUB_RUN_ID}_${index}`,
          displayName: 'Synthetic capacity fixture',
          password: `Test-${randomUUID()}-Only`,
          birthDate: '1990-01-01',
          country: 'RU',
        });
        await call(
          teacher,
          'setup_register',
          'POST',
          '/api/auth/register',
          registration(99),
          [201],
        );
        await call(
          teacher,
          'setup_educator',
          'POST',
          '/api/capabilities/educator/self-attest',
          {},
          [201],
        );
        const classroom = object(
          (
            await call(
              teacher,
              'setup_class',
              'POST',
              '/api/classrooms',
              { title: 'Synthetic capacity class' },
              [201],
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
            await call(actor, 'setup_register', 'POST', '/api/auth/register', input, [201]);
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
                  [201],
                )
              ).student,
            );
            actor.credentials = { code: info.joinCode, studentCode: student.studentCode };
          }
        }
        setupComplete = true;
        phase = 'admission';
        loop.enable();
        workloadCpu = process.cpuUsage();
        steadyStarted = now();
        await sample();
        sampler = setInterval(() => {
          void sample();
        }, b.sampleIntervalMs);
        await wave(async (actor) => {
          await call(
            actor,
            'login',
            'POST',
            actor.kind === 'account' ? '/api/auth/login' : '/api/class-join/studentseat',
            actor.credentials,
          );
          const me = await call(
            actor,
            'identity_read',
            'GET',
            actor.kind === 'account' ? '/api/auth/me' : '/api/class-join/me',
          );
          actor.identity = sessionIdentity(actor.kind, me);
          identityChecks++;
        });
        if (
          new Set(actors.map((actor) => actor.identity)).size !== b.sessions ||
          new Set(actors.map((actor) => [...actor.jar.values()].join('|'))).size !== b.sessions
        )
          throw new Error('identities_not_independent');
        phase = 'workload';
        await wave(async (actor) => {
          const created = object(
            (
              await call(
                actor,
                'project_create',
                'POST',
                '/api/projects',
                { module: actor.module, scope: 'personal', title: 'Synthetic workload' },
                [201],
              )
            ).project,
          );
          actor.project = uuid(created.id);
          const opened = await call(actor, 'project_read', 'GET', `/api/projects/${actor.project}`);
          actor.revision = Number(object(opened.draft).revision);
          if (actor.module === 'blocks') {
            const session = await call(
              actor,
              'runtime_session',
              'POST',
              `/api/projects/${actor.project}/blocks/runtime-session`,
              {},
            );
            if (typeof session.runtimeToken !== 'string')
              throw new Error('missing_runtime_capability');
            actor.capability = session.runtimeToken;
            const upload = await call(
              actor,
              'asset_upload',
              'PUT',
              `/api/blocks/runtime/projects/${actor.project}/assets/${CAPACITY_ASSET.assetId}.png`,
              CAPACITY_PNG,
              [200],
              actor.capability,
            );
            if (object(upload.asset).sha256 !== CAPACITY_ASSET.sha256)
              throw new Error('asset_upload_mismatch');
            mediaUploads++;
          }
        });
        const waveStarted = now();
        await wave((actor) => save(actor, 1));
        for (const seconds of b.identityProbeSeconds) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, waveStarted + seconds * 1000 - now())),
          );
          await wave(async (actor) => {
            const me = await call(
              actor,
              'identity_read',
              'GET',
              actor.kind === 'account' ? '/api/auth/me' : '/api/class-join/me',
            );
            sessionIdentity(actor.kind, me, actor.identity);
            identityChecks++;
          });
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, waveStarted + b.waveIntervalSeconds * 1000 - now())),
        );
        await wave((actor) => save(actor, 2));
        phase = 'negative';
        for (const actor of [actors[0], actors[b.blocks]]) {
          const foreign = actors[(actor.index + 1) % actors.length];
          await call(
            actor,
            'expected_ownership_denial',
            'GET',
            `/api/projects/${foreign.project}`,
            undefined,
            [403, 404],
          );
          denied++;
        }
        if (sampler) clearInterval(sampler);
        await samplePending;
        await sample();
        expect(acknowledged).toBe(b.sessions * b.saveWaves);
        expect(verified).toBe(acknowledged + 2);
        expect(conflicts).toBe(2);
        expect(retriedReceipts).toBe(2);
        expect(denied).toBe(2);
        expect(peakActorInFlight).toBe(b.sessions);
        expect(mediaUploads).toBe(b.blocks);
        expect(mediaReads).toBe(b.blocks);
        expect(identityChecks).toBe(b.sessions * (b.identityProbeSeconds.length + 1));
        expect(records.filter((r) => r.phase !== 'setup' && !r.ok)).toHaveLength(0);
        expect(sampleErrors, 'database observation failed').toBe(0);
        expect(samples.length, 'database observations missing').toBeGreaterThan(0);
        expect(opened).toHaveBeenCalledTimes(
          records.filter(
            (r) => r.operation === 'project_read' || r.operation === 'expected_ownership_denial',
          ).length,
        );
        expect(
          projectLoads.mock.calls.filter((call) => call[3]?.includeVersions === false),
        ).toHaveLength(acknowledged + retriedReceipts + conflicts * 2);
        success = true;
      } finally {
        const steadyEnded = now();
        if (sampler) clearInterval(sampler);
        await samplePending;
        loop.disable();
        const elapsedSeconds = steadyStarted ? (steadyEnded - steadyStarted) / 1000 : 0;
        const measured = records.filter((r) => r.phase !== 'setup');
        const groups = Object.fromEntries(
          [...new Set(measured.map((r) => r.operation))].sort().map((operation) => {
            const rows = measured.filter((r) => r.operation === operation);
            return [
              operation,
              {
                offered: rows.length,
                headersReceived: rows.filter((r) => r.status !== 0).length,
                completed: rows.filter((r) => r.responseComplete).length,
                unexpected: rows.filter((r) => !r.ok).length,
                failures: Object.fromEntries(
                  ['timeout', 'transport', 'response'].map((kind) => [
                    kind,
                    rows.filter((r) => r.failure === kind).length,
                  ]),
                ),
                status: Object.fromEntries(
                  [...new Set(rows.map((r) => r.status))].map((status) => [
                    status,
                    rows.filter((r) => r.status === status).length,
                  ]),
                ),
                latencyMs: quantiles(rows.map((r) => r.durationMs)),
                sentBytes: rows.reduce((n, r) => n + r.sentBytes, 0),
                receivedBytes: rows.reduce((n, r) => n + r.receivedBytes, 0),
              },
            ];
          }),
        );
        const observedSlo = {
          loginP95Ms: quantiles(
            measured.filter((r) => r.operation === 'login').map((r) => r.durationMs),
          ).p95,
          readP95Ms: quantiles(
            measured.filter((r) => r.operation === 'project_read').map((r) => r.durationMs),
          ).p95,
          saveP95Ms: quantiles(
            measured.filter((r) => r.operation === 'save').map((r) => r.durationMs),
          ).p95,
        };
        const report = {
          schemaVersion: 2,
          sourceSha: process.env.GITHUB_SHA,
          profileId: p.id,
          profileDigest: digest(p),
          executedProfile: b.id,
          correctness: success ? 'PASS' : 'FAIL',
          capacityAcceptance: 'NOT_EVALUATED',
          setupComplete,
          environment: {
            runner: 'GitHub hosted isolated',
            platform: process.platform,
            node: process.version,
            logicalCpus: availableParallelism(),
            memoryBytes: totalmem(),
            topology:
              'API and closed-loop generator share one Node process; PostgreSQL and MinIO disposable containers',
            runtimePoolMax: runtime.options.max,
            analyticsPoolMax: analytics.options.max,
          },
          workload: {
            verifiedIdentityChecks: identityChecks,
            plannedSessions: b.sessions,
            admittedDistinctIdentities: new Set(actors.map((a) => a.identity).filter(Boolean)).size,
            accountSessions: actors.filter((a) => a.identity && a.kind === 'account').length,
            studentSeatSessions: actors.filter((a) => a.identity && a.kind === 'seat').length,
            openedProjects: actors.filter((a) => a.project).length,
            peakActorInFlight,
            peakInFlight,
            durationSeconds: elapsedSeconds,
            offeredOperations: measured.length,
            offeredAverageRps: elapsedSeconds ? measured.length / elapsedSeconds : null,
            saveWaves: b.saveWaves,
            waveIntervalSeconds: b.waveIntervalSeconds,
          },
          saves: {
            mediaUploadsVerified: mediaUploads,
            mediaReadsVerified: mediaReads,
            acknowledged,
            verifiedReads: verified,
            expected: b.sessions * b.saveWaves,
            receiptRetriesVerified: retriedReceipts,
            staleWritesRejected: conflicts,
            ownershipReadsDenied: denied,
          },
          fullProjectReads: {
            explicitRequests: records.filter(
              (r) => r.operation === 'project_read' || r.operation === 'expected_ownership_denial',
            ).length,
            actualOpens: opened.mock.calls.length,
            // Includes setup reads; zero means no extra full reopen was caused by a save.
            extraOpens:
              opened.mock.calls.length -
              records.filter(
                (r) =>
                  r.operation === 'project_read' || r.operation === 'expected_ownership_denial',
              ).length,
          },
          draftReads: {
            // The two stale attempts each require an initial read and a conflict fallback.
            expectedWithoutHistory: acknowledged + retriedReceipts + conflicts * 2,
            actualWithoutHistory: projectLoads.mock.calls.filter(
              (call) => call[3]?.includeVersions === false,
            ).length,
          },
          observedSlo,
          targetSlo: p.slo,
          baselineSlo: baselineSlo({
            correctness: success ? 'PASS' : 'FAIL',
            observed: observedSlo,
            targets: p.slo,
            unexpected: measured.filter((r) => !r.ok).length,
            samples: samples.length,
            sampleErrors,
          }),
          groups,
          resources: {
            sampleIntervalMs: b.sampleIntervalMs,
            sampleErrors,
            observerConnectionsReserved: 1,
            databaseCountsExcludeObserver: true,
            samples,
            processCpuMicros: process.cpuUsage(workloadCpu),
            sharedEventLoopP95Ms: Number.isFinite(loop.percentile(95))
              ? loop.percentile(95) / 1e6
              : null,
            sharedEventLoopMaxMs: loop.max / 1e6,
          },
          missingEvidence: b.missingLayers,
          restrictions: [
            'not3000-or5000-acceptance',
            'not-browser-class30',
            'not-production-topology',
            'closed-loop-generator-can-hide-overload',
            'sparse-pool-sampling-can-miss-short-peaks',
            'no-live-site-or-working-database',
          ],
        };
        try {
          mkdirSync('reports/capacity', { recursive: true });
          writeFileSync('reports/capacity/backend30.json', JSON.stringify(report, null, 2));
        } finally {
          opened.mockRestore();
          projectLoads.mockRestore();
          await observer.end();
          if (app) await app.close();
          else {
            await runtime.end();
            await analytics.end();
          }
        }
        console.info(
          JSON.stringify({
            capacityBaseline: report.correctness,
            sessions: report.workload.admittedDistinctIdentities,
            acknowledged,
            verified,
            capacityAcceptance: report.capacityAcceptance,
            baselineSlo: report.baselineSlo.verdict,
          }),
        );
      }
    }, 180000);
  },
);
