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
    @Body() body: Record<string, unknown> | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<{ classroom: Classroom; created: boolean }> {
    const context = await this.requireContext(request);
    // The tenant context comes from the session only; any client-supplied
    // tenant identifier is rejected outright.
    if (body && ('tenant_id' in body || 'tenantId' in body)) {
      throw new HttpException(
        error('validation_error', 'tenant is derived from the session and must not be sent'),
        400,
      );
    }
    const teaching = await this.teachingContext.execute(context.tenantId, context.schoolId);
    if (!teaching) {
      throw new HttpException(error('no_active_period', 'no active academic period'), 409);
    }
    const key =
      typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
        ? idempotencyKey.trim().slice(0, 128)
        : null;
    const result = await this.createUseCase.execute({
      tenantId: context.tenantId,
      schoolId: teaching.schoolId,
      academicPeriodId: teaching.academicPeriodId,
      teacherId: context.userId,
      title: body?.['title'],
      idempotencyKey: key,
    });
    if (!result.ok) {
      throw new HttpException(error(result.code, result.message), 400);
    }
    reply.code(result.created ? 201 : 200);
    return { classroom: result.classroom, created: result.created };
  }
}
