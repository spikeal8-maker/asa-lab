import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, type SeatContext, SeatContextUseCase } from './seat-context.js';
import { checkBodyShape } from './validation.js';
import type {
  BlocksRuntimeParentActor,
  BlocksRuntimeSessionResult,
} from './blocks-runtime-session.js';
import type { BlocksRuntimeSessionIssuerPort } from './blocks-runtime-session-issuer.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code: string, message: string) {
  return { error: { code, message } };
}
@Controller('api/projects')
export class BlocksRuntimeSessionController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
    @Inject(TOKENS.blocksRuntimeSessionIssuer)
    private readonly issuer: BlocksRuntimeSessionIssuerPort,
  ) {}

  private async actor(request: FastifyRequest): Promise<BlocksRuntimeParentActor> {
    const account = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (account) {
      return {
        tenantId: account.tenantId,
        principalId: account.principalId,
        userId: account.userId,
      };
    }
    const seat: SeatContext | null = await this.seatContext.resolve(
      request.cookies[STUDENT_SESSION_COOKIE],
    );
    if (seat) {
      return { tenantId: seat.tenantId, principalId: seat.principalId, userId: null };
    }
    throw new HttpException(error('unauthorized', 'no active session'), 401);
  }
  @Post(':projectId/blocks/runtime-session')
  @HttpCode(200)
  async issueEditor(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    if (!UUID.test(projectId)) {
      throw new HttpException(error('validation_error', 'projectId must be a UUID'), 400);
    }
    const shape = checkBodyShape(rawBody ?? {}, []);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result: BlocksRuntimeSessionResult = await this.issuer.issueEditor(
      await this.actor(request),
      projectId,
    );
    if (!result.ok) {
      const status =
        result.code === 'project_unavailable' ? 404 : result.code === 'project_invalid' ? 409 : 503;
      throw new HttpException(error(result.code, 'Blocks runtime session is unavailable.'), status);
    }
    reply.header('Cache-Control', 'no-store');
    return result.value;
  }
}
