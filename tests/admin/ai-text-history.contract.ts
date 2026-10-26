import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiAccessService } from '../../apps/api/src/ai-access.service';
import { AiChatService, type AiCursor } from '../../apps/api/src/ai-chat.service';
import { aiClassFixture, aiIdentity } from './ai-student-access.contract';

const ROOT = '4b'.repeat(32);

export async function aiTextFixture(admin: pg.Pool, runtime: pg.Pool) {
  const owner = await aiIdentity(admin),
    stranger = await aiIdentity(admin),
    platform = await aiIdentity(admin);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [platform.account_id],
  );
  const upstream = vi.fn<typeof fetch>(async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as { stream?: boolean };
    return body.stream
      ? new Response(
          'event: response.output_text.delta\ndata: {"delta":"Новый вариант"}\n\n' +
            'event: response.completed\ndata: {"type":"response.completed"}\n\n',
        )
      : new Response(JSON.stringify({ status: 'completed', output_text: 'Первый ответ' }));
  });
  const service = new AiChatService(runtime, { encryptionKey: ROOT, fetchImpl: upstream });
  await service.saveAdminConfig(
    platform.principal_id,
    {
      enabled: true,
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-text-tests-only-0000000',
      paidOperationsPerHour: 10000,
    },
    randomUUID(),
  );
  const thread = await service.createThread(owner.principal_id);
  const version = async () =>
    Number(
      (await runtime.query<{ configuration_version: string }>('SELECT * FROM ai_runtime_config()'))
        .rows[0]!.configuration_version,
    );
  const ledgers = async () => ({
    global: (
      await admin.query<{ n: number }>('SELECT count(*)::integer AS n FROM ai_paid_operation_quota')
    ).rows[0]!.n,
    owner: (
      await admin.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM ai_assistant_request_quota WHERE owner_principal_id=$1',
        [owner.principal_id],
      )
    ).rows[0]!.n,
  });
  async function seedQuestion(
    content: string,
    answer?: string,
    threadId = thread.id,
    createdAt?: string,
  ) {
    const requestId = randomUUID();
    const sourceId = (
      await admin.query<{ id: string }>(
        `INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content,created_at)
       VALUES($1,$2,$3,$4,'user',$5,COALESCE($6::timestamptz,clock_timestamp())) RETURNING id`,
        [threadId, owner.account_id, owner.principal_id, requestId, content, createdAt ?? null],
      )
    ).rows[0]!.id;
    if (answer)
      await admin.query(
        "INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content) VALUES($1,$2,$3,$4,'assistant',$5)",
        [threadId, owner.account_id, owner.principal_id, requestId, answer],
      );
    return { sourceId, requestId };
  }
  const regenerate = (
    sourceId: string,
    requestId = randomUUID(),
    principal = owner.principal_id,
    threadId = thread.id,
  ) =>
    service.sendStream(
      principal,
      threadId,
      '',
      requestId,
      vi.fn(),
      new AbortController().signal,
      'gpt-5-mini',
      sourceId,
    );
  return {
    admin,
    runtime,
    owner,
    stranger,
    platform,
    thread,
    service,
    upstream,
    version,
    ledgers,
    seedQuestion,
    regenerate,
  };
}

/** Product SQL assertions shared by the embedded upgrade probe and real
 * PostgreSQL restricted-role suite. The only upstream is an in-memory fixture. */
