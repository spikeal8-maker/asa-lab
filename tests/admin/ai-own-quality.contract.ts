import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it } from 'vitest';
import { AiOwnQualityService, maskOwnQualityText } from '../../apps/api/src/ai-own-quality';
import { aiClassFixture } from './ai-student-access.contract';
export function aiOwnQualityContract(database: () => { admin: pg.Pool; runtime: pg.Pool }) {
  const admin = {
    query: (...args: Parameters<pg.Pool['query']>) => database().admin.query(...args),
  } as unknown as pg.Pool;
  const runtime = {
    query: (...args: Parameters<pg.Pool['query']>) => database().runtime.query(...args),
  } as unknown as pg.Pool;
  const service = new AiOwnQualityService(runtime);
  async function identity(platform = true) {
    const a = (
      await admin.query(
        "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test','1990-01-01','RU') RETURNING id",
        [randomUUID() + '@isolated.test'],
      )
    ).rows[0].id as string;
    const p = (
      await admin.query(
        "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
        [a],
      )
    ).rows[0].id as string;
    if (platform)
      await admin.query(
        "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
        [a],
      );
    return { a, p };
  }
  async function permit(p: string) {
    const g = await service.grant(p);
    return service.save(p, {
      enabled: true,
      expectedRevision: g.revision,
      requestId: randomUUID(),
    });
  }
  async function record(
    owner: { a: string; p: string },
    n: number,
    options: {
      request?: string;
      at?: string;
      status?: string;
      answer?: string | null;
      question?: string;
      thread?: string;
    } = {},
  ) {
    const request = options.request ?? randomUUID(),
      thread =
        options.thread ??
        ((await runtime.query('SELECT ai_chat_create($1) id', [owner.p])).rows[0].id as string);
    const q = (
      await admin.query(
        "INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content) VALUES($1,$2,$3,$4,'user',$5) RETURNING id,ordinal",
        [thread, owner.a, owner.p, request, options.question ?? 'Вопрос ' + n],
      )
    ).rows[0];
    if (options.answer !== null)
      await admin.query(
        "INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content,state,source_user_message_id) VALUES($1,$2,$3,$4,'assistant',$5,$6,$7)",
        [
          thread,
          owner.a,
          owner.p,
          request,
          options.answer ?? 'Ответ ' + n,
          options.status === 'failed' ? 'stopped' : 'complete',
          q.id,
        ],
      );
    await admin.query(
      "INSERT INTO ai_usage_journal(owner_principal_id,request_id,account_id,thread_id,admitted_at,status,operation,provider,requested_model) VALUES($1,$2,$3,$4,$5,$6,'chat','ollama','requested-only')",
      [
        owner.p,
        request,
        owner.a,
        thread,
        options.at ?? '2020-01-01T00:00:00Z',
        options.status ?? 'succeeded',
      ],
    );
    return { request, thread, q };
  }
  it.each([0, 1, 9, 10, 11])(
    'returns exactly the newest permitted operations for %s rows, independently of the seven-day period',
    async (count) => {
      const owner = await identity(),
        foreign = await identity();
      await permit(owner.p);
      const ids: string[] = [];
      for (let i = 0; i < count; i++) ids.push((await record(owner, i)).request);
      await record(foreign, 99, { question: 'FOREIGN CONTENT' });
      const page = await service.list(owner.p);
      expect(page.items).toHaveLength(Math.min(count, 10));
      expect(page.items.map((r) => r.requestId)).toEqual(ids.sort().reverse().slice(0, 10));
      expect(JSON.stringify(page)).not.toContain('FOREIGN CONTENT');
      expect(
        page.items.every(
          (r) => r.actualModel === null && r.inputTokens === null && r.promptVersion === null,
        ),
      ).toBe(true);
      const again = await service.list(owner.p);
      expect(again.items.map((r) => r.requestId)).toEqual(page.items.map((r) => r.requestId));
      if (count === 11)
        await expect(service.detail(owner.p, ids[10]!)).rejects.toMatchObject({ status: 404 });
    },
  );
  it('requires a separate grant and real platform administrator, with CAS, idempotency and revoke', async () => {
    const owner = await identity(),
      ordinary = await identity(false);
    const status = await service.grant(owner.p);
    expect(status).toMatchObject({ enabled: false, revision: 0 });
    await expect(service.list(owner.p)).rejects.toMatchObject({ status: 403 });
    await expect(service.grant(ordinary.p)).rejects.toMatchObject({ status: 403 });
    const command = { enabled: true, expectedRevision: 0, requestId: randomUUID() };
    expect(await service.save(owner.p, command)).toMatchObject({ enabled: true, revision: 1 });
    expect(await service.save(owner.p, command)).toMatchObject({ revision: 1 });
    await expect(service.save(owner.p, { ...command, enabled: false })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.save(owner.p, { ...command, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await record(owner, 1);
    expect((await service.list(owner.p)).items).toHaveLength(1);
    await service.save(owner.p, { enabled: false, expectedRevision: 1, requestId: randomUUID() });
    await expect(service.list(owner.p)).rejects.toMatchObject({ status: 403 });
    await permit(owner.p);
    await admin.query(
      "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='platform_admin'",
      [owner.a],
    );
    await expect(service.list(owner.p)).rejects.toMatchObject({ status: 403 });
  });
  it('denies every Seat, foreign operation and revoked scope-policy version', async () => {
    const owner = await identity(),
      foreign = await identity();
    await permit(owner.p);
    const hidden = await record(foreign, 1);
    await expect(service.detail(owner.p, hidden.request)).rejects.toMatchObject({ status: 404 });
    const school = await aiClassFixture(admin, runtime);
    await expect(service.grant(school.principalId)).rejects.toMatchObject({ status: 403 });
    await expect(service.list(school.principalId)).rejects.toMatchObject({ status: 403 });
    await admin.query(
      "UPDATE capability_grants SET policy_version='unsupported-scope' WHERE account_id=$1 AND capability='ai_quality_review_own'",
      [owner.a],
    );
    await expect(service.list(owner.p)).rejects.toMatchObject({ status: 403 });
  });
  it('joins regeneration to the exact original question and specific answer; missing answers never borrow neighbours', async () => {
    const owner = await identity();
    await permit(owner.p);
    const source = await record(owner, 1),
      variant = randomUUID();
    await admin.query(
      'INSERT INTO ai_assistant_request_quota(owner_principal_id,account_id,request_id) VALUES($1,$2,$3)',
      [owner.p, owner.a, variant],
    );
    await admin.query(
      "INSERT INTO ai_assistant_regenerations(owner_principal_id,request_id,thread_id,source_user_message_id,source_ordinal,source_prompt,source_digest) VALUES($1,$2,$3,$4,$5,'Вопрос 1',decode(repeat('11',32),'hex'))",
      [owner.p, variant, source.thread, source.q.id, source.q.ordinal],
    );
    await admin.query(
      "INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content,source_user_message_id) VALUES($1,$2,$3,$4,'assistant','Конкретный вариант',$5)",
      [source.thread, owner.a, owner.p, variant, source.q.id],
    );
    await admin.query(
      "UPDATE ai_usage_journal SET thread_id=$1,status='succeeded',operation='regeneration' WHERE owner_principal_id=$2 AND request_id=$3",
      [source.thread, owner.p, variant],
    );
    expect(await service.detail(owner.p, variant)).toMatchObject({
      question: 'Вопрос 1',
      answer: 'Конкретный вариант',
    });
    const pending = await record(owner, 2, { answer: null, status: 'running' });
    expect(await service.detail(owner.p, pending.request)).toMatchObject({
      answer: null,
      answerState: 'pending',
    });
    const error = await record(owner, 3, { answer: null, status: 'failed' });
    expect(await service.detail(owner.p, error.request)).toMatchObject({
      answer: null,
      answerState: 'error',
    });
    const partial = await record(owner, 4, { answer: 'Часть', status: 'failed' });
    expect(await service.detail(owner.p, partial.request)).toMatchObject({
      answer: 'Часть',
      answerState: 'partial',
      status: 'failed',
    });
  });
  it('excludes exact native child metadata even after receipt/thread deletion and never restores private snapshots', async () => {
    const owner = await identity();
    await permit(owner.p);
    const parent = await record(owner, 1),
      child = randomUUID();
    await admin.query(
      "INSERT INTO ai_tool_image_receipts(owner_principal_id,parent_request_id,thread_id,source_user_message_id,child_request_id,prompt,size,recipe) VALUES($1,$2,$3,$4,$5,'synthetic',512,'flux2-klein-4b-v1')",
      [owner.p, parent.request, parent.thread, parent.q.id, child],
    );
    await admin.query(
      "INSERT INTO ai_usage_journal(owner_principal_id,request_id,account_id,thread_id,admitted_at,status,operation,provider) VALUES($1,$2,$3,$4,clock_timestamp(),'succeeded','image','comfyui')",
      [owner.p, child, owner.a, parent.thread],
    );
    expect((await service.list(owner.p)).items.map((r) => r.requestId)).toEqual([parent.request]);
    await admin.query(
      "INSERT INTO ai_generation_receipts(owner_principal_id,request_id,thread_id,model,provider,policy_revision,payload_digest,template,context) VALUES($1,$2,$3,'deepseek-flash','deepseek',7,repeat('a',64),'SECRET SYSTEM TEMPLATE','{}')",
      [owner.p, parent.request, parent.thread],
    );
    expect(await service.detail(owner.p, parent.request)).toMatchObject({
      policyVersion: '7',
      promptVersion: null,
    });
    await runtime.query('SELECT ai_chat_delete($1,$2)', [owner.p, parent.thread]);
    const page = await service.list(owner.p);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      requestId: parent.request,
      question: null,
      answer: null,
      answerState: 'unavailable',
    });
    expect(JSON.stringify(page)).not.toContain('SECRET SYSTEM TEMPLATE');
  });
  it('masks full content before preview clipping, caps detail bytes, audits metadata only and rejects direct table reads', async () => {
    const owner = await identity();
    await permit(owner.p);
    const op = await record(owner, 1, {
      question: 'Напиши test@example.org +7 (999) 123-45-67',
      answer:
        'a'.repeat(230) + ' sk-veryPrivateSecret12345 ' + '```js\n<unsafe>\n```\n'.repeat(2000),
    });
    const page = await service.list(owner.p);
    expect(JSON.stringify(page)).not.toMatch(/test@example|veryPrivateSecret|999/);
    expect(page.items[0]?.truncated).toBe(true);
    const detail = await service.detail(owner.p, op.request);
    expect(detail.masked).toBe(true);
    expect(detail.answer).toContain('[ключ скрыт]');
    expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThanOrEqual(256 * 1024);
    const logs = await admin.query(
      "SELECT reason_text,target_id FROM administrative_audit_events WHERE actor_principal_id=$1 AND action LIKE 'administration.ai.quality.own.%'",
      [owner.p],
    );
    expect(logs.rows.length).toBeGreaterThan(1);
    expect(JSON.stringify(logs.rows)).not.toMatch(/test@example|veryPrivateSecret|unsafe/);
    await expect(runtime.query('SELECT * FROM ai_usage_journal')).rejects.toThrow();
    expect(
      maskOwnQualityText('Authorization: Bearer abcdefghijklmnop\nAPI_KEY="secretvalue"'),
    ).toMatchObject({ masked: true });
  });
}
