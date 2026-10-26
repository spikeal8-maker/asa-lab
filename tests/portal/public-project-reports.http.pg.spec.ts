import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { buildTestApp, WEB_ORIGIN, type NestApp } from './app';
import { seedTeacher, type SeededTeacher } from './helpers';

interface PublicationFixture {
  publicationId: string;
  revisionId: string;
  projectId: string;
}

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

function disposableUrls(): { admin: URL; runtime: URL } {
  const sourceAdmin = process.env['TEST_DATABASE_URL'];
  const sourceRuntime = process.env['APP_TEST_DATABASE_URL'];
  if (!sourceAdmin || !sourceRuntime) {
    throw new Error('Disposable TEST_DATABASE_URL and APP_TEST_DATABASE_URL required');
  }
  const admin = new URL(sourceAdmin);
  const runtime = new URL(sourceRuntime);
  if (
    !admin.pathname.endsWith('_test') ||
    runtime.pathname !== admin.pathname ||
    runtime.hostname !== admin.hostname ||
    runtime.port !== admin.port ||
    runtime.username !== 'asalab_app' ||
    admin.username === runtime.username
  ) {
    throw new Error('Refusing HTTP report test outside isolated admin/runtime *_test PostgreSQL');
  }
  return { admin, runtime };
}

function assertReceipt(response: HttpResult, duplicate: boolean): string {
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    reportId: expect.any(String),
    status: 'received',
    duplicate,
  });
  return response.body['reportId'] as string;
}

