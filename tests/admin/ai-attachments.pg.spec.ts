import { fixtureAttachmentSql } from './ai-model-policy.fixture';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AiAccessService } from '../../apps/api/src/ai-access.service';
import type { AiAttachmentRecord } from '../../apps/api/src/ai-attachments/contracts';
import {
  describeAiAttachmentFile,
  validateAiAttachment,
} from '../../apps/api/src/ai-attachments/validation';
import {
  aiAttachmentsContract,
  aiAttachmentsFixture,
  attachmentDescriptor,
} from '../ai-attachments/contract';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { aiClassFixture } from './ai-student-access.contract';

let admin: pg.Pool, runtime: pg.Pool;
let unlock: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must explicitly name an isolated _test database`);
    const url = new URL(value);
    if (!decodeURIComponent(url.pathname).endsWith('_test'))
      throw new Error(`${name} must name an isolated _test database`);
    return url;
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname)
    throw new Error('Both roles must use the same isolated database');
  admin = testAdminPool();
  runtime = testAppPool();
  unlock = await lockAiPostgresSuite(admin);
  const role = (
    await runtime.query(
      'SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  expect(role).toEqual({ current_user: 'asalab_app', rolsuper: false, rolbypassrls: false });
}, 30000);
afterAll(async () => {
  try {
    await runtime?.end();
  } finally {
    await unlock?.();
    await admin?.end();
  }
});

aiAttachmentsContract(() => ({ admin, runtime }));

async function independentClients() {
  const first = await runtime.connect(),
    second = await runtime.connect();
  const pids = await Promise.all([
    first.query('SELECT pg_backend_pid() AS pid'),
    second.query('SELECT pg_backend_pid() AS pid'),
  ]);
  expect(pids[0]!.rows[0].pid).not.toBe(pids[1]!.rows[0].pid);
  return { first, second, secondPid: Number(pids[1]!.rows[0].pid) };
}
async function waitForBlock(pid: number) {
  for (let index = 0; index < 200; index += 1) {
    const blocked = (
      await admin.query<{ blocked: boolean }>(
        'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
        [pid],
      )
    ).rows[0]!.blocked;
    if (blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The competing backend never waited for the expected database lock');
}
function observe<T extends pg.QueryResultRow>(work: Promise<pg.QueryResult<T>>) {
  return work.then(
    (result) => ({ rows: result.rows, error: null }),
    (problem: Error) => ({ rows: [] as T[], error: problem.message }),
  );
}
const RESERVE = 'SELECT ai_attachment_reserve($1,$2,$3,$4,$5,$6,$7,$8) AS value';
const BIND = fixtureAttachmentSql;
function reserveParams(owner: string, descriptor: ReturnType<typeof attachmentDescriptor>) {
  const file = describeAiAttachmentFile(descriptor.fileName);
  return [
    owner,
    descriptor.uploadId,
    descriptor.fileName,
    descriptor.sizeBytes,
    descriptor.sha256,
    file.extension,
    file.mediaType,
    file.kind,
  ];
}

it('serializes competing immutable reservations and forbids a different owner from adopting the same upload UUID', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    descriptor = attachmentDescriptor(Buffer.from('Один файл'));
  const { first, second } = await independentClients();
  try {
    const receipts = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 ? first : second).query<{ value: AiAttachmentRecord }>(
          RESERVE,
          reserveParams(f.ownerId, descriptor),
        ),
      ),
    );
    expect(
      receipts.every(
        (receipt) =>
          receipt.rows[0]!.value.uploadId === descriptor.uploadId &&
          receipt.rows[0]!.value.ownerId === f.ownerId,
      ),
    ).toBe(true);
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS n FROM ai_attachment_uploads WHERE upload_id=$1',
          [descriptor.uploadId],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    const shared = attachmentDescriptor(Buffer.from('Одновременные владельцы'));
    const results = await Promise.all([
      observe(
        first.query<{ value: AiAttachmentRecord }>(RESERVE, reserveParams(f.ownerId, shared)),
      ),
      observe(
        second.query<{ value: AiAttachmentRecord }>(
          RESERVE,
          reserveParams(f.stranger.principal_id, shared),
        ),
      ),
    ]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error === 'AI_ATTACHMENT_NOT_FOUND')).toHaveLength(1);
    const winner = results.find((result) => result.error === null)!.rows[0]!.value.ownerId;
    const loser = winner === f.ownerId ? f.stranger.principal_id : f.ownerId;
    await expect(f.store.get(loser, shared.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_not_found',
    });
    expect((await f.store.get(winner, shared.uploadId)).state).toBe('reserved');
    expect(await f.ledgers()).toMatchObject({ owner: 0 });
  } finally {
    first.release();
    second.release();
  }
});

it('keeps the 100 MiB owner reservation bound under competing runtime connections', async () => {
  const f = await aiAttachmentsFixture(admin, runtime);
  const descriptor = {
    ...attachmentDescriptor(Buffer.from('bounded quota descriptor'), 'large.png'),
    sizeBytes: 8 * 1024 * 1024,
  };
  // The SQL quota test uses descriptors; byte validation and actual PUT have their own gates.
  for (let index = 0; index < 11; index += 1)
    await runtime.query(
      RESERVE,
      reserveParams(f.ownerId, { ...descriptor, uploadId: randomUUID() }),
    );
  const { first, second } = await independentClients();
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        observe(
          (index % 2 ? first : second).query(
            RESERVE,
            reserveParams(f.ownerId, { ...descriptor, uploadId: randomUUID() }),
          ),
        ),
      ),
    );
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error === 'AI_ATTACHMENT_QUOTA')).toHaveLength(7);
    expect(
      (
        await admin.query(
          'SELECT sum(size_bytes)::integer AS bytes,count(*)::integer AS count FROM ai_attachment_uploads WHERE owner_principal_id=$1 AND held',
          [f.ownerId],
        )
      ).rows,
    ).toEqual([{ bytes: 96 * 1024 * 1024, count: 12 }]);
  } finally {
    first.release();
    second.release();
  }
});

it('admits one atomic message and both paid receipts across sixteen concurrent binding replays', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    firstFile = await f.ready(),
    secondFile = await f.ready(Buffer.from('Второй файл'));
  const request = randomUUID(),
    version = await f.version(),
    before = await f.ledgers();
  const { first, second } = await independentClients();
  try {
    const responses = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 ? first : second).query<{ admitted: boolean }>(BIND, [
          f.ownerId,
          f.thread.id,
          index % 2 ? request.toUpperCase() : request,
          'Один оригинальный вопрос',
          version,
          [secondFile.receipt.uploadId, firstFile.receipt.uploadId],
        ]),
      ),
    );
    expect(responses.filter((result) => result.rows[0]!.admitted)).toHaveLength(1);
    expect(await f.ledgers()).toEqual({ owner: before.owner + 1, global: before.global + 1 });
    expect(
      (
        await admin.query(
          "SELECT count(*)::integer AS n FROM ai_assistant_messages WHERE owner_principal_id=$1 AND request_id=$2 AND role='user'",
          [f.ownerId, request],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (await f.store.requestSource(f.ownerId, f.thread.id, request)).items.map(
        (item) => item.uploadId,
      ),
    ).toEqual([secondFile.receipt.uploadId, firstFile.receipt.uploadId]);
    await first.query('SELECT ai_chat_abort($1,$2,$3)', [f.ownerId, f.thread.id, request]);
    expect(
      (
        await second.query<{ admitted: boolean }>(BIND, [
          f.ownerId,
          f.thread.id,
          request,
          'Один оригинальный вопрос',
          0,
          [secondFile.receipt.uploadId, firstFile.receipt.uploadId],
        ])
      ).rows[0]!.admitted,
    ).toBe(false);
    expect(await f.ledgers()).toEqual({ owner: before.owner + 1, global: before.global + 1 });
  } finally {
    first.release();
    second.release();
  }
});

it('rolls back fresh message and both ledgers when removal commits before competing binding', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    file = await f.ready();
  const before = await f.ledgers(),
    request = randomUUID(),
    version = await f.version();
  const { first, second, secondPid } = await independentClients();
  let pending: ReturnType<typeof observe> | undefined;
  try {
    await first.query('BEGIN');
    await first.query('SELECT ai_attachment_remove($1,$2)', [f.ownerId, file.receipt.uploadId]);
    pending = observe(
      second.query(BIND, [
        f.ownerId,
        f.thread.id,
        request,
        'Удалённый файл',
        version,
        [file.receipt.uploadId],
      ]),
    );
    await waitForBlock(secondPid);
    await first.query('COMMIT');
    expect((await pending).error).toBe('AI_ATTACHMENT_NOT_READY');
    expect(await f.ledgers()).toEqual(before);
    expect(
      (await admin.query('SELECT id FROM ai_assistant_messages WHERE thread_id=$1', [f.thread.id]))
        .rows,
    ).toEqual([]);
    expect(
      (
        await admin.query(
          'SELECT active_request_id,busy_until FROM ai_assistant_threads WHERE id=$1',
          [f.thread.id],
        )
      ).rows,
    ).toEqual([{ active_request_id: null, busy_until: null }]);
    expect(await f.store.get(f.ownerId, file.receipt.uploadId)).toMatchObject({
      state: 'deleting',
      held: true,
    });
  } finally {
    await first.query('ROLLBACK');
    await pending;
    first.release();
    second.release();
  }
});

it('rejects competing unsent deletion after atomic binding commits, preserving the question and paid receipts', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    file = await f.ready();
  const before = await f.ledgers(),
    request = randomUUID(),
    version = await f.version();
  const { first, second, secondPid } = await independentClients();
  let pending: ReturnType<typeof observe> | undefined;
  try {
    await first.query('BEGIN');
    await first.query(BIND, [
      f.ownerId,
      f.thread.id,
      request,
      'Сохранённый файл',
      version,
      [file.receipt.uploadId],
    ]);
    pending = observe(
      second.query('SELECT ai_attachment_remove($1,$2)', [f.ownerId, file.receipt.uploadId]),
    );
    await waitForBlock(secondPid);
    await first.query('COMMIT');
    expect((await pending).error).toBe('AI_ATTACHMENT_BOUND');
    expect(await f.ledgers()).toEqual({ owner: before.owner + 1, global: before.global + 1 });
    expect(
      (await f.store.requestSource(f.ownerId, f.thread.id, request)).items.map(
        (item) => item.uploadId,
      ),
    ).toEqual([file.receipt.uploadId]);
    expect(await f.store.get(f.ownerId, file.receipt.uploadId)).toMatchObject({
      state: 'bound',
      held: true,
      deleteRequested: false,
    });
    await f.finish(request);
  } finally {
    await first.query('ROLLBACK');
    await pending;
    first.release();
    second.release();
  }
});

it('never binds one upload to two different source questions when separate threads compete', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    file = await f.ready(),
    otherThread = await f.service.createThread(f.ownerId);
  const before = await f.ledgers(),
    version = await f.version(),
    request1 = randomUUID(),
    request2 = randomUUID();
  const { first, second } = await independentClients();
  try {
    const results = await Promise.all([
      observe(
        first.query(BIND, [
          f.ownerId,
          f.thread.id,
          request1,
          'Первый вопрос',
          version,
          [file.receipt.uploadId],
        ]),
      ),
      observe(
        second.query(BIND, [
          f.ownerId,
          otherThread.id,
          request2,
          'Второй вопрос',
          version,
          [file.receipt.uploadId],
        ]),
      ),
    ]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error === 'AI_ATTACHMENT_NOT_READY')).toHaveLength(1);
    expect(await f.ledgers()).toEqual({ owner: before.owner + 1, global: before.global + 1 });
    const bindings = (
      await admin.query(
        'SELECT source_user_message_id,request_id FROM ai_attachment_bindings WHERE upload_id=$1',
        [file.receipt.uploadId],
      )
    ).rows;
    expect(bindings).toHaveLength(1);
    expect(
      (
        await admin.query(
          "SELECT id,request_id FROM ai_assistant_messages WHERE owner_principal_id=$1 AND role='user'",
          [f.ownerId],
        )
      ).rows,
    ).toEqual([{ id: bindings[0]!.source_user_message_id, request_id: bindings[0]!.request_id }]);
  } finally {
    first.release();
    second.release();
  }
});

it('two runtime workers claim disjoint bounded leases using SKIP LOCKED without waiting for each other', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    ids: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const file = await f.reserve(),
      attempt = randomUUID();
    await f.store.begin(
      f.ownerId,
      file.receipt.uploadId,
      attempt,
      validateAiAttachment(file.bytes, file.descriptor.fileName),
    );
    await f.store.finish(f.ownerId, file.receipt.uploadId, attempt, 'unknown');
    ids.push(file.receipt.uploadId);
  }
  await admin.query(
    "UPDATE ai_attachment_uploads SET next_check_at=clock_timestamp()-interval '1 day' WHERE upload_id=ANY($1::uuid[])",
    [ids],
  );
  const { first, second } = await independentClients();
  try {
    await first.query('BEGIN');
    const left = (
      await first.query<{ value: AiAttachmentRecord }>(
        'SELECT ai_attachment_claim_batch(8) AS value',
      )
    ).rows.map((row) => row.value);
    await second.query('BEGIN');
    // If SKIP LOCKED regresses, the local statement deadline makes the defect explicit.
    await second.query("SET LOCAL statement_timeout='2s'");
    const right = (
      await second.query<{ value: AiAttachmentRecord }>(
        'SELECT ai_attachment_claim_batch(4) AS value',
      )
    ).rows.map((row) => row.value);
    expect(left).toHaveLength(8);
    expect(right).toHaveLength(4);
    expect(new Set([...left, ...right].map((row) => row.uploadId))).toEqual(new Set(ids));
    expect(new Set([...left, ...right].map((row) => row.leaseId)).size).toBe(12);
    expect([...left, ...right].every((row) => row.held && row.state === 'unknown')).toBe(true);
    await first.query('COMMIT');
    await second.query('COMMIT');
    for (const row of [...left, ...right])
      await f.store.finishClaim(f.ownerId, row.uploadId, row.leaseId!, 'unknown');
  } finally {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
    first.release();
    second.release();
  }
});

it('retains the reservation when deletion races with an in-flight PUT and records its late success only as deleting', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    file = await f.reserve(),
    attempt = randomUUID();
  await f.store.begin(
    f.ownerId,
    file.receipt.uploadId,
    attempt,
    validateAiAttachment(file.bytes, file.descriptor.fileName),
  );
  const { first, second, secondPid } = await independentClients();
  let pending: ReturnType<typeof observe<{ value: AiAttachmentRecord }>> | undefined;
  try {
    await first.query('BEGIN');
    await first.query('SELECT ai_attachment_remove($1,$2)', [f.ownerId, file.receipt.uploadId]);
    pending = observe(
      second.query<{ value: AiAttachmentRecord }>(
        "SELECT ai_attachment_finish_upload($1,$2,$3,'persisted') AS value",
        [f.ownerId, file.receipt.uploadId, attempt],
      ),
    );
    await waitForBlock(secondPid);
    await first.query('COMMIT');
    expect((await pending).rows[0]!.value).toMatchObject({
      state: 'deleting',
      held: true,
      deleteRequested: true,
      attemptId: attempt,
    });
    const claim = await f.store.claim(f.ownerId, file.receipt.uploadId);
    expect(
      await f.store.finishClaim(f.ownerId, file.receipt.uploadId, claim!.leaseId!, 'deleted'),
    ).toMatchObject({ state: 'deleted', held: false, fileName: null, text: null });
  } finally {
    await first.query('ROLLBACK');
    await pending;
    first.release();
    second.release();
  }
});

it('a concurrently committed teacher revoke prevents fresh attachment binding without changing ready bytes or paid ledgers', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    school = await aiClassFixture(admin, runtime),
    access = new AiAccessService(runtime);
  await access.saveClassroom(school.teacher.principal_id, school.classroomId, {
    kind: 'classroom',
    mode: 'allow',
    minimumRating: 50,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  const file = await f.ready(Buffer.from('Школьный личный файл'), 'school.txt', school.principalId);
  const thread = await f.service.createThread(school.principalId),
    version = await f.version(),
    before = await f.ledgers();
  const { first, second, secondPid } = await independentClients();
  let pending: ReturnType<typeof observe> | undefined;
  try {
    await first.query('BEGIN');
    await first.query('SELECT ai_classroom_access_set($1,$2,$3::jsonb)', [
      school.teacher.principal_id,
      school.classroomId,
      JSON.stringify({
        kind: 'classroom',
        mode: 'deny',
        minimumRating: 50,
        expectedRevision: 1,
        requestId: randomUUID(),
      }),
    ]);
    pending = observe(
      second.query(BIND, [
        school.principalId,
        thread.id,
        randomUUID(),
        'Вопрос после отзыва',
        version,
        [file.receipt.uploadId],
      ]),
    );
    await waitForBlock(secondPid);
    await first.query('COMMIT');
    expect((await pending).error).toBe('AI_STUDENT_DENIED');
    expect(
      (
        await admin.query(
          'SELECT request_id FROM ai_assistant_request_quota WHERE owner_principal_id=$1',
          [school.principalId],
        )
      ).rows,
    ).toEqual([]);
    expect(await f.ledgers()).toEqual(before);
    expect(await f.store.get(school.principalId, file.receipt.uploadId)).toMatchObject({
      state: 'ready',
      held: true,
    });
    await expect(
      f.store.get(school.teacher.principal_id, file.receipt.uploadId),
    ).rejects.toMatchObject({ code: 'ai_attachment_not_found' });
  } finally {
    await first.query('ROLLBACK');
    await pending;
    first.release();
    second.release();
  }
});
