import { Body, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const CODES = new Set([
  'render_failed',
  'window_error',
  'unhandled_rejection',
  'editor_start_failed',
  'editor_start_timeout',
  'editor_runtime_error',
  'simulation_failed',
  'autosave_failed',
  'session_refresh_failed',
  'request_failed',
  'request_slow',
  'editor_ready',
  'editor_heartbeat',
  'editor_unresponsive',
  'editor_recovered',
]);
const MODULES = new Set(['portal', 'scratch', 'electronics', 'auth']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

@Controller('api/diagnostics/client')
export class ClientDiagnosticsController {
  private readonly budgets = new Map<string, { until: number; count: number }>();

  @Post()
  @HttpCode(202)
  report(@Req() request: FastifyRequest, @Body() body: unknown) {
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      throw new HttpException({ error: { code: 'validation_error' } }, 400);
    const value = body as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) =>
          ![
            'code',
            'module',
            'revision',
            'instanceId',
            'relatedRequestId',
            'httpStatus',
            'durationMs',
            'phase',
          ].includes(key),
      ) ||
      ['instanceId', 'relatedRequestId'].some(
        (key) =>
          value[key] !== undefined &&
          (typeof value[key] !== 'string' || !UUID.test(value[key] as string)),
      ) ||
      (value['httpStatus'] !== undefined &&
        (!Number.isInteger(value['httpStatus']) ||
          (value['httpStatus'] as number) < 100 ||
          (value['httpStatus'] as number) > 599)) ||
      (value['durationMs'] !== undefined &&
        (!Number.isInteger(value['durationMs']) ||
          (value['durationMs'] as number) < 0 ||
          (value['durationMs'] as number) > 600_000)) ||
      (value['phase'] !== undefined &&
        !['startup', 'runtime', 'request', 'refresh', 'save', 'simulation'].includes(
          value['phase'] as string,
        )) ||
      typeof value['code'] !== 'string' ||
      !CODES.has(value['code']) ||
      typeof value['module'] !== 'string' ||
      !MODULES.has(value['module']) ||
      typeof value['revision'] !== 'string' ||
      !/^(?:[a-f0-9]{7,64}|unknown|development)$/.test(value['revision'])
    ) {
      throw new HttpException({ error: { code: 'validation_error' } }, 400);
    }
    const time = Date.now();
    for (const [key, budget] of this.budgets) if (budget.until < time) this.budgets.delete(key);
    const key = request.ip;
    const budget = this.budgets.get(key) ?? { until: time + 60_000, count: 0 };
    if (budget.count >= 600 || (!this.budgets.has(key) && this.budgets.size >= 1024)) {
      throw new HttpException({ error: { code: 'too_many_requests' } }, 429);
    }
    budget.count += 1;
    this.budgets.set(key, budget);
    const level = ['editor_ready', 'editor_heartbeat', 'editor_recovered'].includes(
      value['code'] as string,
    )
      ? 'info'
      : ['editor_unresponsive', 'request_slow'].includes(value['code'] as string)
        ? 'warn'
        : 'error';
    process.stdout.write(
      `${JSON.stringify({ ...value, time: new Date(time).toISOString(), kind: 'client_diagnostic', level, requestId: request.id, untrustedClientReport: true })}\n`,
    );
    return { accepted: true };
  }
}
