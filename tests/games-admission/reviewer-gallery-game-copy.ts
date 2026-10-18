import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it } from 'vitest';
import { inject, type NestApp } from '../portal/app';
import type { storageContract } from './storage-contract';

type Fixture = Awaited<ReturnType<ReturnType<typeof storageContract>>>;

/** Independent Games regression. Project creation, snapshot, publication, copy,
 * login and policy writes all run through the assembled API / real migrated SQL.
 * The image fixture is the same header fixture used by projects-api.spec.ts.
 */
export function galleryGameCopyContract(
  clients: () => { admin: pg.Pool; runtime: pg.Pool; app: NestApp },
  fixture: ReturnType<typeof storageContract>,
): void {
  async function login(f: Fixture): Promise<string> {
    const result = await inject(clients().app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: f.teacher.workspace,
        email: f.teacher.email,
        password: f.teacher.password,
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    const token = result.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
    expect(token).toBeTruthy();
    return token!;
  }

  function pngDataUrl(): string {
    const bytes = new Uint8Array(160);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 320, false);
    view.setUint32(20, 200, false);
    return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
  }

  it.each(['chess', 'checkers'])(
    'independent: any Student cookie prevents %s Gallery copy into Account',
    async (module) => {
      const f = await fixture();
      const publisher = await fixture();
      const { app, admin } = clients();
      const accountToken = await login(f);
      const publisherToken = await login(publisher);
      const publishedCookies = { asa_session: publisherToken };
      const created = await inject(app, {
        method: 'POST',
        url: '/api/projects',
        cookies: publishedCookies,
        headers: { 'idempotency-key': randomUUID() },
        payload: { scope: 'personal', module, title: `Independent published ${module}` },
      });
      expect(created.statusCode, created.body).toBe(201);
      const projectId = created.json<{ project: { id: string } }>().project.id;
      const snapshot = await inject(app, {
        method: 'PUT',
        url: `/api/projects/${projectId}/snapshot`,
        cookies: publishedCookies,
        payload: { imageDataUrl: pngDataUrl(), sourceRevision: 1 },
      });
      expect(snapshot.statusCode, snapshot.body).toBe(200);
      const published = await inject(app, {
        method: 'POST',
        url: `/api/gallery/${projectId}`,
        cookies: publishedCookies,
      });
      expect([200, 201], published.body).toContain(published.statusCode);

      const copyUrl = `/api/gallery/${projectId}/copy`;
      // Establish that this exact source is copyable by a standalone Account.
      const ordinaryCopy = await inject(app, {
        method: 'POST',
        url: copyUrl,
        cookies: { asa_session: accountToken },
        payload: {},
      });
      expect(ordinaryCopy.statusCode, ordinaryCopy.body).toBe(201);
      const ordinaryProjectId = ordinaryCopy.json<{ projectId: string }>().projectId;
      expect(
        (
          await admin.query('SELECT module_key, owner_principal_id FROM projects WHERE id=$1', [
            ordinaryProjectId,
          ])
        ).rows[0],
      ).toMatchObject({ module_key: module, owner_principal_id: f.actor });

      expect(
        await f.write('class', { mode: 'deny', threshold: null, expectedVersion: 0 }),
      ).toMatchObject({ mode: 'deny', version: 1 });
      const countCopies = async (): Promise<number> =>
        Number(
          (
            await admin.query(
              'SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1 AND owner_principal_id=$2',
              [projectId, f.actor],
            )
          ).rows[0].n,
        );
      const before = await countCopies();
      // The canonical onRequest hook rejects every pair of nonempty cookies,
      // before either identity is resolved. This remains a 409, not a new auth flow.
      const conflictingCopy = await inject(app, {
        method: 'POST',
        url: copyUrl,
        cookies: { asa_session: accountToken, asa_student_session: f.token },
        payload: {},
      });
      expect.soft(conflictingCopy.statusCode, conflictingCopy.body).toBe(409);
      expect.soft(conflictingCopy.json()).toMatchObject({ error: { code: 'session_conflict' } });
      expect
        .soft(
          await countCopies(),
          `Conflicting cookies must not create a copy; response=${conflictingCopy.body}`,
        )
        .toBe(before);

      // An explicitly present but empty Student cookie passes that truthiness
      // hook. Gallery itself must reject its presence before Account resolution.
      const emptyStudentCopy = await inject(app, {
        method: 'POST',
        url: copyUrl,
        cookies: { asa_session: accountToken, asa_student_session: '' },
        payload: {},
      });
      expect.soft(emptyStudentCopy.statusCode, emptyStudentCopy.body).toBe(403);
      expect
        .soft(emptyStudentCopy.json())
        .toMatchObject({ error: { code: 'account_context_required' } });
      expect
        .soft(
          await countCopies(),
          `Empty Student cookie must not create a copy; response=${emptyStudentCopy.body}`,
        )
        .toBe(before);
    },
  );
}
