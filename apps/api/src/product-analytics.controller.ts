import { Body, Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { clientConnection } from './client-address.js';
import {
  ProductAnalyticsService,
  type AnalyticsActor,
  type AnalyticsModuleKey,
} from './product-analytics.service.js';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const MODULES = new Set<AnalyticsModuleKey>(['electronics', 'three-d', 'chess', 'checkers']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  private async actor(request: FastifyRequest): Promise<AnalyticsActor> {
    const [account, student] = await Promise.all([
      this.activeContext.resolve(request.cookies[SESSION_COOKIE]),
      this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]),
    ]);
    if (account) return { kind: 'account', context: account };
    if (student) return { kind: 'student', context: student };
    throw new HttpException(error('unauthorized', 'no active session'), 401);
  }

  @Post('module-opened')
  @HttpCode(202)
  async moduleOpened(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const shape = checkBodyShape(rawBody, ['moduleKey']);
    const moduleKey = shape.ok ? shape.body['moduleKey'] : null;
    if (typeof moduleKey !== 'string' || !MODULES.has(moduleKey as AnalyticsModuleKey)) {
      throw new HttpException(error('validation_error', 'unknown module key'), 400);
    }

    const actor = await this.actor(request);

    const connection = clientConnection(request);
    await this.analytics.record({
      actor,
      eventType: 'module.opened',
      outcome: 'succeeded',
      moduleKey: moduleKey as AnalyticsModuleKey,
      address: connection.address,
      networkKind: connection.networkKind,
      userAgentSummary: userAgentSummary(request.headers['user-agent']),
    });
    return { accepted: true as const };
  }

  @Post('module-session/start')
  @HttpCode(202)
  async startModuleSession(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const shape = checkBodyShape(rawBody, ['sessionId', 'projectId', 'moduleKey']);
    const sessionId = shape.ok ? shape.body['sessionId'] : null;
    const projectId = shape.ok ? shape.body['projectId'] : null;
    const moduleKey = shape.ok ? shape.body['moduleKey'] : null;
    if (
      typeof sessionId !== 'string' ||
      !UUID_PATTERN.test(sessionId) ||
      typeof projectId !== 'string' ||
      !UUID_PATTERN.test(projectId) ||
      typeof moduleKey !== 'string' ||
      !MODULES.has(moduleKey as AnalyticsModuleKey)
    ) {
      throw new HttpException(error('validation_error', 'invalid module session'), 400);
    }
    const actor = await this.actor(request);
    const connection = clientConnection(request);
    const accepted = await this.analytics.startModuleSession({
      sessionId,
      projectId,
      actor,
      moduleKey: moduleKey as AnalyticsModuleKey,
      address: connection.address,
      networkKind: connection.networkKind,
      userAgentSummary: userAgentSummary(request.headers['user-agent']),
    });
    return { accepted, sessionId };
  }

  @Post('module-session/touch')
  @HttpCode(202)
  async touchModuleSession(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const shape = checkBodyShape(rawBody, ['sessionId', 'closed']);
    const sessionId = shape.ok ? shape.body['sessionId'] : null;
    const closed = shape.ok ? shape.body['closed'] : null;
    if (
      typeof sessionId !== 'string' ||
      !UUID_PATTERN.test(sessionId) ||
      (closed !== undefined && typeof closed !== 'boolean')
    ) {
      throw new HttpException(error('validation_error', 'invalid module session heartbeat'), 400);
    }
    const accepted = await this.analytics.touchModuleSession({
      sessionId,
      actor: await this.actor(request),
      closed: closed === true,
    });
    return { accepted };
  }
}
