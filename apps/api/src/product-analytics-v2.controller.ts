import { Body, Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContext } from '@asa-lab/identity';
import {
  parseAnalyticsEnvelope,
  parseSiteActivityEnvelope,
  type ActorExpectation,
} from './analytics-envelope.js';
import {
  ProductAnalyticsService,
  observationMetadata,
  type AnalyticsActor,
} from './product-analytics.service.js';
import { AnalyticsDeliveryError } from './analytics-delivery-queue.js';
import { clientConnection } from './client-address.js';
import { type SeatContext, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { requestReceivedAt } from './request-receipt.js';
import { parseAcquisitionEnvelope } from './acquisition-envelope.js';

@Controller('api/analytics/v2')
export class ProductAnalyticsV2Controller {
  // Presence measurement is optional. At most one request can occupy the
  // optional analytics lane; product telemetry uses its existing lane.
  private siteActivityBusy = false;

  constructor(
    @Inject(TOKENS.productAnalytics) private readonly analytics: ProductAnalyticsService,
    @Inject(TOKENS.acquisitionAnalytics)
    private readonly acquisitionAnalytics: ProductAnalyticsService,
  ) {}

  private async actor(
    account: ActiveContext | null,
    student: SeatContext | null,
    expected: ActorExpectation,
  ): Promise<AnalyticsActor> {
    if (account && student) throw new HttpException({ error: { code: 'session_conflict' } }, 409);
    if (!account && !student) throw new HttpException({ error: { code: 'unauthorized' } }, 401);
    if (
      account &&
      expected.kind === 'account' &&
      account.accountId === expected.accountId &&
      account.workspaceId === expected.workspaceId
    )
      return { kind: 'account', context: account };
    if (
      student &&
      expected.kind === 'student' &&
      student.seatId === expected.seatId &&
      student.classroomId === expected.classId
    )
      return { kind: 'student', context: student };
    throw new HttpException({ error: { code: 'context_mismatch' } }, 409);
  }
  private async persist(
    request: FastifyRequest,
    raw: unknown,
    route: 'events' | 'module-session' | 'quality' | 'acquisition' | 'site-activity',
  ) {
    const receivedAt = requestReceivedAt(request);
    const site = route === 'site-activity' ? parseSiteActivityEnvelope(raw, receivedAt) : null;
    const envelope =
      route === 'site-activity'
        ? site!
        : route === 'acquisition'
          ? parseAcquisitionEnvelope(raw)
          : parseAnalyticsEnvelope(raw, route);
    if (site && this.siteActivityBusy)
      return {
        schemaVersion: 2,
        accepted: false,
        state: 'skipped',
        operation: 'site.activity',
        eventId: site.eventId,
        reason: 'capacity',
      };
    if (site) this.siteActivityBusy = true;
    try {
      const writer = site || route === 'acquisition' ? this.acquisitionAnalytics : this.analytics;
      return await writer.authenticatedRequest(
        request.cookies[SESSION_COOKIE],
        request.cookies[STUDENT_SESSION_COOKIE],
        async (account, student) => {
          const actor = await this.actor(account, student, envelope.actorExpectation);
          if (site)
            return writer.persistSiteActivity(site.eventId, actor, site.semantic, receivedAt);
          if (route === 'acquisition')
            return writer.persistAcquisition(
              envelope.eventId,
              actor,
              envelope.semantic,
              receivedAt,
            );
          return this.analytics.persistOperation(
            envelope.eventId,
            actor,
            'operation' in envelope ? envelope.operation : 'acquisition.observed',
            envelope.semantic,
            observationMetadata({
              ...clientConnection(request),
              userAgent: request.headers['user-agent'],
            }),
            receivedAt,
          );
        },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const sqlCode =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const code =
        error instanceof AnalyticsDeliveryError
          ? error.code
          : sqlCode === '23505'
            ? 'telemetry_conflict'
            : sqlCode === '42501'
              ? 'context_denied'
              : ['22023', '22P02', '22007', '22008'].includes(sqlCode)
                ? 'validation_error'
                : 'telemetry_unavailable';
      const status =
        code === 'telemetry_capacity'
          ? 429
          : code === 'telemetry_conflict'
            ? 409
            : code === 'context_denied'
              ? 403
              : code === 'validation_error'
                ? 400
                : 503;
      throw new HttpException({ error: { code } }, status);
    } finally {
      if (site) this.siteActivityBusy = false;
    }
  }
  @Post('events')
  @HttpCode(200)
  events(@Req() request: FastifyRequest, @Body() raw: unknown) {
    return this.persist(request, raw, 'events');
  }
  @Post('acquisition')
  @HttpCode(200)
  acquisition(@Req() request: FastifyRequest, @Body() raw: unknown) {
    return this.persist(request, raw, 'acquisition');
  }
  @Post('module-session')
  @HttpCode(200)
  moduleSession(@Req() request: FastifyRequest, @Body() raw: unknown) {
    return this.persist(request, raw, 'module-session');
  }
  @Post('quality')
  @HttpCode(200)
  quality(@Req() request: FastifyRequest, @Body() raw: unknown) {
    return this.persist(request, raw, 'quality');
  }
  @Post('site-activity')
  @HttpCode(200)
  siteActivity(@Req() request: FastifyRequest, @Body() raw: unknown) {
    return this.persist(request, raw, 'site-activity');
  }
}
