import { Body, Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { clientAddress } from './client-address.js';
import { ProductAnalyticsService, type AnalyticsModuleKey } from './product-analytics.service.js';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const MODULES = new Set<AnalyticsModuleKey>(['electronics', 'three-d', 'chess', 'checkers']);

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function userAgentSummary(value: string | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 128);
}

@Controller('api/analytics/v1')
export class ProductAnalyticsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
    @Inject(TOKENS.productAnalytics) private readonly analytics: ProductAnalyticsService,
  ) {}

  @Post('module-opened')
  @HttpCode(202)
  async moduleOpened(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const shape = checkBodyShape(rawBody, ['moduleKey']);
    const moduleKey = shape.ok ? shape.body['moduleKey'] : null;
    if (typeof moduleKey !== 'string' || !MODULES.has(moduleKey as AnalyticsModuleKey)) {
      throw new HttpException(error('validation_error', 'unknown module key'), 400);
    }

    const [account, student] = await Promise.all([
      this.activeContext.resolve(request.cookies[SESSION_COOKIE]),
      this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]),
    ]);
    const actor = account
      ? ({ kind: 'account', context: account } as const)
      : student
        ? ({ kind: 'student', context: student } as const)
        : null;
    if (!actor) throw new HttpException(error('unauthorized', 'no active session'), 401);

    await this.analytics.record({
      actor,
      eventType: 'module.opened',
      outcome: 'succeeded',
      moduleKey: moduleKey as AnalyticsModuleKey,
      address: clientAddress(request),
      userAgentSummary: userAgentSummary(request.headers['user-agent']),
    });
    return { accepted: true as const };
  }
}
