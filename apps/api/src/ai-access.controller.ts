import { Body, Controller, Get, HttpException, Inject, Param, Put, Req } from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import {
  AiAccessService,
  aiAccessId,
  aiRequestActor,
  requireAiSameOrigin,
} from './ai-access.service.js';
import { AiServiceError } from './ai-chat.service.js';
import type { SeatContextUseCase } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

@Controller('api/ai')
export class AiAccessController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.aiAccessService) private readonly access: AiAccessService,
  ) {}

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (problem) {
      if (problem instanceof AiServiceError) {
        throw new HttpException(
          { error: { code: problem.code, message: problem.message } },
          problem.status,
        );
      }
      throw problem;
    }
  }

  private async teacher(request: FastifyRequest): Promise<string> {
    const account = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!account?.accountId) {
      throw new AiServiceError('ai_account_required', 401, 'Войдите в аккаунт преподавателя.');
    }
    return account.principalId;
  }

  @Get('scopes')
  scopes(@Req() request: FastifyRequest) {
    return this.safe(async () =>
      this.access.scopes(await aiRequestActor(request, this.accounts, this.seats)),
    );
  }

  @Get('classrooms/:classroomId/access')
  classroom(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    return this.safe(async () =>
      this.access.classroom(await this.teacher(request), aiAccessId(classroomId)),
    );
  }

  @Put('classrooms/:classroomId/access')
  save(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() input: unknown,
  ) {
    return this.safe(async () => {
      requireAiSameOrigin(request);
      return this.access.saveClassroom(await this.teacher(request), aiAccessId(classroomId), input);
    });
  }
}
