import { Controller, Get, HttpException, Inject, Req, Res } from '@nestjs/common';
import type { ModuleRegistry, ModuleSummary } from '@asa-lab/module-sdk';
import { hashSessionToken } from '@asa-lab/identity';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { TOKENS } from './tokens.js';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { currentSeatGamesAccess, isOfflineGame } from './games-access.js';

@Controller('api/modules')
export class ModulesController {
  constructor(
    @Inject(TOKENS.moduleRegistry) private readonly registry: ModuleRegistry,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ items: readonly ModuleSummary[] }> {
    reply.header('cache-control', 'private, no-store');
    const items = this.registry.list();
    if (!Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE))
      return { items };
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    const seat = await this.seats.resolve(token);
    if (!seat || !token)
      throw new HttpException(
        { error: { code: 'unauthorized', message: 'no active student session' } },
        401,
      );
    const admission = await currentSeatGamesAccess(
      this.pool,
      seat,
      hashSessionToken(token),
      'chess',
    );
    return {
      items: items.map((module) =>
        isOfflineGame(module.moduleKey)
          ? { ...module, creatable: module.creatable && admission.granted }
          : module,
      ),
    };
  }
}
