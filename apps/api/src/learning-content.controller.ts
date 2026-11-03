import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: string, status = 409): never {
  throw new HttpException(
    { error: { code, message: 'Обновите материал и проверьте поля теста.' } },
    status,
  );
}
@Controller('api/learning')
export class LearningContentController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
  ) {}
  private async context(request: FastifyRequest) {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) fail('unauthorized', 401);
    if (!this.pool) fail('database_unavailable', 503);
    return context;
  }
  private kind(value: string) {
    if (value !== 'questions' && value !== 'quizzes') fail('not_found', 404);
    return value === 'questions' ? 'question' : 'quiz';
  }
  @Get(':contentKind(questions|quizzes)')
  async list(@Req() request: FastifyRequest, @Param('contentKind') kind: string) {
    return this.read(request, kind, null);
  }
  @Get(':contentKind(questions|quizzes)/:rootId')
  async detail(
    @Req() request: FastifyRequest,
    @Param('contentKind') kind: string,
    @Param('rootId') id: string,
  ) {
    if (!UUID.test(id)) fail('invalid_id', 400);
    return this.read(request, kind, id);
  }
  private async read(request: FastifyRequest, kind: string, id: string | null) {
    const context = await this.context(request);
    const result = await this.pool!.query(
      'SELECT learning_content_author_read($1,$2,$3,$4) AS content',
      [context.principalId, context.tenantId, this.kind(kind), id],
    );
    const value = result.rows[0]?.['content'];
    if (!value) fail('not_found', 404);
    return value;
  }
  @Get(':contentKind(questions|quizzes)/versions/:versionId')
  async version(
    @Req() request: FastifyRequest,
    @Param('contentKind') kind: string,
    @Param('versionId') id: string,
  ) {
    if (!UUID.test(id)) fail('invalid_id', 400);
    const context = await this.context(request);
    const result = await this.pool!.query(
      'SELECT learning_content_author_read($1,$2,$3,NULL,$4) AS content',
      [context.principalId, context.tenantId, this.kind(kind), id],
    );
    const value = result.rows[0]?.['content'];
    if (!value) fail('not_found', 404);
    return value;
  }
  @Post(':contentKind(questions|quizzes)')
  async create(
    @Req() request: FastifyRequest,
    @Param('contentKind') kind: string,
    @Body() body: unknown,
  ) {
    return this.write(request, kind, 'create', null, body);
  }
  @Put(':contentKind(questions|quizzes)/:rootId/draft')
  async save(
    @Req() request: FastifyRequest,
    @Param('contentKind') kind: string,
    @Param('rootId') id: string,
    @Body() body: unknown,
  ) {
    return this.write(request, kind, 'save', id, body);
  }
  @Post(':contentKind(questions|quizzes)/:rootId/publish')
  async publish(
    @Req() request: FastifyRequest,
    @Param('contentKind') kind: string,
    @Param('rootId') id: string,
    @Body() body: unknown,
  ) {
    return this.write(request, kind, 'publish', id, body);
  }
  private async write(
    request: FastifyRequest,
    kind: string,
    action: string,
    id: string | null,
    raw: unknown,
  ) {
    const shape = checkBodyShape(raw, [
      'requestId',
      'expectedRevision',
      'expectedHeadId',
      'payload',
    ]);
    if (!shape.ok) fail('invalid_request', 400);
    const body = shape.body;
    const req = body['requestId'],
      rev = body['expectedRevision'] ?? null,
      head = body['expectedHeadId'] ?? null,
      payload = body['payload'] ?? null;
    if (
      typeof req !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(req) ||
      (id !== null && !UUID.test(id)) ||
      (rev !== null &&
        (!Number.isSafeInteger(rev) || Number(rev) < 0 || Number(rev) > 2147483647)) ||
      (head !== null && (typeof head !== 'string' || !UUID.test(head))) ||
      (payload !== null && (typeof payload !== 'object' || Array.isArray(payload)))
    )
      fail('invalid_request', 400);
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      fail('invalid_request', 400);
    }
    if (Buffer.byteLength(serialized) > 262144) fail('invalid_request', 400);
    const context = await this.context(request);
    const result = await this.pool!.query(
      'SELECT learning_content_author_write($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) AS content',
      [
        context.principalId,
        context.tenantId,
        this.kind(kind),
        action,
        id,
        rev,
        req,
        serialized,
        head,
      ],
    );
    const value = result.rows[0]?.['content'] as Record<string, unknown> | undefined;
    if (!value || value['code'] !== 'ok')
      fail(
        String(value?.['code'] ?? 'content_failed'),
        value?.['code'] === 'not_found' ? 404 : 409,
      );
    return value;
  }
}