describe('Public Projects B1 real HTTP report intake with disposable PostgreSQL 16', () => {
  it('persists private revision-bound reports and enforces the complete HTTP admission boundary', async () => {
    const sources = disposableUrls();
    const databaseName = 'asa_b1_http_' + randomUUID().replaceAll('-', '') + '_test';
    const adminTarget = new URL(sources.admin.href);
    const runtimeTarget = new URL(sources.runtime.href);
    adminTarget.pathname = '/' + databaseName;
    runtimeTarget.pathname = '/' + databaseName;

    const owner = new pg.Client({ connectionString: sources.admin.href });
    let created = false;
    let admin: pg.Pool | undefined;
    let runtime: pg.Pool | undefined;
    let app: NestApp | undefined;

    await owner.connect();
    try {
      await owner.query('CREATE DATABASE "' + databaseName + '"');
      created = true;
      admin = new pg.Pool({ connectionString: adminTarget.href, max: 8 });
      runtime = new pg.Pool({ connectionString: runtimeTarget.href, max: 20 });

      const plan = planMigrations();
      expect(plan.find((item) => item.version === '0259')?.file).toBe(
        '0259_project_publication_reports.sql',
      );
      const migrator = await admin.connect();
      try {
        expect(await applyIsolatedTestPlan(migrator, plan)).toBe(plan.length);
        expect(await applyIsolatedTestPlan(migrator, plan)).toBe(0);
      } finally {
        migrator.release();
      }

      const role = (
        await runtime.query(
          'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
        )
      ).rows[0];
      expect(role).toEqual({
        role: 'asalab_app',
        rolsuper: false,
        rolbypassrls: false,
      });

      // Existing Account policy is optional and provider-aware. B1 inherits the
      // global guard without imposing an SMTP/email-only requirement.
      expect(
        (await admin.query('SELECT enabled FROM account_verification_policy WHERE singleton_key'))
          .rows[0].enabled,
      ).toBe(false);
      app = await buildTestApp(runtime);
      await app.listen(0, '127.0.0.1');
      const baseUrl = await app.getUrl();
      expect(new URL(baseUrl).hostname).toBe('127.0.0.1');

      async function request(
        path: string,
        options: {
          method?: 'GET' | 'POST';
          cookie?: string;
          key?: string;
          payload?: unknown;
        } = {},
      ): Promise<HttpResult> {
        const headers: Record<string, string> = { origin: WEB_ORIGIN };
        if (options.cookie) headers['cookie'] = options.cookie;
        if (options.key !== undefined) headers['idempotency-key'] = options.key;
        if (Object.prototype.hasOwnProperty.call(options, 'payload')) {
          headers['content-type'] = 'application/json';
        }
        const response = await fetch(new URL(path, baseUrl), {
          method: options.method ?? 'POST',
          headers,
          ...(Object.prototype.hasOwnProperty.call(options, 'payload')
            ? { body: JSON.stringify(options.payload) }
            : {}),
        });
        const body: unknown = await response.json();
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          throw new Error('Expected genuine JSON object response');
        }
        return {
          status: response.status,
          body: body as Record<string, unknown>,
          headers: response.headers,
        };
      }

      async function login(teacher: SeededTeacher): Promise<string> {
        const result = await request('/api/auth/login', {
          payload: {
            workspace: teacher.workspace,
            email: teacher.email,
            password: teacher.password,
          },
        });
        expect(result.status).toBe(200);
        const session = result.headers
          .getSetCookie()
          .find((value) => value.startsWith('asa_session='));
        if (!session) throw new Error('Account login did not issue a real HTTP session cookie');
        return session.split(';')[0]!;
      }

      async function principal(teacher: SeededTeacher): Promise<string> {
        const rows = await admin!.query<{ principal_id: string }>(
          'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
          [teacher.tenantId, teacher.teacherId],
        );
        expect(rows.rows).toHaveLength(1);
        return rows.rows[0]!.principal_id;
      }

      const author = await seedTeacher(admin, 'http-reports-author');
      const reporter = await seedTeacher(admin, 'http-reports-reporter');
      const quotaReporter = await seedTeacher(admin, 'http-reports-quota');
      const authorId = await principal(author);
      const reporterId = await principal(reporter);
      const quotaId = await principal(quotaReporter);
      const reporterCookie = await login(reporter);
      const quotaCookie = await login(quotaReporter);
      const repository = new PgProjectRepository(admin);

      async function publish(index: number): Promise<PublicationFixture> {
        const project = await repository.createWithDraft({
          tenantId: author.tenantId,
          scope: 'personal',
          classroomId: null,
          actor: { userId: author.teacherId, principalId: authorId },
          moduleKey: 'electronics',
          title: 'HTTP report fixture ' + index,
          idempotencyKey: randomUUID(),
          requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
          initialDocument: { schemaVersion: 1, components: [], connections: [] },
          initialPreview: null,
        });
        if (project.kind !== 'created') throw new Error('Project fixture not created');
        const projectId = project.project.id;
        const saved = await repository.saveSnapshot({
          tenantId: author.tenantId,
          actor: { userId: author.teacherId, principalId: authorId },
          projectId,
          sourceRevision: 1,
          image: {
            bytes: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNQCu34TwlmGDVg1IBRA4aLAQDLpv4Q+i0QiwAAAABJRU5ErkJggg==',
              'base64',
            ),
            contentType: 'image/png',
            width: 16,
            height: 16,
          },
        });
        expect(saved).not.toBeNull();
        const result = await admin!.query<{ result: { publication: PublicationFixture } }>(
          'SELECT project_publication_publish($1,$2,$3::jsonb) AS result',
          [authorId, projectId, JSON.stringify({ title: 'Published for report ' + index })],
        );
        const publication = result.rows[0]?.result.publication;
        if (!publication?.publicationId || !publication.revisionId) {
          throw new Error('Immutable revision publication fixture failed');
        }
        return { ...publication, projectId };
      }

      function report(
        publication: PublicationFixture,
        cookie: string | undefined,
        key: string,
        reason = 'spam',
        comment = 'A private reporter message',
      ): Promise<HttpResult> {
        return request('/api/public-projects/' + publication.publicationId + '/reports', {
          ...(cookie ? { cookie } : {}),
          key,
          payload: { revisionId: publication.revisionId, reason, comment },
        });
      }

      async function projectCore(projectId: string) {
        return Promise.all(
          [
            ['projects', 'id'],
            ['project_drafts', 'project_id'],
            ['project_versions', 'project_id'],
            ['project_snapshots', 'project_id'],
          ].map(async ([table, column]) => {
            const result = await admin!.query(
              'SELECT to_jsonb(item) AS payload FROM public.' +
                table +
                ' item WHERE item.' +
                column +
                '=$1 ORDER BY to_jsonb(item)::text',
              [projectId],
            );
            return result.rows;
          }),
        );
      }

      const original = await publish(0);
      const before = await projectCore(original.projectId);
      const secret = 'private-report-message-' + randomUUID();
      const idempotencyKey = 'real-http-first-' + randomUUID();
      const createdReport = await report(original, reporterCookie, idempotencyKey, 'spam', secret);
      const reportId = assertReceipt(createdReport, false);
      expect(createdReport.headers.get('cache-control')).toContain('no-store');
      expect(JSON.stringify(createdReport.body)).not.toContain(reporterId);
      expect(JSON.stringify(createdReport.body)).not.toContain(secret);

      const persisted = await admin.query(
        'SELECT id, publication_id, revision_id, reporter_principal_id, reason, comment, status FROM public.project_publication_reports WHERE id=$1',
        [reportId],
      );
      expect(persisted.rows).toEqual([
        {
          id: reportId,
          publication_id: original.publicationId,
          revision_id: original.revisionId,
          reporter_principal_id: reporterId,
          reason: 'spam',
          comment: secret,
          status: 'open',
        },
      ]);

      const duplicate = await report(original, reporterCookie, idempotencyKey, 'spam', secret);
      expect(assertReceipt(duplicate, true)).toBe(reportId);
      expect(
        (await report(original, reporterCookie, 'second-' + randomUUID(), 'spam', secret)).status,
      ).toBe(409);
      const changed = await report(original, reporterCookie, idempotencyKey, 'copyright', secret);
      expect(changed.status).toBe(409);
      expect(changed.body).toMatchObject({ error: { code: 'report_conflict' } });

      const anonymous = await report(original, undefined, 'anon-' + randomUUID());
      expect(anonymous.status).toBe(401);
      const seatSelected = await report(
        original,
        'asa_student_session=seat-session-does-not-grant-account',
        'seat-' + randomUUID(),
      );
      expect(seatSelected.status).toBe(403);
      expect(seatSelected.body).toMatchObject({ error: { code: 'report_forbidden' } });
      // The existing application-wide session guard rejects dual cookies first.
      const dualSession = await report(
        original,
        reporterCookie + '; asa_student_session=seat-session-does-not-grant-account',
        'dual-session-' + randomUUID(),
      );
      expect(dualSession.status).toBe(409);
      expect(dualSession.body).toMatchObject({ error: { code: 'session_conflict' } });

      const malformed: Array<{ path: string; key: string; payload: unknown }> = [
        {
          path: original.publicationId,
          key: 'bad-reason-' + randomUUID(),
          payload: { revisionId: original.revisionId, reason: 'unlisted-reason' },
        },
        {
          path: 'not-a-uuid',
          key: 'bad-path-' + randomUUID(),
          payload: { revisionId: original.revisionId, reason: 'spam' },
        },
        {
          path: original.publicationId,
          key: 'bad-revision-' + randomUUID(),
          payload: { revisionId: 'not-a-uuid', reason: 'spam' },
        },
        {
          path: original.publicationId,
          key: 'bad-comment-' + randomUUID(),
          payload: { revisionId: original.revisionId, reason: 'spam', comment: 'x'.repeat(501) },
        },
        {
          path: original.publicationId,
          key: 'bad-unicode-' + randomUUID(),
          payload: { revisionId: original.revisionId, reason: 'spam', comment: '🚀'.repeat(501) },
        },
        {
          path: original.publicationId,
          key: 'bad-nul-' + randomUUID(),
          payload: { revisionId: original.revisionId, reason: 'spam', comment: '\0' },
        },
        {
          path: original.publicationId,
          key: 'bad-actor-' + randomUUID(),
          payload: {
            revisionId: original.revisionId,
            reason: 'spam',
            reporterPrincipalId: quotaId,
          },
        },
      ];
      for (const item of malformed) {
        const response = await request('/api/public-projects/' + item.path + '/reports', {
          cookie: reporterCookie,
          key: item.key,
          payload: item.payload,
        });
        expect(response.status).toBe(400);
      }
      const stale = await request('/api/public-projects/' + original.publicationId + '/reports', {
        cookie: reporterCookie,
        key: 'stale-' + randomUUID(),
        payload: { revisionId: randomUUID(), reason: 'spam' },
      });
      expect(stale.status).toBe(409);

      const unicode = await publish(1);
      const unicodeReceipt = await report(
        unicode,
        reporterCookie,
        'unicode-' + randomUUID(),
        'personal_data',
        '🚀'.repeat(500),
      );
      assertReceipt(unicodeReceipt, false);
      const unicodeLength = await admin.query<{ n: number }>(
        'SELECT char_length(comment)::integer AS n FROM project_publication_reports WHERE id=$1',
        [unicodeReceipt.body['reportId']],
      );
      expect(unicodeLength.rows[0]?.n).toBe(500);

      const racing = await publish(2);
      const concurrentKey = 'concurrent-' + randomUUID();
      const concurrent = await Promise.all(
        Array.from({ length: 3 }, () => report(racing, reporterCookie, concurrentKey)),
      );
      expect(concurrent.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(new Set(concurrent.map((response) => response.body['reportId'])).size).toBe(1);
      expect(concurrent.filter((response) => response.body['duplicate'] === false)).toHaveLength(1);

      const hidden = await publish(3);
      await admin.query(
        "INSERT INTO project_publication_moderation(publication_id,hidden,reason,actor_principal_id) VALUES ($1,true,'Reported content fixture',$2)",
        [hidden.publicationId, authorId],
      );
      expect((await report(hidden, reporterCookie, 'hidden-' + randomUUID())).status).toBe(404);
      const revoked = await publish(4);
      expect(
        (
          await admin.query('SELECT project_publication_revoke($1,$2) AS ok', [
            authorId,
            revoked.projectId,
          ])
        ).rows[0]?.ok,
      ).toBe(true);
      expect((await report(revoked, reporterCookie, 'revoked-' + randomUUID())).status).toBe(404);
      const unlisted = await publish(5);
      expect(
        (
          await admin.query("SELECT project_visibility_set($1,$2,'link') AS ok", [
            authorId,
            unlisted.projectId,
          ])
        ).rows[0]?.ok,
      ).toBe(true);
      expect((await report(unlisted, reporterCookie, 'unlisted-' + randomUUID())).status).toBe(404);

      const privatePublication = await publish(20);
      await admin.query("SELECT project_visibility_set($1,$2,'private')", [
        authorId,
        privatePublication.projectId,
      ]);
      expect(
        (await report(privatePublication, reporterCookie, 'private-' + randomUUID())).status,
      ).toBe(404);
      const protectedPublication = await publish(21);
      await admin.query(
        `INSERT INTO learning_legacy_project_origins(project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at) VALUES ($1,$2,$2,$3,now())`,
        [protectedPublication.projectId, author.tenantId, randomUUID()],
      );
      expect(
        (await report(protectedPublication, reporterCookie, 'learning-' + randomUUID())).status,
      ).toBe(404);
      await admin.query(
        "UPDATE accounts SET status='suspended' WHERE id=(SELECT account_id FROM principals WHERE id=$1)",
        [reporterId],
      );
      expect((await report(original, reporterCookie, 'blocked-' + randomUUID())).status).toBe(401);
      await admin.query(
        "UPDATE accounts SET status='active' WHERE id=(SELECT account_id FROM principals WHERE id=$1)",
        [reporterId],
      );

      const allReasons = [
        'spam',
        'abuse',
        'dangerous_content',
        'personal_data',
        'copyright',
        'other',
      ] as const;
      for (let index = 0; index < 9; index++) {
        const publication = await publish(6 + index);
        const response = await report(
          publication,
          quotaCookie,
          'quota-' + index + '-' + randomUUID(),
          allReasons[index % allReasons.length]!,
          'One allowed private report',
        );
        assertReceipt(response, false);
      }
      const quotaRacePublications = await Promise.all([publish(16), publish(17)]);
      const quotaRace = await Promise.all(
        quotaRacePublications.map((publication, index) =>
          report(publication, quotaCookie, 'quota-race-' + index + '-' + randomUUID()),
        ),
      );
      expect(quotaRace.map((response) => response.status).sort()).toEqual([200, 429]);
      const overQuota = await publish(18);
      const limited = await report(overQuota, quotaCookie, 'quota-11-' + randomUUID());
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ error: { code: 'report_rate_limited' } });
      expect(
        (
          await admin.query(
            'SELECT count(*)::integer AS n FROM project_publication_reports WHERE reporter_principal_id=$1',
            [quotaId],
          )
        ).rows[0]?.n,
      ).toBe(10);

      const publicDetail = await request('/api/public-projects/' + original.publicationId, {
        method: 'GET',
      });
      const publicList = await request('/api/public-projects', { method: 'GET' });
      expect(publicDetail.status).toBe(200);
      expect(publicList.status).toBe(200);
      for (const response of [publicDetail, publicList]) {
        const body = JSON.stringify(response.body);
        expect(body).not.toContain(reporterId);
        expect(body).not.toContain(secret);
        expect(body).not.toContain(reportId);
        expect(body).not.toContain(reporter.email);
      }
      expect(
        (
          await admin.query('SELECT state FROM project_publication_state WHERE id=$1', [
            original.publicationId,
          ])
        ).rows[0]?.state,
      ).toBe('public');
      expect(
        (
          await admin.query(
            'SELECT count(*)::integer AS n FROM project_publication_moderation WHERE publication_id=$1',
            [original.publicationId],
          )
        ).rows[0]?.n,
      ).toBe(0);
      expect(await projectCore(original.projectId)).toEqual(before);
    } finally {
      try {
        if (app) {
          await app.close();
        } else if (runtime) {
          await runtime.end();
        }
      } finally {
        try {
          await admin?.end();
        } finally {
          try {
            if (created) await owner.query('DROP DATABASE "' + databaseName + '"');
          } finally {
            await owner.end();
          }
        }
      }
    }
  }, 240_000);
});
