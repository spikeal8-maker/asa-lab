import { emitApplicationLog } from './application-log-store.js';
import { Body, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { exact, invalid, object, qualitySemantic, uuid } from './analytics-envelope.js';
import { clientAddress } from './client-address.js';
import { FixedWindowRateLimiter } from './rate-limit.js';

/** Anonymous technical reports acknowledge intake only, not database persistence. */
@Controller('api/diagnostics/quality')
export class DiagnosticsQualityController {
  // A school NAT aggregates many legitimate browser sessions behind one IP.
  // An IP-wide cap alone incorrectly rejects their cumulative diagnostics
  // (observed with 30 concurrent Chrome contexts). Preserve a strict cap
  // per validated stream AND a bounded global cap per source address:
  // changing/spoofing stream IDs cannot bypass the IP-wide ceiling.
  private readonly budget = new FixedWindowRateLimiter({
    limit: 1_800,
    windowMs: 60_000,
    maxKeys: 1024,
  });
  private readonly streamBudget = new FixedWindowRateLimiter({
    limit: 60,
    windowMs: 60_000,
    maxKeys: 2048,
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
    const address = clientAddress(request);
    // Consume a stream's own quota first so a noisy tab does not exhaust the
    // allowance shared by its classmates. Stream IDs are untrusted UUIDs,
    // hence the independent per-IP limit remains mandatory.
    if (
      !this.streamBudget.consume(address + '\\0' + snapshot.streamId).allowed ||
      !this.budget.consume(address).allowed
    )
      throw new HttpException({ error: { code: 'too_many_requests' } }, 429);
    emitApplicationLog(
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
