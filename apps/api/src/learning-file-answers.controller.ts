import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { checkBodyShape } from './validation.js';
import { LearningFileStorage, type LearningFileDescriptor } from './learning-file-storage.js';
import {
  describeLearningFile,
  LEARNING_FILE_CONTENT_TYPE,
  readExactLearningFile,
  rejectLearningFile as reject,
  validateLearningFile,
} from './learning-file-transport.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const REQUEST = /^[A-Za-z0-9._:-]{8,128}$/u;
const MAX_REVISION = 2_147_483_646;
interface DownloadRow {
  tenant_id: string;
  attempt_id: string;
  file_descriptor: LearningFileDescriptor;
}

function receipt(value: Record<string, unknown> | null | undefined) {
  if (!value || value['resultCode'] === 'forbidden') reject('learning_work_unavailable', 404);
  const { resultCode, ...response } = value;
  if (resultCode !== 'ok')
    reject(resultCode === 'request_conflict' ? 'idempotency_conflict' : String(resultCode), 409);
  return response;
}

function validateIds(...ids: string[]): void {
  if (!ids.every((id) => UUID.test(id))) reject('validation_error', 400);
}

function validateRevision(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw <= MAX_REVISION;
}

@Controller('api/learning/file')
export class LearningFileAnswersController implements OnModuleDestroy {
  private readonly storage = new LearningFileStorage();
  private transfers = 0;
  private readonly transferQueue: Array<() => void> = [];

  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
  ) {}

  onModuleDestroy(): void {
    this.storage.close();
  }

  private db(): pg.Pool {
    if (!this.pool) reject('database_unavailable', 503);
    return this.pool;
  }

  private async learner(request: FastifyRequest): Promise<string> {
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    const actor = seat ?? (await this.activeContext.resolve(request.cookies[SESSION_COOKIE]));
    if (!actor) reject('unauthorized', 401);
    return actor.principalId;
  }

  private async educator(request: FastifyRequest): Promise<string> {
    const actor = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) reject('unauthorized', 401);
    const educator = (await this.accounts.capabilities(actor.accountId)).find(
      (entry) => entry.capability === 'educator',
    );
    if (!educator || !['verified', 'provisional'].includes(educator.state))
      reject('educator_required', 403);
    return actor.accountId;
  }

  private async query(sql: string, parameters: unknown[], db: pg.Pool | pg.PoolClient = this.db()) {
    return receipt(
      (await db.query<{ response: Record<string, unknown> | null }>(sql, parameters)).rows[0]
        ?.response,
    );
  }

  private async withTransfer<T>(transfer: () => Promise<T>): Promise<T> {
    // Bound memory without rejecting a normal class that uploads together.
    if (this.transfers < 2) {
      this.transfers += 1;
    } else {
      if (this.transferQueue.length >= 32) reject('file_transfer_busy', 429);
      await new Promise<void>((resolve, rejectWait) => {
        const ready = () => {
          clearTimeout(deadline);
          resolve();
        };
        const deadline = setTimeout(() => {
          const index = this.transferQueue.indexOf(ready);
          if (index >= 0) this.transferQueue.splice(index, 1);
          rejectWait(
            new HttpException(
              {
                error: { code: 'file_transfer_busy', message: 'Повторите передачу файла.' },
              },
              429,
            ),
          );
        }, 60_000);
        this.transferQueue.push(ready);
      });
    }
    try {
      return await transfer();
    } finally {
      const next = this.transferQueue.shift();
      if (next) next();
      else this.transfers -= 1;
    }
  }

  @Get('runs/:activityRunId')
  async read(@Req() request: FastifyRequest, @Param('activityRunId') runId: string) {
    validateIds(runId);
    return this.query('SELECT learning_file_attempt_read($1,$2) AS response', [
      await this.learner(request),
      runId,
    ]);
  }

  @Post('runs/:activityRunId/start')
  @HttpCode(200)
  async start(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Body() raw: unknown,
  ) {
    validateIds(runId);
    const shape = checkBodyShape(raw, ['requestId']);
    const requestId = shape.ok && shape.body['requestId'];
    if (typeof requestId !== 'string' || !REQUEST.test(requestId)) reject('validation_error', 400);
    return this.query('SELECT learning_file_attempt_start($1,$2,$3) AS response', [
      await this.learner(request),
      runId,
      requestId,
    ]);
  }

  @Post('runs/:activityRunId/submit')
  @HttpCode(200)
  async submit(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Body() raw: unknown,
  ) {
    validateIds(runId);
    const shape = checkBodyShape(raw, ['requestId', 'attemptId', 'expectedRevision']);
    if (!shape.ok) reject('validation_error', 400);
    const { attemptId, expectedRevision, requestId } = shape.body;
    if (
      typeof attemptId !== 'string' ||
      !UUID.test(attemptId) ||
      !validateRevision(expectedRevision) ||
      typeof requestId !== 'string' ||
      !REQUEST.test(requestId)
    )
      reject('validation_error', 400);
    return this.query('SELECT learning_file_submission_create($1,$2,$3,$4,$5) AS response', [
      await this.learner(request),
      runId,
      attemptId,
      expectedRevision,
      requestId,
    ]);
  }

  @Put('runs/:activityRunId/draft/:attemptId/:expectedRevision/:requestId')
  async upload(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Param('attemptId') attemptId: string,
    @Param('expectedRevision') rawRevision: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    validateIds(runId, attemptId);
    const expected = Number(rawRevision);
    if (
      !/^(0|[1-9]\d{0,9})$/u.test(rawRevision) ||
      !validateRevision(expected) ||
      expected === MAX_REVISION ||
      !REQUEST.test(requestId)
    )
      reject('validation_error', 400);
    if (
      request.headers['content-type'] !== LEARNING_FILE_CONTENT_TYPE ||
      !(body instanceof Readable)
    )
      reject('file_media_type_invalid', 415);
    const file = describeLearningFile(request.headers['x-asa-file-name']);
    const rawLength = request.headers['content-length'];
    if (typeof rawLength !== 'string' || !/^[1-9]\d*$/u.test(rawLength))
      reject('file_length_required', 411);
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length > file.maxBytes) reject('file_too_large', 413);
    const actor = await this.learner(request);
    const scopeSql = 'SELECT learning_file_upload_scope($1,$2,$3,$4,$5) AS response';
    const scopeParams = [actor, runId, attemptId, expected, requestId];
    await this.query(scopeSql, scopeParams);
    return this.withTransfer(async () => {
      let bytes: Buffer;
      try {
        bytes = await readExactLearningFile(body, length, AbortSignal.timeout(30_000));
      } catch {
        reject('file_upload_incomplete', 400);
      }
      await validateLearningFile(bytes, file);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const client = await this.db().connect();
      try {
        await client.query('BEGIN');
        const { tenantId } = await this.query(scopeSql, scopeParams, client);
        const saved = await this.query(
          'SELECT learning_file_draft_save($1,$2,$3,$4,$5,$6,$7,$8,$9) AS response',
          [
            actor,
            runId,
            attemptId,
            expected,
            file.name,
            length,
            file.contentType,
            sha256,
            requestId,
          ],
          client,
        );
        try {
          await this.storage.put(String(tenantId), attemptId.toLowerCase(), sha256, bytes);
        } catch {
          reject('file_storage_unavailable', 503);
        }
        await client.query('COMMIT');
        return saved;
      } catch (problem) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw problem;
      } finally {
        client.release();
      }
    });
  }

  @Get('runs/:activityRunId/media/:role/:contentHash')
  async media(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Param('role') role: string,
    @Param('contentHash') contentHash: string,
    @Res() reply: FastifyReply,
  ) {
    validateIds(runId);
    if (!['image', 'file'].includes(role) || !/^[a-f0-9]{64}$/u.test(contentHash))
      reject('validation_error', 400);
    const {
      rows: [row],
    } = await this.db().query<{ media_bytes: Buffer; content_type: string }>(
      'SELECT * FROM learning_file_media_read($1,$2,$3,$4)',
      [await this.learner(request), runId, role, contentHash],
    );
    if (
      !row ||
      !Buffer.isBuffer(row.media_bytes) ||
      (role === 'file'
        ? row.content_type !== 'application/pdf'
        : !['image/png', 'image/jpeg', 'image/webp'].includes(row.content_type))
    )
      reject('learning_media_unavailable', 404);
    void reply
      .type(row.content_type)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff');
    if (role === 'file')
      void reply.header('Content-Disposition', 'attachment; filename="material.pdf"');
    return reply.send(row.media_bytes);
  }

  private async sendDownload(row: DownloadRow | undefined, reply: FastifyReply) {
    if (!row) reject('learning_work_unavailable', 404);
    return this.withTransfer(async () => {
      let bytes: Buffer;
      try {
        bytes = await this.storage.read(row.tenant_id, row.attempt_id, row.file_descriptor);
      } catch {
        reject('file_storage_unavailable', 503);
      }
      const name = encodeURIComponent(row.file_descriptor.name).replace(
        /['()*]/gu,
        (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
      );
      return reply
        .type('application/octet-stream')
        .header('Content-Disposition', "attachment; filename*=UTF-8''" + name)
        .header('Content-Security-Policy', "sandbox; default-src 'none'")
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(bytes);
    });
  }

  @Get('runs/:activityRunId/files/:fileId')
  async learnerDownload(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Param('fileId') fileId: string,
    @Res() reply: FastifyReply,
  ) {
    validateIds(runId, fileId);
    const {
      rows: [row],
    } = await this.db().query<DownloadRow>('SELECT * FROM learning_file_download($1,$2,$3)', [
      await this.learner(request),
      runId,
      fileId,
    ]);
    return this.sendDownload(row, reply);
  }

  @Get('classes/:classroomId/attempts/:attemptId/files/:fileId')
  async teacherDownload(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('attemptId') attemptId: string,
    @Param('fileId') fileId: string,
    @Res() reply: FastifyReply,
  ) {
    validateIds(classroomId, attemptId, fileId);
    const {
      rows: [row],
    } = await this.db().query<DownloadRow>(
      "SELECT tenant_id,$3::uuid AS attempt_id,file_descriptor FROM learning_teacher_exact_file_submission($1,$2,$3) WHERE file_descriptor->>'id'=$4",
      [await this.educator(request), classroomId, attemptId, fileId.toLowerCase()],
    );
    return this.sendDownload(row, reply);
  }
}