export function aiTextHistoryContract(database: () => { admin: pg.Pool; runtime: pg.Pool }) {
  const fixture = () => {
    const db = database();
    return aiTextFixture(db.admin, db.runtime);
  };

  describe('0228 full owner history and immutable answer variants', () => {
    it('stores and replays a complete long code file, preserves it in follow-up context, and extends only its owned admission', async () => {
      const { admin, runtime } = database();
      const f = await aiTextFixture(admin, runtime);
      const code =
        '<!doctype html>\n<script>\n' + 'const step = () => {};\n'.repeat(600) + '</script>';
      f.upstream.mockImplementation(async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        return body.stream
          ? new Response(
              'event: response.output_text.delta\ndata: ' +
                JSON.stringify({ delta: code }) +
                '\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n',
            )
          : new Response(JSON.stringify({ status: 'completed', output_text: code }));
      });
      const request = randomUUID();
      await f.service.send(
        f.owner.principal_id,
        f.thread.id,
        'Сделай игру одним HTML-файлом',
        request,
      );
      expect((await f.service.messages(f.owner.principal_id, f.thread.id)).at(-1)).toMatchObject({
        content: code,
        state: 'complete',
      });
      const calls = f.upstream.mock.calls.length;
      expect(
        (
          await f.service.send(
            f.owner.principal_id,
            f.thread.id,
            'Сделай игру одним HTML-файлом',
            request,
          )
        ).replayed,
      ).toBe(true);
      expect(f.upstream).toHaveBeenCalledTimes(calls);
      await f.service.send(f.owner.principal_id, f.thread.id, 'Поменяй цвет змейки', randomUUID());
      const latest = JSON.parse(String(f.upstream.mock.calls.at(-1)?.[1]?.body));
      expect(
        latest.input.some(
          (item: { role: string; content: string }) =>
            item.role === 'assistant' && item.content === code,
        ),
      ).toBe(true);
      const admitted = randomUUID();
      await runtime.query('SELECT ai_text_begin_paid($1,$2,$3,$4,$5)', [
        f.owner.principal_id,
        f.thread.id,
        admitted,
        'Ещё вопрос',
        await f.version(),
      ]);
      await expect(
        runtime.query('SELECT ai_chat_generation_lease($1,$2,$3)', [
          f.stranger.principal_id,
          f.thread.id,
          admitted,
        ]),
      ).rejects.toThrow('AI_THREAD_DENIED');
      await runtime.query('SELECT ai_chat_generation_lease($1,$2,$3)', [
        f.owner.principal_id,
        f.thread.id,
        admitted,
      ]);
      const seconds = Number(
        (
          await admin.query(
            'SELECT EXTRACT(EPOCH FROM busy_until-clock_timestamp()) AS remaining FROM ai_assistant_threads WHERE id=$1',
            [f.thread.id],
          )
        ).rows[0]!.remaining,
      );
      expect(seconds).toBeGreaterThan(320);
      expect(seconds).toBeLessThanOrEqual(330);
      // An explicitly local Ollama request can use the longer #790 Qwen lease.
      await runtime.query('SELECT ai_chat_generation_lease($1,$2,$3,true)', [
        f.owner.principal_id,
        f.thread.id,
        admitted,
      ]);
      const localSeconds = Number(
        (
          await admin.query(
            'SELECT EXTRACT(EPOCH FROM busy_until-clock_timestamp()) AS remaining FROM ai_assistant_threads WHERE id=$1',
            [f.thread.id],
          )
        ).rows[0]!.remaining,
      );
      expect(localSeconds).toBeGreaterThan(1820);
      expect(localSeconds).toBeLessThanOrEqual(1830);
      await runtime.query('SELECT ai_chat_abort($1,$2,$3)', [
        f.owner.principal_id,
        f.thread.id,
        admitted,
      ]);
    });

    it('searches all old messages and literal title text, beyond the latest history page, without crossing owners', async () => {
      const f = await fixture();
      await f.service.renameThread(f.owner.principal_id, f.thread.id, 'Схема проекта');
      await f.seedQuestion('Самое раннее сообщение: АрДуИнО и 50%_точно.');
      await f.admin.query(
        `INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content)
         SELECT $1,$2,$3,gen_random_uuid(),'user','Более новый вопрос ' || n FROM generate_series(1,125) AS n`,
        [f.thread.id, f.owner.account_id, f.owner.principal_id],
      );
      const recent = await f.service.messages(f.owner.principal_id, f.thread.id);
      expect(recent).toHaveLength(80);
      expect(recent.some((message) => message.content.includes('АрДуИнО'))).toBe(false);
      const found = await f.service.threadPage(f.owner.principal_id, null, 'ардуино');
      expect(found.items).toHaveLength(1);
      expect(found.items[0]).toMatchObject({
        id: f.thread.id,
        title: 'Схема проекта',
        matchPreview: expect.stringContaining('АрДуИнО'),
      });
      expect((await f.service.threadPage(f.owner.principal_id, null, '%_')).items).toHaveLength(1);
      expect((await f.service.threadPage(f.owner.principal_id, null, '50%X')).items).toEqual([]);
      expect((await f.service.threadPage(f.owner.principal_id, null, 'схема')).items[0]?.id).toBe(
        f.thread.id,
      );
      expect((await f.service.threadPage(f.stranger.principal_id, null, 'ардуино')).items).toEqual(
        [],
      );
      expect((await f.service.threadPage(f.platform.principal_id, null, 'ардуино')).items).toEqual(
        [],
      );
    });

    it('keyset-paginates 107 same-millisecond search hits once with exact six-digit cursors', async () => {
      const f = await fixture();
      const inserted = await f.admin.query<{ id: string }>(
        `INSERT INTO ai_assistant_threads(account_id,owner_principal_id,title,updated_at)
         SELECT $1,$2,'Нужная тема ' || n,TIMESTAMPTZ '2026-10-19 12:00:00.123000+00' + n * interval '1 microsecond'
         FROM generate_series(1,107) AS n RETURNING id`,
        [f.owner.account_id, f.owner.principal_id],
      );
      let cursor: AiCursor | null = null;
      const ids: string[] = [];
      do {
        const page = await f.service.threadPage(f.owner.principal_id, cursor, 'ТЕМА');
        ids.push(...page.items.map((thread) => thread.id));
        cursor = page.nextCursor;
        if (cursor) expect(cursor.at).toMatch(/^2026-10-19T12:00:00\.123\d{3}Z$/);
        expect(ids.length).toBeLessThanOrEqual(107);
      } while (cursor);
      expect(ids).toHaveLength(107);
      expect(new Set(ids)).toEqual(new Set(inserted.rows.map((row) => row.id)));
    });

    it('archives and restores without changing history or ledgers; replay remains free and fresh legacy admission is denied', async () => {
      const f = await fixture(),
        request = randomUUID();
      await f.service.send(f.owner.principal_id, f.thread.id, 'Сохранить вопрос', request);
      const history = await f.service.messages(f.owner.principal_id, f.thread.id),
        before = await f.ledgers();
      const archived = await f.service.archiveThread(f.owner.principal_id, f.thread.id, true);
      expect(archived.archivedAt).toBeTruthy();
      expect((await f.service.threadPage(f.owner.principal_id)).items).toEqual([]);
      expect(
        (await f.service.threadPage(f.owner.principal_id, null, 'Сохранить', true)).items[0]?.id,
      ).toBe(f.thread.id);
      expect(await f.service.messages(f.owner.principal_id, f.thread.id)).toEqual(history);
      expect(
        (await f.service.send(f.owner.principal_id, f.thread.id, 'Сохранить вопрос', request))
          .replayed,
      ).toBe(true);
      await expect(
        f.service.send(f.owner.principal_id, f.thread.id, 'Новый вопрос', randomUUID()),
      ).rejects.toMatchObject({ code: 'ai_thread_archived' });
      await expect(
        f.runtime.query("SELECT ai_chat_begin_paid($1,$2,$3,'Старый API',$4)", [
          f.owner.principal_id,
          f.thread.id,
          randomUUID(),
          await f.version(),
        ]),
      ).rejects.toThrow('AI_THREAD_ARCHIVED');
      const source = history.find((message) => message.role === 'user')!.id;
      await expect(f.regenerate(source)).rejects.toMatchObject({ code: 'ai_thread_archived' });
      expect(await f.ledgers()).toEqual(before);
      expect(f.upstream).toHaveBeenCalledTimes(1);
      await expect(
        f.service.archiveThread(f.stranger.principal_id, f.thread.id, false),
      ).rejects.toMatchObject({ code: 'ai_thread_not_found' });
      const restored = await f.service.archiveThread(f.owner.principal_id, f.thread.id, false);
      expect(restored.archivedAt).toBeUndefined();
      expect(await f.service.messages(f.owner.principal_id, f.thread.id)).toEqual(history);
      await f.regenerate(source);
      expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
    });

    it('does not archive an admitted request, and Stop/finish retain the original ownership marker', async () => {
      const f = await fixture(),
        question = await f.seedQuestion('Исходный вопрос'),
        request = randomUUID();
      await f.runtime.query('SELECT ai_text_regenerate_begin($1,$2,$3,$4,$5)', [
        f.owner.principal_id,
        f.thread.id,
        request,
        question.sourceId,
        await f.version(),
      ]);
      await expect(
        f.service.archiveThread(f.owner.principal_id, f.thread.id, true),
      ).rejects.toMatchObject({ code: 'ai_thread_busy' });
      await f.runtime.query('SELECT ai_chat_abort($1,$2,$3)', [
        f.stranger.principal_id,
        f.thread.id,
        request,
      ]);
      expect(
        (
          await f.admin.query<{ active_request_id: string }>(
            'SELECT active_request_id FROM ai_assistant_threads WHERE id=$1',
            [f.thread.id],
          )
        ).rows[0]!.active_request_id,
      ).toBe(request);
      await expect(
        f.runtime.query("SELECT ai_chat_finish($1,$2,$3,'Подмена','complete')", [
          f.stranger.principal_id,
          f.thread.id,
          request,
        ]),
      ).rejects.toThrow('AI_THREAD_DENIED');
      await f.runtime.query("SELECT ai_chat_finish($1,$2,$3,'Частичный вариант','stopped')", [
        f.owner.principal_id,
        f.thread.id,
        request,
      ]);
      await f.service.archiveThread(f.owner.principal_id, f.thread.id, true);
      expect(
        await f.service.requestMessages(f.owner.principal_id, f.thread.id, request),
      ).toMatchObject([
        { role: 'assistant', state: 'stopped', sourceUserMessageId: question.sourceId },
      ]);
    });

    it('preserves all questions and answers, and regenerates only the immutable context before the selected question', async () => {
      const f = await fixture();
      const first = await f.seedQuestion('Первый вопрос', 'Первый ответ');
      const target = await f.seedQuestion('Целевой вопрос', 'Прежний ответ на целевой вопрос');
      await f.seedQuestion('Поздний вопрос с секретом', 'Поздний ответ с секретом');
      await f.seedQuestion(
        'Вставка позже с давней датой',
        undefined,
        f.thread.id,
        '2000-01-01T00:00:00.000Z',
      );
      // A newer answer to an earlier question is also future context for the
      // selected original prompt, even though its source question is earlier.
      await f.regenerate(first.sourceId);
      const before = await f.service.messages(f.owner.principal_id, f.thread.id),
        ledger = await f.ledgers(),
        request = randomUUID();
      const result = await f.regenerate(target.sourceId, request);
      expect(result).toMatchObject({
        replayed: false,
        messages: [
          {
            role: 'assistant',
            requestId: request,
            sourceUserMessageId: target.sourceId,
            sourcePrompt: 'Целевой вопрос',
            regenerated: true,
          },
        ],
      });
      expect(result.messages).toHaveLength(1);
      const body = JSON.parse(String(f.upstream.mock.calls[1]?.[1]?.body));
      expect(body.input).toEqual([
        { role: 'user', content: 'Первый вопрос' },
        { role: 'assistant', content: 'Первый ответ' },
        { role: 'user', content: 'Целевой вопрос' },
      ]);
      const after = await f.service.messages(f.owner.principal_id, f.thread.id);
      expect(after.filter((message) => before.some((old) => old.id === message.id))).toEqual(
        before,
      );
      expect(after.filter((message) => message.role === 'user')).toHaveLength(4);
      expect(after).toHaveLength(before.length + 1);
      expect(await f.ledgers()).toEqual({ global: ledger.global + 1, owner: ledger.owner + 1 });
      expect(
        await f.regenerate(target.sourceId.toUpperCase(), request.toUpperCase()),
      ).toMatchObject({ replayed: true, messages: result.messages });
      expect(f.upstream).toHaveBeenCalledTimes(2);
    });

    it('keeps at most eight source questions and chooses only answers existing before the original prompt', async () => {
      const f = await fixture();
      const questions: string[] = [];
      for (let index = 0; index < 12; index += 1)
        questions.push((await f.seedQuestion('Вопрос ' + index, 'Ответ ' + index)).sourceId);
      const request = randomUUID();
      await f.regenerate(questions[8]!, request);
      const body = JSON.parse(String(f.upstream.mock.calls[0]?.[1]?.body));
      expect(body.input).toHaveLength(15);
      expect(body.input[0]).toEqual({ role: 'user', content: 'Вопрос 1' });
      expect(body.input.at(-1)).toEqual({ role: 'user', content: 'Вопрос 8' });
      expect(
        body.input.some((message: { content: string }) =>
          /(?:Вопрос|Ответ) (?:9|10|11)|Ответ 8/.test(message.content),
        ),
      ).toBe(false);
    });

    it('cannot mutate source content, sequence, owner or regeneration receipt, and denies runtime table/helper access', async () => {
      const f = await fixture(),
        question = await f.seedQuestion('Неизменяемый вопрос');
      await f.regenerate(question.sourceId);
      for (const assignment of [
        "content='Подмена'",
        'ordinal=ordinal+1000',
        "created_at=TIMESTAMPTZ '2001-01-01'",
      ]) {
        await expect(
          f.admin.query('UPDATE ai_assistant_messages SET ' + assignment + ' WHERE id=$1', [
            question.sourceId,
          ]),
        ).rejects.toThrow('AI_MESSAGE_IMMUTABLE');
      }
      await expect(
        f.admin.query(
          "UPDATE ai_assistant_regenerations SET source_prompt='Подмена' WHERE owner_principal_id=$1",
          [f.owner.principal_id],
        ),
      ).rejects.toThrow('AI_REGENERATION_IMMUTABLE');
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(
          (
            await f.admin.query<{ allowed: boolean }>(
              "SELECT has_table_privilege('asalab_app','ai_assistant_regenerations',$1) AS allowed",
              [privilege],
            )
          ).rows[0]!.allowed,
        ).toBe(false);
      }
      const protection = (
        await f.admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='ai_assistant_regenerations'::regclass",
        )
      ).rows[0]!;
      expect(protection).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      await expect(
        f.runtime.query("SELECT ai_text_source_digest($1,$2,$3,1,'Вопрос')", [
          f.owner.principal_id,
          f.thread.id,
          question.sourceId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('rejects a reused normal UUID, wrong thread, another owner and another source without reserving again', async () => {
      const f = await fixture(),
        original = randomUUID();
      await f.service.send(f.owner.principal_id, f.thread.id, 'Вопрос', original);
      const history = await f.service.messages(f.owner.principal_id, f.thread.id),
        source = history.find((message) => message.role === 'user')!.id;
      const request = randomUUID();
      await f.regenerate(source, request);
      const other = await f.service.createThread(f.owner.principal_id),
        elsewhere = await f.seedQuestion('Другой вопрос', undefined, other.id);
      const before = await f.ledgers();
      await expect(f.regenerate(source, original)).rejects.toMatchObject({
        code: 'ai_request_id_reused',
      });
      await expect(f.regenerate(elsewhere.sourceId, request)).rejects.toMatchObject({
        code: 'ai_request_id_reused',
      });
      await expect(
        f.regenerate(source, request, f.owner.principal_id, other.id),
      ).rejects.toMatchObject({ code: 'ai_request_id_reused' });
      await expect(
        f.regenerate(source, randomUUID(), f.stranger.principal_id),
      ).rejects.toMatchObject({ code: 'ai_source_not_found' });
      await expect(f.regenerate(elsewhere.sourceId)).rejects.toMatchObject({
        code: 'ai_source_not_found',
      });
      expect(await f.ledgers()).toEqual(before);
      expect(f.upstream).toHaveBeenCalledTimes(2);
      expect(
        await f.service.requestMessages(f.stranger.principal_id, f.thread.id, request),
      ).toEqual([]);
    });

    it('rejects an inconsistent persisted source digest before replay, payment or provider access', async () => {
      const f = await fixture(),
        question = await f.seedQuestion('Неизменяемый источник'),
        request = randomUUID();
      await f.admin.query(
        'INSERT INTO ai_assistant_request_quota(account_id,owner_principal_id,request_id) VALUES($1,$2,$3)',
        [f.owner.account_id, f.owner.principal_id, request],
      );
      // Simulate a corrupt imported receipt using the isolated migration role.
      // Runtime callers have no INSERT or UPDATE privilege on this table.
      await f.admin.query(
        `INSERT INTO ai_assistant_regenerations
          (owner_principal_id,request_id,thread_id,source_user_message_id,source_ordinal,source_prompt,source_digest)
        SELECT owner_principal_id,$2,thread_id,id,ordinal,content,decode(repeat('00',32),'hex')
        FROM ai_assistant_messages WHERE id=$1`,
        [question.sourceId, request],
      );
      const before = await f.ledgers();
      await expect(f.regenerate(question.sourceId, request)).rejects.toMatchObject({
        code: 'ai_request_id_reused',
        status: 409,
      });
      expect(f.upstream).not.toHaveBeenCalled();
      expect(await f.ledgers()).toEqual(before);
      expect(await f.service.requestMessages(f.owner.principal_id, f.thread.id, request)).toEqual(
        [],
      );
    });

    it('an uncertain provider failure, archive and configuration change cannot charge the same operation twice', async () => {
      const f = await fixture(),
        question = await f.seedQuestion('Не повторять списание'),
        request = randomUUID(),
        before = await f.ledgers();
      f.upstream.mockRejectedValue(new Error('Lost provider response after acceptance'));
      await expect(f.regenerate(question.sourceId, request)).rejects.toMatchObject({
        code: 'ai_provider_unavailable',
      });
      await f.service.archiveThread(f.owner.principal_id, f.thread.id, true);
      await f.admin.query('UPDATE ai_assistant_config SET enabled=false WHERE singleton_key');
      expect(await f.regenerate(question.sourceId, request)).toEqual({
        replayed: true,
        stopped: false,
        messages: [],
      });
      expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
      expect(f.upstream).toHaveBeenCalledTimes(1);
      expect(
        (await f.service.messages(f.owner.principal_id, f.thread.id)).filter(
          (message) => message.role === 'user',
        ),
      ).toHaveLength(1);
    });

    it('thread deletion removes variant projections but retains both non-refundable paid ledgers and UUID tombstones', async () => {
      const f = await fixture(),
        question = await f.seedQuestion('Удаляемая переписка'),
        request = randomUUID();
      await f.regenerate(question.sourceId, request);
      const before = await f.ledgers();
      await f.service.deleteThread(f.owner.principal_id, f.thread.id);
      expect(
        (
          await f.admin.query(
            'SELECT request_id FROM ai_assistant_regenerations WHERE owner_principal_id=$1',
            [f.owner.principal_id],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await f.admin.query('SELECT id FROM ai_assistant_messages WHERE thread_id=$1', [
            f.thread.id,
          ])
        ).rows,
      ).toEqual([]);
      expect(await f.ledgers()).toEqual(before);
      const other = await f.service.createThread(f.owner.principal_id),
        next = await f.seedQuestion('Другой вопрос', undefined, other.id);
      await expect(
        f.regenerate(next.sourceId, request, f.owner.principal_id, other.id),
      ).rejects.toMatchObject({ code: 'ai_request_id_reused' });
      expect(await f.ledgers()).toEqual(before);
    });

    it('keeps Seat history after linkage and teacher revocation, permits archive/replay and denies fresh generation or teacher search', async () => {
      const f = await fixture(),
        school = await aiClassFixture(f.admin, f.runtime),
        access = new AiAccessService(f.runtime);
      await access.saveClassroom(school.teacher.principal_id, school.classroomId, {
        kind: 'classroom',
        mode: 'allow',
        minimumRating: 50,
        expectedRevision: 0,
        requestId: randomUUID(),
      });
      const thread = await f.service.createThread(school.principalId);
      await f.service.send(school.principalId, thread.id, 'Личный школьный вопрос', randomUUID());
      const source = (await f.service.messages(school.principalId, thread.id)).find(
          (message) => message.role === 'user',
        )!.id,
        request = randomUUID();
      await f.regenerate(source, request, school.principalId, thread.id);
      await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
        school.seatId,
        f.owner.account_id,
      ]);
      await f.admin.query('SELECT learning_audience_ensure_seat_identity($1)', [school.seatId]);
      expect(await access.owner(f.owner.principal_id, school.seatId)).toBe(school.principalId);
      await access.saveClassroom(school.teacher.principal_id, school.classroomId, {
        kind: 'classroom',
        mode: 'deny',
        minimumRating: 50,
        expectedRevision: 1,
        requestId: randomUUID(),
      });
      expect((await f.service.threadPage(school.principalId, null, 'школьный')).items[0]?.id).toBe(
        thread.id,
      );
      expect(
        (await f.service.threadPage(school.teacher.principal_id, null, 'школьный')).items,
      ).toEqual([]);
      expect((await f.service.threadPage(f.owner.principal_id, null, 'школьный')).items).toEqual(
        [],
      );
      const before = await f.ledgers();
      expect((await f.regenerate(source, request, school.principalId, thread.id)).replayed).toBe(
        true,
      );
      await expect(
        f.regenerate(source, randomUUID(), school.principalId, thread.id),
      ).rejects.toMatchObject({ status: 403 });
      await f.service.archiveThread(school.principalId, thread.id, true);
      expect(
        (await f.service.threadPage(school.principalId, null, 'школьный', true)).items[0]?.id,
      ).toBe(thread.id);
      await f.service.archiveThread(school.principalId, thread.id, false);
      expect(await f.ledgers()).toEqual(before);
      const stored = (
        await f.admin.query<{ account_id: null; owner_principal_id: string }>(
          'SELECT account_id,owner_principal_id FROM ai_assistant_messages WHERE thread_id=$1',
          [thread.id],
        )
      ).rows;
      expect(stored.length).toBe(3);
      expect(
        stored.every(
          (row) => row.account_id === null && row.owner_principal_id === school.principalId,
        ),
      ).toBe(true);
    });
  });
}
