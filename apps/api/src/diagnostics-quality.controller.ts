import { Body, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { exact, invalid, object, qualitySemantic, uuid } from './analytics-envelope.js';
import { clientAddress } from './client-address.js';
import { FixedWindowRateLimiter } from './rate-limit.js';

/** Anonymous technical reports acknowledge intake only, not database persistence. */
@Controller('api/diagnostics/quality')
export class DiagnosticsQualityController {
  private readonly budget = new FixedWindowRateLimiter({
    limit: 600,
    windowMs: 60_000,
    maxKeys: 1024,
  });
  @Post()
  @HttpCode(202)
  report(@Req() request: FastifyRequest, @Body() raw: unknown) {
    const value = object(raw);
    exact(value, [
      'schemaVersion',
      'eventId',
      'pipeline',
      'streamId',
      'sequence',
      'streamStartedAt',
      'clientObservedAt',
      'acknowledgementStage',
      'counters',
      'gauges',
      'coverage',
    ]);
    if (value['schemaVersion'] !== 2 || value['pipeline'] !== 'client-diagnostics') invalid();
    const eventId = uuid(value['eventId']);
    const snapshot = qualitySemantic(value);
    if (!this.budget.consume(clientAddress(request)).allowed)
      throw new HttpException({ error: { code: 'too_many_requests' } }, 429);
    process.stdout.write(
      `${JSON.stringify({
        ...snapshot,
        eventId,
        schemaVersion: 2,
        kind: 'client_diagnostic_quality',
        level: 'info',
        time: new Date().toISOString(),
        untrustedClientReport: true,
        stage: 'intake_acknowledged',
      })}\n`,
    );
    return {
      accepted: true,
      state: 'intake_acknowledged',
      schemaVersion: 2,
      eventId,
      streamId: snapshot.streamId,
      sequence: snapshot.sequence,
      pipeline: 'client-diagnostics',
      acknowledgementStage: 'intake_acknowledged',
    };
  }
}
