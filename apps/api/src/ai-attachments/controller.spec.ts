import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { HttpException } from '@nestjs/common';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiAccessService } from '../ai-access.service';
import { createApiApp } from '../app.factory';
import { AccountVerificationService } from '../account-verification.service';
import { SeatContextUseCase } from '../seat-context';
import { TOKENS } from '../tokens';
import { captureAiAttachment } from './capture';
import { AiAttachmentError, attachmentReceipt, type AiAttachmentRecord } from './contracts';
import { AiAttachmentService } from './service';
import { AI_ATTACHMENT_CONTENT_TYPE } from './transport';
import { aiAttachmentImageFixture } from './validation.fixture';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SEAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLASS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const HOST = '127.0.0.1:4612';
const ORIGIN = `http://${HOST}`;
const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

async function fixture() {
  const app = await createApiApp({
    pool: null,
    analyticsPool: null,
    webDist: null,
    allowedWebOrigin: ORIGIN,
  });
  apps.push(app);
  const accounts = app.get<ActiveContextUseCase>(TOKENS.activeContextUseCase);
  const seats = app.get<SeatContextUseCase>(TOKENS.seatContextUseCase);
  const files = app.get<AiAttachmentService>(TOKENS.aiAttachmentService);
  const verification = app.get<AccountVerificationService>(TOKENS.accountVerification);
  vi.spyOn(verification, 'isEnabled').mockResolvedValue(false);
  const account = vi
    .spyOn(accounts, 'resolve')
    .mockResolvedValue({ principalId: ACCOUNT, accountId: ACCOUNT } as Awaited<
      ReturnType<ActiveContextUseCase['resolve']>
    >);
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('classroom_student_session_context'))
      return {
        rows: [{ seat_id: SEAT, classroom_id: CLASS, display_label: 'Ученик', safe_mode: true }],
      };
    if (sql.includes('ai_student_principal_existing'))
      return { rows: [{ principal_id: OWNER, tenant_id: ACCOUNT, classroom_id: CLASS }] };
    throw new Error('Unexpected identity query');
  });
  const pureSeat = new SeatContextUseCase({ query } as unknown as pg.Pool);
  vi.spyOn(seats, 'resolveExistingState').mockImplementation((token) =>
    pureSeat.resolveExistingState(token),
  );
  const initialize = vi
    .spyOn(seats, 'resolve')
    .mockRejectedValue(new Error('AI must not initialize identity'));
  const ownerQuery = vi.fn(async (_sql: string, params: unknown[]) => ({
    rows: [{ value: params[1] ? OWNER : params[0] }],
  }));
  const authority = new AiAccessService({ query: ownerQuery } as unknown as pg.Pool);
  vi.spyOn(app.get<AiAccessService>(TOKENS.aiAccessService), 'owner').mockImplementation(
    (actor, selector) => authority.owner(actor, selector),
  );
  const bytes = aiAttachmentImageFixture('png');
  const row: AiAttachmentRecord = {
    uploadId: randomUUID(),
    ownerId: OWNER,
    fileName: 'Чертёж.png',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    extension: 'png',
    mediaType: 'image/png',
    kind: 'image',
    state: 'ready',
    held: true,
    width: 3,
    height: 2,
    text: null,
    attemptId: randomUUID(),
    leaseId: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    deleteRequested: false,
    errorCode: null,
  };
  const reserve = vi.spyOn(files, 'reserve').mockImplementation(async () => attachmentReceipt(row));
  const get = vi.spyOn(files, 'get').mockImplementation(async () => attachmentReceipt(row));
  const upload = vi.spyOn(files, 'upload').mockImplementation(async () => attachmentReceipt(row));
  const read = vi
    .spyOn(files, 'read')
    .mockImplementation(async () => ({ receipt: attachmentReceipt(row), bytes }));
  vi.spyOn(files, 'withRead').mockImplementation(async (owner, upload, consume) =>
    consume(await files.read(owner, upload)),
  );
  const remove = vi.spyOn(files, 'remove').mockImplementation(async () => attachmentReceipt(row));
  const reconcile = vi
    .spyOn(files, 'reconcile')
    .mockImplementation(async () => attachmentReceipt(row));
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  const inject = (options: InjectOptions) =>
    fastify.inject({
      ...options,
      headers: {
        host: HOST,
        origin: ORIGIN,
        'content-type': 'application/json',
        cookie: 'asa_student_session=seat',
        ...options.headers,
      },
    });
  return {
    app,
    fastify,
    inject,
    account,
    query,
    initialize,
    ownerQuery,
    row,
    bytes,
    files,
    reserve,
    get,
    upload,
    read,
    remove,
    reconcile,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const operations = [
  { method: 'POST', suffix: '', call: 'reserve', status: 201 },
  { method: 'GET', suffix: '/:id', call: 'get', status: 200 },
  { method: 'PUT', suffix: '/:id/bytes', call: 'upload', status: 200 },
  { method: 'GET', suffix: '/:id/bytes', call: 'read', status: 200 },
  { method: 'DELETE', suffix: '/:id', call: 'remove', status: 200 },
  { method: 'POST', suffix: '/:id/reconcile', call: 'reconcile', status: 200 },
] as const;
function operationRequest(
  f: Fixture,
  operation: (typeof operations)[number],
  headers: Record<string, string> = {},
): InjectOptions {
  return {
    method: operation.method,
    url: `/api/ai/attachments${operation.suffix.replace(':id', f.row.uploadId)}`,
    ...(operation.method === 'GET' ? {} : { payload: operation.method === 'PUT' ? f.bytes : {} }),
    headers: {
      ...(operation.method === 'PUT' ? { 'content-type': AI_ATTACHMENT_CONTENT_TYPE } : {}),
      ...headers,
    },
  };
}
function privateHeaders(headers: Record<string, unknown>) {
  expect(headers['cache-control']).toBe('private, no-store');
  expect(headers.vary).toContain('Cookie');
  expect(headers.vary).toContain('X-Asa-Ai-Seat');
  expect(headers['x-content-type-options']).toBe('nosniff');
}

describe('registered AI private attachment HTTP boundary', () => {
  it.each(operations)(
    '$method $suffix uses only canonical existing Seat ownership and private replies',
    async (operation) => {
      const f = await fixture();
      const response = await f.inject(
        operationRequest(f, operation, { 'x-asa-ai-seat': SEAT.toUpperCase() }),
      );
      expect(response.statusCode).toBe(operation.status);
      privateHeaders(response.headers);
      expect(f.account).not.toHaveBeenCalled();
      expect(f.initialize).not.toHaveBeenCalled();
      expect(f.query).toHaveBeenCalledTimes(2);
      expect(f.ownerQuery).toHaveBeenCalledWith('SELECT ai_access_owner($1,$2) AS value', [
        OWNER,
        SEAT,
      ]);
      expect(f[operation.call].mock.calls[0]?.[0]).toBe(OWNER);
      if (operation.call !== 'read') {
        expect(response.json()).toEqual(attachmentReceipt(f.row));
        for (const key of [
          'ownerId',
          'text',
          'extension',
          'attemptId',
          'leaseId',
          'held',
          'url',
          'key',
        ])
          expect(response.json()).not.toHaveProperty(key);
      }
    },
  );

  it.each(operations)(
    '$method $suffix denies a historical missing Seat owner with typed 403 and no Account lookup',
    async (operation) => {
      const f = await fixture();
      f.query.mockImplementation(
        async (sql) =>
          ({
            rows: sql.includes('classroom_student_session_context')
              ? [{ seat_id: SEAT, classroom_id: CLASS, display_label: 'Ученик', safe_mode: true }]
              : [],
          }) as Awaited<ReturnType<typeof f.query>>,
      );
      const response = await f.inject(operationRequest(f, operation));
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'ai_scope_denied' } });
      privateHeaders(response.headers);
      expect(f.account).not.toHaveBeenCalled();
      expect(f.initialize).not.toHaveBeenCalled();
      expect(f.ownerQuery).not.toHaveBeenCalled();
      expect(f[operation.call]).not.toHaveBeenCalled();
    },
  );

  it.each(operations)(
    '$method $suffix preserves the global mixed-session conflict before any storage',
    async (operation) => {
      const f = await fixture();
      const response = await f.inject(
        operationRequest(f, operation, { cookie: 'asa_student_session=seat; asa_session=account' }),
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'session_conflict' } });
      privateHeaders(response.headers);
      expect(f.query).not.toHaveBeenCalled();
      expect(f.account).not.toHaveBeenCalled();
      expect(f[operation.call]).not.toHaveBeenCalled();
    },
  );

  it('an empty Seat cookie cannot substitute the retained Account proof, even on a GET', async () => {
    const f = await fixture();
    const response = await f.inject({
      method: 'GET',
      url: `/api/ai/attachments/${f.row.uploadId}`,
      headers: { cookie: 'asa_student_session=; asa_session=account' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'ai_session_required' } });
    expect(f.account).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
  });

  it('Account-selected Seat passes through the SQL authority, and its denial cannot return file bytes', async () => {
    const f = await fixture();
    let response = await f.inject({
      method: 'GET',
      url: `/api/ai/attachments/${f.row.uploadId}`,
      headers: { cookie: 'asa_session=account', 'x-asa-ai-seat': SEAT.toUpperCase() },
    });
    expect(response.statusCode).toBe(200);
    expect(f.ownerQuery).toHaveBeenCalledWith('SELECT ai_access_owner($1,$2) AS value', [
      ACCOUNT,
      SEAT,
    ]);
    f.ownerQuery.mockRejectedValueOnce(new Error('AI_SCOPE_DENIED'));
    response = await f.inject({
      method: 'GET',
      url: `/api/ai/attachments/${f.row.uploadId}/bytes`,
      headers: { cookie: 'asa_session=account', 'x-asa-ai-seat': SEAT },
    });
    expect(response.statusCode).toBe(403);
    expect(f.read).not.toHaveBeenCalled();
    privateHeaders(response.headers);
  });

  it('serves authenticated image and HTML-source bytes as private downloads, including HEAD, never executable source', async () => {
    const f = await fixture();
    const image = await f.inject({
      method: 'GET',
      url: `/api/ai/attachments/${f.row.uploadId}/bytes`,
    });
    expect(image.rawPayload).toEqual(f.bytes);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['content-length']).toBe(String(f.bytes.length));
    expect(image.headers['content-disposition']).toContain("filename*=UTF-8''%D0%A7");
    expect(image.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    const html = Buffer.from('<script>fetch("https://untrusted.invalid")</script>');
    f.read.mockResolvedValue({
      receipt: {
        ...attachmentReceipt(f.row),
        kind: 'text',
        fileName: 'example.html',
        mediaType: 'text/html',
        sizeBytes: html.length,
      },
      bytes: html,
    });
    const source = await f.inject({
      method: 'GET',
      url: `/api/ai/attachments/${f.row.uploadId}/bytes`,
    });
    expect(source.rawPayload).toEqual(html);
    expect(source.headers['content-type']).toBe('text/plain; charset=utf-8');
    const head = await f.inject({
      method: 'HEAD',
      url: `/api/ai/attachments/${f.row.uploadId}/bytes`,
    });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    privateHeaders(head.headers);
  });

  it.each(['unknown', 'uploading', 'deleting'] as const)(
    'returns a truthful 202 %s receipt instead of claiming readiness',
    async (state) => {
      const f = await fixture();
      f.row.state = state;
      const response = await f.inject(operationRequest(f, operations[5]));
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ state, uploadId: f.row.uploadId });
    },
  );

  it.each([
    { headers: { 'content-type': 'image/png' }, status: 415 },
    { headers: { 'content-type': `${AI_ATTACHMENT_CONTENT_TYPE}; charset=utf-8` }, status: 415 },
    { headers: { 'content-encoding': 'gzip' }, status: 415 },
    { headers: { 'content-length': String(8 * 1024 * 1024 + 1) }, status: 413 },
    { headers: { origin: 'https://untrusted.invalid' }, status: 403 },
  ])('rejects invalid byte framing before upload: $headers', async ({ headers, status }) => {
    const f = await fixture();
    const response = await f.inject(operationRequest(f, operations[2], headers));
    expect(response.statusCode).toBe(status);
    privateHeaders(response.headers);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it.each(['valid', 'oversized', 'different', 'invalid-format'] as const)(
    'checks actual streamed %s bytes and releases capture files with a normal HTTP response',
    async (kind) => {
      const f = await fixture();
      await mkdir('reports', { recursive: true });
      const directory = await mkdtemp(join(process.cwd(), 'reports/ai-attachment-http-'));
      directories.push(directory);
      const bytes =
        kind === 'oversized'
          ? Buffer.concat([f.bytes, Buffer.from([0])])
          : kind === 'different'
            ? Buffer.alloc(f.bytes.length, 0)
            : kind === 'invalid-format'
              ? Buffer.from('not an image')
              : f.bytes;
      if (kind === 'invalid-format') {
        f.row.sizeBytes = bytes.length;
        f.row.sha256 = createHash('sha256').update(bytes).digest('hex');
      }
      f.upload.mockImplementation(async (_owner, _id, source, signal) => {
        const capture = await captureAiAttachment(source, f.row, { tempRoot: directory, signal });
        try {
          expect(capture.validated).toMatchObject({ kind: 'image', width: 3, height: 2 });
        } finally {
          await capture.dispose();
        }
        return attachmentReceipt(f.row);
      });
      const response = await f.inject({
        ...operationRequest(f, operations[2]),
        payload: Readable.from([bytes.subarray(0, 12), bytes.subarray(12)]),
      });
      expect(response.statusCode).toBe(kind === 'valid' ? 200 : kind === 'oversized' ? 413 : 400);
      privateHeaders(response.headers);
      expect(await readdir(join(directory, 'asa-ai-private-uploads'))).toEqual([]);
    },
  );

  it('foreign upload, expired bytes and a bound delete preserve typed refusals without data or private SQL details', async () => {
    const f = await fixture();
    for (const [code, status] of [
      ['ai_attachment_not_found', 404],
      ['ai_attachment_expired', 410],
      ['ai_attachment_bound', 409],
    ] as const) {
      const operation = code === 'ai_attachment_bound' ? operations[4] : operations[3];
      f[operation.call].mockRejectedValueOnce(
        new AiAttachmentError(code, status, 'Вложение недоступно.'),
      );
      const response = await f.inject(operationRequest(f, operation));
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ error: { code } });
      privateHeaders(response.headers);
      expect(response.body).not.toContain(f.row.sha256);
      expect(response.body).not.toContain(OWNER);
    }
  });

  it('Account verification protects all attachment operations when enabled', async () => {
    const f = await fixture();
    const verification = f.app.get<AccountVerificationService>(TOKENS.accountVerification);
    vi.spyOn(verification, 'isEnabled').mockResolvedValue(true);
    const required = vi
      .spyOn(verification, 'requireAccount')
      .mockRejectedValue(
        new HttpException({ error: { code: 'account_verification_required' } }, 403),
      );
    for (const operation of operations) {
      const response = await f.inject(
        operationRequest(f, operation, { cookie: 'asa_session=account' }),
      );
      expect(response.statusCode).toBe(403);
      expect(f[operation.call]).not.toHaveBeenCalled();
    }
    expect(required).toHaveBeenCalledTimes(6);
  });

  it('all four registered attachment mutations retain pure Seat proof after the shared 900-request budget saturates', async () => {
    const f = await fixture();
    for (let index = 0; index < 900; index += 1) {
      const warm = await f.inject(
        operationRequest(f, operations[0], { cookie: `asa_session=warm-${index}` }),
      );
      expect(warm.statusCode).toBe(201);
    }
    f.account.mockClear();
    f.query.mockClear();
    for (const operation of operations.filter((item) => item.method !== 'GET')) {
      const response = await f.inject(operationRequest(f, operation));
      expect(response.statusCode).toBe(operation.status);
    }
    // One positive proof cache entry plus each actual controller authorization.
    expect(f.query).toHaveBeenCalledTimes(10);
    expect(
      f.query.mock.calls.every(
        ([sql]) =>
          sql.includes('classroom_student_session_context') ||
          sql.includes('ai_student_principal_existing'),
      ),
    ).toBe(true);
    expect(f.account).not.toHaveBeenCalled();
    expect(f.initialize).not.toHaveBeenCalled();
    f.query.mockImplementation(
      async (sql) =>
        ({
          rows: sql.includes('classroom_student_session_context')
            ? [{ seat_id: SEAT, classroom_id: CLASS, display_label: 'Ученик', safe_mode: true }]
            : [],
        }) as Awaited<ReturnType<typeof f.query>>,
    );
    f.reserve.mockClear();
    const missing = await f.inject(
      operationRequest(f, operations[0], {
        cookie: 'asa_student_session=historical-missing-owner',
      }),
    );
    expect(missing.statusCode).toBe(429);
    expect(missing.json()).toMatchObject({ error: { code: 'too_many_requests' } });
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.account).not.toHaveBeenCalled();
    expect(f.initialize).not.toHaveBeenCalled();
  });
});
