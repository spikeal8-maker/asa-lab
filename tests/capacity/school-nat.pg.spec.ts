import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../../apps/api/dist/app.factory.js';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { FixtureCookieJar } from '../../tools/capacity/contracts.mjs';
import { edit } from './documents';

const ORIGIN = 'http://127.0.0.1:4610';
type Data = Record<string, any>;

// No production URL is accepted. Pools below independently require matching
// *_test databases. HTTP targets only this process's ephemeral loopback server.
describe.skipIf(process.env.ASA_SCHOOL_NAT_TEST !== '1')('isolated school NAT admission', () => {
  it('saves for 100 distinct Seat sessions behind one IP after its anonymous budget is exhausted', async () => {
    const admin = testAdminPool();
    const runtime = testAppPool();
    const report: Data = {
      schemaVersion: 1,
      sourceSha: process.env.GITHUB_SHA ?? null,
      profile: 'SCHOOL-NAT-100',
      verdict: 'FAIL',
      pupils: 100,
      acknowledged: 0,
      readBack: 0,
      failures: [],
    };
    const learners: { jar: FixtureCookieJar; project: string; revision: number; token: string }[] =
      [];
    let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
    let phase = 'setup';
    let failure: unknown;
    let base = '';
    const teacher = new FixtureCookieJar();
    async function drain(tasks: Promise<unknown>[]): Promise<void> {
      const results = await Promise.allSettled(tasks);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
    const rejections: Data[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any, ...args: any[]) => {
      if (typeof chunk === 'string' && chunk.startsWith('{"time"')) {
        try {
          const row = JSON.parse(chunk);
          if (row.kind === 'http_response' && row.status === 429)
            rejections.push({
              method: row.method,
              status: row.status,
              mutationAdmission: row.mutationAdmission,
            });
        } catch {
          /* Other diagnostics do not enter the bounded aggregate. */
        }
        const callback = args.find((value) => typeof value === 'function');
        callback?.();
        return true;
      }
      return (originalWrite as any)(chunk, ...args);
    });
    async function call(
      jar: FixtureCookieJar,
      method: string,
      path: string,
      body?: Data,
      expected = 200,
    ): Promise<Data> {
      if (!base.startsWith('http://127.0.0.1:') || !path.startsWith('/api/'))
        throw new Error('isolated_target_required');
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          origin: ORIGIN,
          cookie: jar.header(path),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      jar.receive(response.headers.getSetCookie(), path);
      const data = (await response.json()) as Data;
      if (response.status !== expected)
        report.failures.push({
          method,
          route: path.replace(/[0-9a-f-]{36}/g, ':id'),
          status: response.status,
          code: typeof data.error?.code === 'string' ? data.error.code.slice(0, 64) : null,
          retryAfter: response.headers.get('retry-after'),
        });
      expect(response.status, `${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`).toBe(expected);
      return data;
    }
    try {
      app = await createApiApp({
        pool: runtime,
        webDist: null,
        allowedWebOrigin: ORIGIN,
        logRequests: true,
      });
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      await call(
        teacher,
        'POST',
        '/api/auth/register',
        {
          email: `nat-${randomUUID()}@example.invalid`,
          username: `nat_${randomUUID().slice(0, 8)}`,
          displayName: 'Synthetic educator',
          password: `Test-${randomUUID()}-Only`,
          birthDate: '1990-01-01',
          country: 'RU',
        },
        201,
      );
      await call(teacher, 'POST', '/api/capabilities/educator/self-attest', {}, 201);
      const classroom = (
        await call(teacher, 'POST', '/api/classrooms', { title: 'Synthetic NAT class' }, 201)
      ).classroom;
      const info = (await call(teacher, 'GET', `/api/classrooms/${classroom.id}`)).classroom;
      for (let index = 0; index < 100; index++) {
        const seat = (
          await call(
            teacher,
            'POST',
            `/api/classrooms/${classroom.id}/seats`,
            { displayLabel: `Synthetic learner ${index}`, safeMode: true },
            201,
          )
        ).student;
        const jar = new FixtureCookieJar();
        await call(jar, 'POST', '/api/class-join/studentseat', {
          code: info.joinCode,
          studentCode: seat.studentCode,
        });
        const project = (
          await call(
            jar,
            'POST',
            '/api/projects',
            { module: 'electronics', scope: 'personal', title: 'Synthetic NAT project' },
            201,
          )
        ).project;
        const draft = (await call(jar, 'GET', `/api/projects/${project.id}`)).draft;
        const token = jar
          .header('/api/projects')
          .match(/(?:^|;\s*)asa_student_session=([^;]+)/)?.[1];
        if (!token) throw new Error('fixture_missing_seat_session');
        learners.push({
          jar,
          project: project.id,
          revision: draft.revision,
          token: decodeURIComponent(token),
        });
      }
      expect(new Set(learners.map((learner) => learner.token)).size).toBe(100);
      // Exercise the real generic HTTP hook, without project writes or DB work.
      // Stop at the first 429, so no timing-dependent assumption about setup's
      // exact mutation count is necessary.
      const anonymous = new FixtureCookieJar();
      let saturated = false;
      for (let n = 0; n < 901; n++) {
        const response = await fetch(`${base}/api/synthetic-nat-budget-probe`, {
          method: 'PUT',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: { origin: ORIGIN },
        });
        await response.arrayBuffer();
        if (response.status === 429) {
          saturated = true;
          break;
        }
        expect(response.status).toBe(404);
      }
      expect(saturated).toBe(true);
      expect(
        rejections.some((row) => row.mutationAdmission?.blockedBudget === 'anonymous_address'),
      ).toBe(true);
      report.anonymousCeilingEnforced = true;
      // Ordinary project reads authenticate every pupil and seed the server's
      // budget evidence, including pupils joining after the shared-IP threshold.
      phase = 'authenticated_project_reads';
      await drain(
        learners.map((learner) => call(learner.jar, 'GET', `/api/projects/${learner.project}`)),
      );
      let document = edit('electronics', 1);
      for (let wave = 0; wave < 2; wave++) {
        if (wave === 1) {
          phase = 'proof_expiry_wait';
          // These objects capture Date.now at construction. A later spy would
          // not advance their clocks, so use an actual bounded wall-clock wait.
          await new Promise((resolve) => setTimeout(resolve, 31_000));
          report.proofExpiryWaitMs = 31_000;
        }
        phase = `save_read_wave_${wave + 1}`;
        document = edit('electronics', wave + 1);
        await drain(
          learners.map(async (learner) => {
            const saved = (
              await call(learner.jar, 'PUT', `/api/projects/${learner.project}/draft`, {
                document,
                baseRevision: learner.revision,
                mutationId: randomUUID(),
              })
            ).draft;
            expect(saved.revision).toBe(learner.revision + 1);
            report.acknowledged++;
            const stored = (await call(learner.jar, 'GET', `/api/projects/${learner.project}`))
              .draft;
            expect(stored.revision).toBe(saved.revision);
            expect(stored.document).toEqual(document);
            report.readBack++;
            learner.revision = saved.revision;
          }),
        );
      }
      phase = 'revocation';
      const revoked = learners[0]!;
      await admin.query(
        'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
        [hashSessionToken(revoked.token)],
      );
      // A still-cached admission proof never replaces route authentication.
      await call(
        revoked.jar,
        'PUT',
        `/api/projects/${revoked.project}/draft`,
        { document, baseRevision: revoked.revision, mutationId: randomUUID() },
        401,
      );
      await call(revoked.jar, 'GET', `/api/projects/${revoked.project}`, undefined, 401);
      report.revokedSessionRejected = true;
      await call(anonymous, 'GET', `/api/projects/${learners[1]!.project}`, undefined, 401);
      report.anonymousReadRejected = true;
      report.verdict = 'PASS';
    } catch (error) {
      failure = error;
      report.failurePhase = phase;
      report.failureKind = 'fixture_assertion_or_request_failed';
      throw error;
    } finally {
      vi.restoreAllMocks();
      report.admissionRejections = rejections;
      // App shutdown owns the injected runtime pool. Drain all HTTP work above
      // before closing it, and never let cleanup replace the first test error.
      const cleanup = await Promise.allSettled([
        app ? app.close() : Reflect.get(runtime, 'ended') ? Promise.resolve() : runtime.end(),
        admin.end(),
      ]);
      report.cleanupFailures = cleanup.filter((result) => result.status === 'rejected').length;
      mkdirSync('reports/capacity', { recursive: true });
      writeFileSync('reports/capacity/school-nat.json', JSON.stringify(report, null, 2));
      if (!failure && report.cleanupFailures) throw new Error('fixture_cleanup_failed');
    }
  }, 120_000);
});
