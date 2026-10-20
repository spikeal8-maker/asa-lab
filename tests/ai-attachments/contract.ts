import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { AiAccessService } from '../../apps/api/src/ai-access.service';
import { PgAiAttachmentStore } from '../../apps/api/src/ai-attachments/store';
import {
  describeAiAttachmentFile,
  validateAiAttachment,
} from '../../apps/api/src/ai-attachments/validation';
import type {
  AiAttachmentDescriptor,
  AiAttachmentRecord,
} from '../../apps/api/src/ai-attachments/contracts';
import { aiTextFixture } from '../admin/ai-text-history.contract';
import { aiClassFixture } from '../admin/ai-student-access.contract';

export const attachmentDescriptor = (
  bytes: Uint8Array,
  fileName = 'question.txt',
): AiAttachmentDescriptor => ({
  uploadId: randomUUID(),
  fileName,
  sizeBytes: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

export async function aiAttachmentsFixture(admin: pg.Pool, runtime: pg.Pool) {
  const text = await aiTextFixture(admin, runtime),
    store = new PgAiAttachmentStore(runtime);
  const owner = text.owner.principal_id;
  async function reserve(
    bytes = Buffer.from('Личный исходник'),
    fileName = 'question.txt',
    principal = owner,
  ) {
    const descriptor = attachmentDescriptor(bytes, fileName);
    const receipt = await store.reserve(principal, descriptor, describeAiAttachmentFile(fileName));
    return { descriptor, receipt, bytes };
  }
  async function ready(
    bytes = Buffer.from('Личный исходник'),
    fileName = 'question.txt',
    principal = owner,
  ) {
    const file = await reserve(bytes, fileName, principal),
      attempt = randomUUID();
    await store.begin(
      principal,
      file.receipt.uploadId,
      attempt,
      validateAiAttachment(bytes, fileName),
    );
    const receipt = await store.finish(principal, file.receipt.uploadId, attempt, 'persisted');
    return { ...file, receipt, attempt };
  }
  async function bind(
    files: Array<{ receipt: AiAttachmentRecord }>,
    prompt = 'Вопрос с файлами',
    request = randomUUID(),
  ) {
    const admitted = await store.beginMessage(
      owner,
      text.thread.id,
      request,
      prompt,
      await text.version(),
      files.map((file) => file.receipt.uploadId),
    );
    return {
      request,
      prompt,
      admitted,
      source: await store.requestSource(owner, text.thread.id, request),
    };
  }
  const finish = (request: string) =>
    runtime.query("SELECT ai_chat_finish($1,$2,$3,'Исторический ответ','complete')", [
      owner,
      text.thread.id,
      request,
    ]);
  return { ...text, store, ownerId: owner, reserve, ready, bind, finish };
}

/** Seed a historical immutable row, rather than weakening the expiry trigger
 * or changing the system clock. Only the test administrator can insert it. */
export async function historicalAttachment(admin: pg.Pool, upload: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO ai_attachment_uploads SELECT historical.*
       FROM ai_attachment_uploads current_row
       CROSS JOIN LATERAL jsonb_populate_record(NULL::ai_attachment_uploads,
         to_jsonb(current_row) || jsonb_build_object(
           'upload_id',$2::uuid,'created_at',clock_timestamp()-interval '25 hours',
           'expires_at',clock_timestamp()-interval '1 hour',
           'next_check_at',clock_timestamp()-interval '2 minutes',
           'write_started_at',CASE WHEN current_row.attempt_id IS NULL THEN NULL ELSE clock_timestamp()-interval '2 minutes' END
         )) historical
       WHERE current_row.upload_id=$1`,
    [upload, id],
  );
  return id;
}

/** The same actual SQL/ACL assertions run in PGlite and in the restricted
 * PostgreSQL CI role. Only the latter's companion spec claims concurrency. */
export function aiAttachmentsContract(database: () => { admin: pg.Pool; runtime: pg.Pool }) {
  const fixture = () => {
    const db = database();
    return aiAttachmentsFixture(db.admin, db.runtime);
  };
  describe('0229 private attachment receipts and immutable message binding', () => {
    it('uses FORCE RLS and definer-only runtime ACL; private helper functions have no runtime or PUBLIC grant', async () => {
      const { admin, runtime } = database();
      const tables = [
        'ai_attachment_uploads',
        'ai_attachment_message_receipts',
        'ai_attachment_bindings',
      ];
      expect(
        (
          await admin.query(
            'SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname',
            [tables],
          )
        ).rows,
      ).toEqual(
        [...tables]
          .sort()
          .map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })),
      );
      for (const table of tables)
        await expect(runtime.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
      const functions = (
        await admin.query<{
          proname: string;
          prosecdef: boolean;
          proconfig: string[];
          runtime: boolean;
          public_execute: boolean;
        }>(
          `SELECT p.proname,p.prosecdef,p.proconfig,has_function_privilege('asalab_app',p.oid,'EXECUTE') AS runtime,
          EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ai_attachment_%' ORDER BY p.proname`,
        )
      ).rows;
      expect(functions.length).toBeGreaterThanOrEqual(15);
      const privateNames = [
        'ai_attachment_value',
        'ai_attachment_immutable',
        'ai_attachment_source_deleted',
        'ai_attachment_claim_row',
        'ai_attachment_bound_items',
      ];
      for (const fn of functions) {
        expect(fn.public_execute, fn.proname).toBe(false);
        expect(fn.proconfig, fn.proname).toContain('search_path=pg_catalog, pg_temp');
        expect(fn.runtime, fn.proname).toBe(!privateNames.includes(fn.proname));
        if (fn.runtime) expect(fn.prosecdef, fn.proname).toBe(true);
      }
      await expect(
        runtime.query('SELECT ai_attachment_claim_row($1)', [randomUUID()]),
      ).rejects.toThrow(/permission denied/);
      expect(
        (
          await runtime.query(
            'SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user',
          )
        ).rows,
      ).toEqual([{ rolbypassrls: false, rolsuper: false }]);
    });

    it('keeps upload identity and ownership immutable; foreign owners and platform teachers cannot read or mutate private receipts', async () => {
      const f = await fixture(),
        file = await f.reserve();
      expect(
        await f.store.reserve(
          f.ownerId,
          file.descriptor,
          describeAiAttachmentFile(file.descriptor.fileName),
        ),
      ).toEqual(file.receipt);
      await expect(
        f.store.reserve(
          f.ownerId,
          { ...file.descriptor, fileName: 'renamed.txt' },
          describeAiAttachmentFile('renamed.txt'),
        ),
      ).rejects.toMatchObject({ code: 'ai_attachment_id_reused' });
      for (const other of [f.stranger.principal_id, f.platform.principal_id]) {
        for (const action of [
          () => f.store.get(other, file.receipt.uploadId),
          () => f.store.remove(other, file.receipt.uploadId),
          () => f.store.claim(other, file.receipt.uploadId),
          () =>
            f.store.reserve(
              other,
              file.descriptor,
              describeAiAttachmentFile(file.descriptor.fileName),
            ),
        ])
          await expect(action()).rejects.toMatchObject({
            code: 'ai_attachment_not_found',
            status: 404,
          });
      }
      for (const [field, value] of [
        ['owner_principal_id', f.stranger.principal_id],
        ['sha256', '1'.repeat(64)],
        ['file_name', 'another.txt'],
      ] as const)
        await expect(
          f.admin.query(`UPDATE ai_attachment_uploads SET ${field}=$2 WHERE upload_id=$1`, [
            file.receipt.uploadId,
            value,
          ]),
        ).rejects.toThrow('AI_ATTACHMENT_IMMUTABLE');
      expect((await f.store.get(f.ownerId, file.receipt.uploadId)).state).toBe('reserved');
      expect(await f.ledgers()).toMatchObject({ owner: 0 });
      expect(f.upstream).not.toHaveBeenCalled();
    });

    it('holds uncertain PUT bytes through 404 reconciliation, owner removal and stale receipts until positive persistence and confirmed deletion', async () => {
      const f = await fixture(),
        file = await f.reserve(),
        attempt = randomUUID();
      await f.store.begin(
        f.ownerId,
        file.receipt.uploadId,
        attempt,
        validateAiAttachment(file.bytes, file.descriptor.fileName),
      );
      expect(
        await f.store.finish(f.ownerId, file.receipt.uploadId, attempt, 'unknown'),
      ).toMatchObject({ state: 'unknown', held: true, attemptId: attempt });
      const first = await f.store.claim(f.ownerId, file.receipt.uploadId);
      expect(first?.leaseId).toBeTruthy();
      expect(await f.store.claim(f.ownerId, file.receipt.uploadId)).toBeNull();
      await f.store.finishClaim(f.ownerId, file.receipt.uploadId, first!.leaseId!, 'unknown');
      expect(await f.store.remove(f.ownerId, file.receipt.uploadId)).toMatchObject({
        state: 'unknown',
        held: true,
        deleteRequested: true,
      });
      const second = await f.store.claim(f.ownerId, file.receipt.uploadId);
      expect(
        await f.store.finishClaim(f.ownerId, file.receipt.uploadId, first!.leaseId!, 'persisted'),
      ).toMatchObject({ state: 'unknown', leaseId: second!.leaseId });
      expect(
        await f.store.finishClaim(f.ownerId, file.receipt.uploadId, second!.leaseId!, 'persisted'),
      ).toMatchObject({ state: 'deleting', held: true });
      const deletion = await f.store.claim(f.ownerId, file.receipt.uploadId);
      expect(
        await f.store.finishClaim(f.ownerId, file.receipt.uploadId, deletion!.leaseId!, 'deleted'),
      ).toMatchObject({
        state: 'deleted',
        held: false,
        fileName: null,
        text: null,
        sha256: file.descriptor.sha256,
      });
      expect(
        await f.store.finish(f.ownerId, file.receipt.uploadId, attempt, 'persisted'),
      ).toMatchObject({ state: 'deleted', held: false });
      expect(
        await f.store.reserve(
          f.ownerId,
          file.descriptor,
          describeAiAttachmentFile(file.descriptor.fileName),
        ),
      ).toMatchObject({ state: 'deleted', held: false });
    });

    it('releases rejected bytes only before PUT and refuses to change the durable attempt', async () => {
      const f = await fixture(),
        unsent = await f.reserve(),
        sent = await f.reserve();
      expect(await f.store.reject(f.ownerId, unsent.receipt.uploadId)).toMatchObject({
        state: 'failed',
        held: false,
        fileName: null,
      });
      const attempt = randomUUID();
      await f.store.begin(
        f.ownerId,
        sent.receipt.uploadId,
        attempt,
        validateAiAttachment(sent.bytes, sent.descriptor.fileName),
      );
      expect(await f.store.reject(f.ownerId, sent.receipt.uploadId)).toMatchObject({
        state: 'uploading',
        held: true,
        attemptId: attempt,
      });
      await expect(
        f.store.finish(f.ownerId, sent.receipt.uploadId, randomUUID(), 'not_written'),
      ).rejects.toMatchObject({ code: 'ai_attachment_id_reused' });
      expect(
        await f.store.finish(f.ownerId, sent.receipt.uploadId, attempt, 'not_written'),
      ).toMatchObject({ state: 'failed', held: false });
    });

    it('expires known unsent and ready bytes, but retains an uncertain or interrupted PUT until persisted bytes can be deleted', async () => {
      const f = await fixture(),
        reserved = await f.reserve(),
        ready = await f.ready(),
        uploading = await f.reserve(),
        attempt = randomUUID();
      await f.store.begin(
        f.ownerId,
        uploading.receipt.uploadId,
        attempt,
        validateAiAttachment(uploading.bytes, uploading.descriptor.fileName),
      );
      const expiredReserved = await historicalAttachment(f.admin, reserved.receipt.uploadId),
        expiredReady = await historicalAttachment(f.admin, ready.receipt.uploadId),
        interrupted = await historicalAttachment(f.admin, uploading.receipt.uploadId),
        before = await f.ledgers();
      await expect(
        f.store.begin(
          f.ownerId,
          expiredReserved,
          randomUUID(),
          validateAiAttachment(reserved.bytes, reserved.descriptor.fileName),
        ),
      ).rejects.toMatchObject({ code: 'ai_attachment_expired' });
      expect(await f.store.claim(f.ownerId, expiredReserved)).toBeNull();
      expect(await f.store.get(f.ownerId, expiredReserved)).toMatchObject({
        state: 'deleted',
        held: false,
        fileName: null,
        text: null,
      });
      const deletion = await f.store.claim(f.ownerId, expiredReady);
      expect(deletion).toMatchObject({ state: 'deleting', held: true, deleteRequested: true });
      await f.store.finishClaim(f.ownerId, expiredReady, deletion!.leaseId!, 'unknown');
      expect(await f.store.get(f.ownerId, expiredReady)).toMatchObject({
        state: 'deleting',
        held: true,
        fileName: ready.descriptor.fileName,
      });
      const uncertain = await f.store.claim(f.ownerId, interrupted);
      expect(uncertain).toMatchObject({ state: 'unknown', held: true, attemptId: attempt });
      await f.store.finishClaim(f.ownerId, interrupted, uncertain!.leaseId!, 'unknown');
      expect(await f.store.get(f.ownerId, interrupted)).toMatchObject({
        state: 'unknown',
        held: true,
        deleteRequested: true,
        text: 'Личный исходник',
      });
      // A late success is reconciled to deletion, never resurrected as ready.
      expect(await f.store.finish(f.ownerId, interrupted, attempt, 'persisted')).toMatchObject({
        state: 'deleting',
        held: true,
        deleteRequested: true,
      });
      for (const id of [expiredReady, interrupted]) {
        const lease = await f.store.claim(f.ownerId, id);
        expect(await f.store.finishClaim(f.ownerId, id, lease!.leaseId!, 'deleted')).toMatchObject({
          state: 'deleted',
          held: false,
          text: null,
          fileName: null,
        });
      }
      expect(await f.ledgers()).toEqual(before);
    });

    it('reclaims an expired worker lease while rejecting its stale success and retaining failed deletion for the next worker', async () => {
      const f = await fixture(),
        file = await f.ready();
      await f.store.remove(f.ownerId, file.receipt.uploadId);
      const first = await f.store.claim(f.ownerId, file.receipt.uploadId);
      expect(first?.leaseId).toBeTruthy();
      await f.admin.query(
        "UPDATE ai_attachment_uploads SET lease_until=clock_timestamp()-interval '1 second' WHERE upload_id=$1",
        [file.receipt.uploadId],
      );
      const second = await f.store.claim(f.ownerId, file.receipt.uploadId);
      expect(second?.leaseId).toBeTruthy();
      expect(second!.leaseId).not.toBe(first!.leaseId);
      expect(
        await f.store.finishClaim(f.ownerId, file.receipt.uploadId, first!.leaseId!, 'deleted'),
      ).toMatchObject({
        state: 'deleting',
        held: true,
        leaseId: second!.leaseId,
        text: 'Личный исходник',
      });
      expect(
        await f.store.finishClaim(f.ownerId, file.receipt.uploadId, second!.leaseId!, 'unknown'),
      ).toMatchObject({ state: 'deleting', held: true, leaseId: null });
      const retry = await f.store.claim(f.ownerId, file.receipt.uploadId);
      expect(
        await f.store.finishClaim(f.ownerId, file.receipt.uploadId, retry!.leaseId!, 'deleted'),
      ).toMatchObject({ state: 'deleted', held: false, leaseId: null, text: null });
    });

    it('enforces owner byte and pending-count budgets, counting unresolved writes and releasing only known unsent objects', async () => {
      const f = await fixture();
      const large: AiAttachmentDescriptor[] = [];
      for (let index = 0; index < 12; index += 1) {
        const descriptor = {
          uploadId: randomUUID(),
          fileName: 'large.png',
          sizeBytes: 8 * 1024 * 1024,
          sha256: '2'.repeat(64),
        };
        await f.store.reserve(f.ownerId, descriptor, describeAiAttachmentFile(descriptor.fileName));
        large.push(descriptor);
      }
      const extra = { ...large[0]!, uploadId: randomUUID() };
      await expect(
        f.store.reserve(f.ownerId, extra, describeAiAttachmentFile(extra.fileName)),
      ).rejects.toMatchObject({ code: 'ai_attachment_quota' });
      await f.store.remove(f.ownerId, large[0]!.uploadId);
      await f.store.reserve(f.ownerId, extra, describeAiAttachmentFile(extra.fileName));
      const other = f.stranger.principal_id;
      for (let index = 0; index < 20; index += 1)
        await f.reserve(Buffer.from('x'), 'small.txt', other);
      await expect(f.reserve(Buffer.from('x'), 'small.txt', other)).rejects.toMatchObject({
        code: 'ai_attachment_quota',
      });
      expect(
        (
          await f.admin.query(
            'SELECT count(*)::integer AS n FROM ai_attachment_uploads WHERE owner_principal_id=$1 AND held',
            [other],
          )
        ).rows,
      ).toEqual([{ n: 20 }]);
    });

    it('binds the exact ordered file snapshot with one original question and both paid receipts; replay and uncertain status are free', async () => {
      const f = await fixture(),
        first = await f.ready(Buffer.from('# Личный текст'), 'source.md'),
        second = await f.ready(Buffer.from('const value = 7;'), 'source.ts');
      const before = await f.ledgers(),
        bound = await f.bind([second, first]);
      expect(bound.admitted).toBe(true);
      expect(bound.source.items.map((item) => item.uploadId)).toEqual([
        second.receipt.uploadId,
        first.receipt.uploadId,
      ]);
      expect(bound.source.items.map((item) => item.text)).toEqual([
        'const value = 7;',
        '# Личный текст',
      ]);
      expect(
        await f.store.beginMessage(
          f.ownerId,
          f.thread.id,
          bound.request.toUpperCase(),
          bound.prompt,
          0,
          [second.receipt.uploadId.toUpperCase(), first.receipt.uploadId],
        ),
      ).toBe(false);
      expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
      expect(await f.service.requestMessages(f.ownerId, f.thread.id, bound.request)).toHaveLength(
        1,
      );
      expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
      expect(
        (
          await f.admin.query(
            "SELECT id FROM ai_assistant_messages WHERE owner_principal_id=$1 AND request_id=$2 AND role='user'",
            [f.ownerId, bound.request],
          )
        ).rows,
      ).toEqual([{ id: bound.source.sourceUserMessageId }]);
      const manifest = (
        await f.admin.query(
          'SELECT manifest FROM ai_attachment_message_receipts WHERE owner_principal_id=$1 AND request_id=$2',
          [f.ownerId, bound.request],
        )
      ).rows[0]!.manifest;
      expect(manifest).toEqual(
        [second, first].map((file) => ({
          uploadId: file.receipt.uploadId,
          sha256: file.receipt.sha256,
          sizeBytes: file.receipt.sizeBytes,
          mediaType: file.receipt.mediaType,
        })),
      );
      expect(f.upstream).not.toHaveBeenCalled();
    });

    it('rejects reordered, substituted and text-only reused requests without a second paid operation', async () => {
      const f = await fixture(),
        a = await f.ready(),
        b = await f.ready(),
        c = await f.ready();
      const bound = await f.bind([a, b]),
        paid = await f.ledgers();
      for (const [prompt, ids] of [
        [bound.prompt, [b.receipt.uploadId, a.receipt.uploadId]],
        [bound.prompt, [a.receipt.uploadId, c.receipt.uploadId]],
        ['Другой вопрос', [a.receipt.uploadId, b.receipt.uploadId]],
      ] as const)
        await expect(
          f.store.beginMessage(f.ownerId, f.thread.id, bound.request, prompt, await f.version(), [
            ...ids,
          ]),
        ).rejects.toMatchObject({ code: 'ai_request_id_reused' });
      await f.finish(bound.request);
      const plain = randomUUID();
      await f.runtime.query("SELECT ai_text_begin_paid($1,$2,$3,'Только текст',$4)", [
        f.ownerId,
        f.thread.id,
        plain,
        await f.version(),
      ]);
      await expect(
        f.store.beginMessage(f.ownerId, f.thread.id, plain, 'Только текст', await f.version(), [
          c.receipt.uploadId,
        ]),
      ).rejects.toMatchObject({ code: 'ai_request_id_reused' });
      expect(await f.ledgers()).toEqual({ global: paid.global + 1, owner: paid.owner + 1 });
      expect((await f.store.get(f.ownerId, c.receipt.uploadId)).state).toBe('ready');
    });

    it('rolls back the source, thread busy state and both quotas if any file is foreign, unready, reused, duplicated or over the message byte bound', async () => {
      const f = await fixture(),
        own = await f.ready(),
        foreign = await f.ready(Buffer.from('Чужое'), 'other.txt', f.stranger.principal_id),
        pending = await f.reserve();
      const before = await f.ledgers();
      for (const ids of [
        [own.receipt.uploadId, foreign.receipt.uploadId],
        [pending.receipt.uploadId],
        [own.receipt.uploadId, own.receipt.uploadId],
        [randomUUID()],
      ]) {
        const request = randomUUID();
        await expect(
          f.store.beginMessage(
            f.ownerId,
            f.thread.id,
            request,
            'Откат целиком',
            await f.version(),
            ids,
          ),
        ).rejects.toBeDefined();
        expect(
          (
            await f.admin.query('SELECT id FROM ai_assistant_messages WHERE request_id=$1', [
              request,
            ])
          ).rows,
        ).toEqual([]);
        expect(await f.ledgers()).toEqual(before);
      }
      expect((await f.store.get(f.ownerId, own.receipt.uploadId)).state).toBe('ready');
      const large = [];
      for (let index = 0; index < 3; index += 1) {
        const id = randomUUID(),
          attempt = randomUUID();
        await f.store.reserve(
          f.ownerId,
          {
            uploadId: id,
            fileName: 'bounded.png',
            sizeBytes: 8 * 1024 * 1024,
            sha256: '3'.repeat(64),
          },
          describeAiAttachmentFile('bounded.png'),
        );
        await f.store.begin(f.ownerId, id, attempt, {
          kind: 'image',
          mediaType: 'image/png',
          extension: 'png',
          width: 3,
          height: 2,
          text: null,
        });
        await f.store.finish(f.ownerId, id, attempt, 'persisted');
        large.push(id);
      }
      await expect(
        f.store.beginMessage(
          f.ownerId,
          f.thread.id,
          randomUUID(),
          'Слишком много байтов',
          await f.version(),
          large,
        ),
      ).rejects.toMatchObject({ code: 'ai_attachment_quota' });
      expect(await f.ledgers()).toEqual(before);
      const bound = await f.bind([own]);
      await f.finish(bound.request);
      await expect(
        f.store.beginMessage(
          f.ownerId,
          f.thread.id,
          randomUUID(),
          'Не переносить из другого вопроса',
          await f.version(),
          [own.receipt.uploadId],
        ),
      ).rejects.toMatchObject({ code: 'ai_attachment_not_ready' });
      expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
    });

    it('retains original attachments for regeneration and excludes all future questions and their files', async () => {
      const f = await fixture(),
        original = await f.ready(Buffer.from('Первый источник')),
        later = await f.ready(Buffer.from('Поздний секрет'));
      const first = await f.bind([original], 'Исходный вопрос');
      await f.finish(first.request);
      const future = await f.bind([later], 'Будущий вопрос');
      await f.finish(future.request);
      const regeneration = randomUUID();
      await f.runtime.query('SELECT ai_text_regenerate_begin($1,$2,$3,$4,$5)', [
        f.ownerId,
        f.thread.id,
        regeneration,
        first.source.sourceUserMessageId,
        await f.version(),
      ]);
      const selected = await f.store.requestSource(
        f.ownerId,
        f.thread.id,
        regeneration.toUpperCase(),
      );
      expect(selected.sourceUserMessageId).toBe(first.source.sourceUserMessageId);
      expect(selected.items.map((item) => item.uploadId)).toEqual([original.receipt.uploadId]);
      expect(selected.items[0]?.text).toBe('Первый источник');
      expect(JSON.stringify(selected)).not.toContain('Поздний секрет');
      const context = (
        await f.runtime.query<{ content: string }>(
          'SELECT * FROM ai_text_generation_context($1,$2,$3)',
          [f.ownerId, f.thread.id, regeneration],
        )
      ).rows;
      expect(context.map((row) => row.content)).toEqual(['Исходный вопрос']);
      await f.runtime.query('SELECT ai_chat_abort($1,$2,$3)', [
        f.ownerId,
        f.thread.id,
        regeneration,
      ]);
      const paid = await f.ledgers();
      expect(
        (
          await f.runtime.query<{ admitted: boolean }>(
            'SELECT ai_text_regenerate_begin($1,$2,$3,$4,0) AS admitted',
            [f.ownerId, f.thread.id, regeneration, first.source.sourceUserMessageId],
          )
        ).rows[0]?.admitted,
      ).toBe(false);
      expect(await f.ledgers()).toEqual(paid);
      await expect(
        f.store.requestSource(f.stranger.principal_id, f.thread.id, regeneration),
      ).rejects.toMatchObject({ code: 'ai_source_denied' });
    });

    it('preserves uploads and paid tombstones on archive; thread deletion queues bytes and never refunds paid history', async () => {
      const f = await fixture(),
        file = await f.ready(),
        bound = await f.bind([file]);
      await f.finish(bound.request);
      const paid = await f.ledgers();
      await f.service.archiveThread(f.ownerId, f.thread.id, true);
      expect(await f.store.get(f.ownerId, file.receipt.uploadId)).toMatchObject({
        state: 'bound',
        held: true,
      });
      expect(
        await f.store.beginMessage(f.ownerId, f.thread.id, bound.request, bound.prompt, 0, [
          file.receipt.uploadId,
        ]),
      ).toBe(false);
      await expect(f.store.remove(f.ownerId, file.receipt.uploadId)).rejects.toMatchObject({
        code: 'ai_attachment_bound',
      });
      expect(
        (await f.store.requestSource(f.ownerId, f.thread.id, bound.request)).items,
      ).toHaveLength(1);
      await f.service.archiveThread(f.ownerId, f.thread.id, false);
      await f.service.deleteThread(f.ownerId, f.thread.id);
      expect(await f.store.get(f.ownerId, file.receipt.uploadId)).toMatchObject({
        state: 'deleting',
        held: true,
        deleteRequested: true,
      });
      expect(
        (
          await f.admin.query('SELECT * FROM ai_attachment_bindings WHERE upload_id=$1', [
            file.receipt.uploadId,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await f.admin.query(
            'SELECT request_id FROM ai_attachment_message_receipts WHERE owner_principal_id=$1',
            [f.ownerId],
          )
        ).rows,
      ).toEqual([{ request_id: bound.request }]);
      await expect(
        f.store.beginMessage(f.ownerId, f.thread.id, bound.request, bound.prompt, 0, [
          file.receipt.uploadId,
        ]),
      ).rejects.toMatchObject({ code: 'ai_request_id_reused' });
      const claim = await f.store.claim(f.ownerId, file.receipt.uploadId);
      expect(
        await f.store.finishClaim(f.ownerId, file.receipt.uploadId, claim!.leaseId!, 'deleted'),
      ).toMatchObject({ state: 'deleted', held: false, text: null, fileName: null });
      expect(await f.ledgers()).toEqual(paid);
    });

    it('uses canonical Seat ownership and teacher admission while retaining private reads, cleanup and exact replay after revocation', async () => {
      const f = await fixture(),
        school = await aiClassFixture(f.admin, f.runtime),
        access = new AiAccessService(f.runtime);
      const set = async (mode: 'allow' | 'deny') => {
        const current = await access.classroom(school.teacher.principal_id, school.classroomId);
        return access.saveClassroom(school.teacher.principal_id, school.classroomId, {
          kind: 'classroom',
          mode,
          minimumRating: 50,
          expectedRevision: current.revision,
          requestId: randomUUID(),
        });
      };
      await expect(
        f.reserve(Buffer.from('Школа'), 'school.txt', school.principalId),
      ).rejects.toMatchObject({ code: 'ai_student_denied' });
      await set('allow');
      const pending = await f.reserve(
          Buffer.from('Ещё не загружен'),
          'pending.txt',
          school.principalId,
        ),
        ready = await f.ready(
          Buffer.from('Приватный школьный файл'),
          'school.txt',
          school.principalId,
        );
      const thread = await f.service.createThread(school.principalId),
        request = randomUUID();
      expect(
        await f.store.beginMessage(
          school.principalId,
          thread.id,
          request,
          'Школьный вопрос',
          await f.version(),
          [ready.receipt.uploadId],
        ),
      ).toBe(true);
      await set('deny');
      expect(await f.store.get(school.principalId, ready.receipt.uploadId)).toMatchObject({
        state: 'bound',
        ownerId: school.principalId,
      });
      expect(
        await f.store.beginMessage(school.principalId, thread.id, request, 'Школьный вопрос', 0, [
          ready.receipt.uploadId,
        ]),
      ).toBe(false);
      await expect(
        f.store.get(school.teacher.principal_id, ready.receipt.uploadId),
      ).rejects.toMatchObject({ code: 'ai_attachment_not_found' });
      await expect(
        f.store.begin(
          school.principalId,
          pending.receipt.uploadId,
          randomUUID(),
          validateAiAttachment(pending.bytes, pending.descriptor.fileName),
        ),
      ).rejects.toMatchObject({ code: 'ai_student_denied' });
      expect(await f.store.remove(school.principalId, pending.receipt.uploadId)).toMatchObject({
        state: 'deleted',
        held: false,
      });
      expect(
        (
          await f.admin.query(
            'SELECT account_id,owner_principal_id FROM ai_assistant_messages WHERE request_id=$1',
            [request],
          )
        ).rows,
      ).toEqual([{ account_id: null, owner_principal_id: school.principalId }]);
    });

    it('bounds total retained objects even after successful binding has left the pending budget', async () => {
      const f = await fixture();
      for (let message = 0; message < 25; message += 1) {
        const files = [];
        for (let index = 0; index < 4; index += 1) files.push(await f.ready(Buffer.from('x')));
        const bound = await f.bind(files, `Вопрос ${message}`);
        await f.finish(bound.request);
      }
      await expect(f.reserve(Buffer.from('x'))).rejects.toMatchObject({
        code: 'ai_attachment_quota',
      });
      expect(
        (
          await f.admin.query(
            'SELECT count(*)::integer AS n,sum(size_bytes)::integer AS bytes FROM ai_attachment_uploads WHERE owner_principal_id=$1 AND held',
            [f.ownerId],
          )
        ).rows,
      ).toEqual([{ n: 100, bytes: 100 }]);
      expect(await f.ledgers()).toMatchObject({ owner: 25 });
      expect(f.upstream).not.toHaveBeenCalled();
    });
  });
}
