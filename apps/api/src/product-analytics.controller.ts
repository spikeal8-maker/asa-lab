import { Body, Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContext } from '@asa-lab/identity';
import { clientConnection } from './client-address.js';
import {
  ProductAnalyticsService,
  type AnalyticsActor,
  type AnalyticsModuleKey,
} from './product-analytics.service.js';
import { type SeatContext, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import { AnalyticsDeliveryError } from './analytics-delivery-queue.js';
import { environmentSummary } from './client-environment.js';

const MODULES = new Set<AnalyticsModuleKey>([
  'electronics',
  'three-d',
  'chess',
  'checkers',
  'blocks',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function userAgentSummary(value: string | undefined): string | null {
  if (!value) return null;
  return environmentSummary(value);
}

@Controller('api/analytics/v1')
export class ProductAnalyticsController {
  constructor(
    @Inject(TOKENS.productAnalytics) private readonly analytics: ProductAnalyticsService,
  ) {}

  private async actor(
    account: ActiveContext | null,
    student: SeatContext | null,
  ): Promise<AnalyticsActor> {
    if (account && student) {
      throw new HttpException(error('session_conflict', 'multiple active identities'), 409);
    }
    if (account) return { kind: 'account', context: account };
    if (student) return { kind: 'student', context: student };
    throw new HttpException(error('unauthorized', 'no active session'), 401);
  }

  private async authenticated<T>(
    request: FastifyRequest,
    run: (actor: AnalyticsActor) => Promise<T>,
    onContextDenied?: () => T,
  ): Promise<T> {
    try {
      return await this.analytics.authenticatedRequest(
        request.cookies[SESSION_COOKIE],
        request.cookies[STUDENT_SESSION_COOKIE],
        async (account, student) => run(await this.actor(account, student)),
      );
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      // The legacy start endpoint promises a non-acceptance result for a
      // refused project/session context. Handle it after the queued operation
      // has rejected, never as an apparently persisted SQL write.
      if (
        cause instanceof AnalyticsDeliveryError &&
        cause.code === 'context_denied' &&
        onContextDenied
      )
        return onContextDenied();
      const code = cause instanceof AnalyticsDeliveryError ? cause.code : 'telemetry_unavailable';
      throw new HttpException(
        error(code, 'telemetry delivery unavailable'),
        code === 'telemetry_capacity' ? 429 : 503,
      );
    }
  }

  @Post('module-opened')
  @HttpCode(202)
  async moduleOpened(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const shape = checkBodyShape(rawBody, ['moduleKey']);
    const moduleKey = shape.ok ? shape.body['moduleKey'] : null;
    if (typeof moduleKey !== 'string' || !MODULES.has(moduleKey as AnalyticsModuleKey)) {
      throw new HttpException(error('validation_error', 'unknown module key'), 400);
    }

    const connection = clientConnection(request);
    return this.authenticated(request, async (actor) => {
      const accepted = await this.analytics.record({
        actor,
        eventType: 'module.opened',
        outcome: 'succeeded',
        moduleKey: moduleKey as AnalyticsModuleKey,
        address: connection.address,
        networkKind: connection.networkKind,
        userAgentSummary: userAgentSummary(request.headers['user-agent']),
      });
      return { accepted };
    });
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
    const connection = clientConnection(request);
    return this.authenticated(
      request,
      async (actor) => {
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
      },
      () => ({ accepted: false, sessionId }),
    );
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
    return this.authenticated(request, async (actor) => {
      const accepted = await this.analytics.touchModuleSession({
        sessionId,
        actor,
        closed: closed === true,
      });
      return { accepted };
    });
  }
}
