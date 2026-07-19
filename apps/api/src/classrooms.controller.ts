import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionContext, SessionUseCase } from '@asa-lab/identity';
import type { GetTeachingContextUseCase } from '@asa-lab/organization';
import type { Classroom, CreateClassroomUseCase, ListClassroomsUseCase } from '@asa-lab/classroom';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape, checkIdempotencyKey, isPlainObject } from './validation.js';

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

@Controller('api/classrooms')
export class ClassroomsController {
  constructor(
    @Inject(TOKENS.sessionUseCase) private readonly sessionUseCase: SessionUseCase,
    @Inject(TOKENS.teachingContextUseCase)
    private readonly teachingContext: GetTeachingContextUseCase,
    @Inject(TOKENS.createClassroomUseCase) private readonly createUseCase: CreateClassroomUseCase,
    @Inject(TOKENS.listClassroomsUseCase) private readonly listUseCase: ListClassroomsUseCase,
  ) {}

  private async requireContext(request: FastifyRequest): Promise<SessionContext> {
    const context = await this.sessionUseCase.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return context;
  }

  @Get()
  async list(
    @Req() request: FastifyRequest,
  ): Promise<{ items: Classroom[]; meta: { total: number } }> {
    const context = await this.requireContext(request);
    const items = await this.listUseCase.execute(context.tenantId, context.userId);
    return { items, meta: { total: items.length } };
  }

  @Post()
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
  ): Promise<{ classroom: Classroom; created: boolean }> {
    const context = await this.requireContext(request);
    // The tenant context comes exclusively from the session: any
    // client-supplied tenant identifier is rejected before shape checking so
    // the error is explicit.
    if (isPlainObject(rawBody) && ('tenant_id' in rawBody || 'tenantId' in rawBody)) {
      throw new HttpException(
        error('validation_error', 'tenant is derived from the session and must not be sent'),
        400,
      );
    }
    const shape = checkBodyShape(rawBody, ['title']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const keyCheck = checkIdempotencyKey(idempotencyHeader);
    if (!keyCheck.ok) {
      throw new HttpException(error('invalid_idempotency_key', keyCheck.message), 400);
    }
    const teaching = await this.teachingContext.execute(context.tenantId, context.schoolId);
    if (!teaching.ok) {
      const message =
        teaching.code === 'no_school_assigned'
          ? 'the teacher has no school assigned'
          : 'no active academic period for the teacher school';
      throw new HttpException(error(teaching.code, message), 409);
    }
    const result = await this.createUseCase.execute({
      tenantId: context.tenantId,
      schoolId: teaching.context.schoolId,
      academicPeriodId: teaching.context.academicPeriodId,
      teacherId: context.userId,
      title: shape.body['title'],
      idempotencyKey: keyCheck.key,
    });
    if (!result.ok) {
      if (result.code === 'idempotency_conflict') {
        throw new HttpException(error(result.code, result.message), 409);
      }
      throw new HttpException(error(result.code, result.message), 400);
    }
    reply.code(result.created ? 201 : 200);
    return { classroom: result.classroom, created: result.created };
  }
}
