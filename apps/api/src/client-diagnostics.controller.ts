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
]);
const MODULES = new Set(['portal', 'scratch', 'electronics', 'auth']);

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
      Object.keys(value).some((key) => !['code', 'module', 'revision'].includes(key)) ||
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
    if (budget.count >= 120 || (!this.budgets.has(key) && this.budgets.size >= 1024)) {
      throw new HttpException({ error: { code: 'too_many_requests' } }, 429);
    }
    budget.count += 1;
    this.budgets.set(key, budget);
    process.stdout.write(
      `${JSON.stringify({ time: new Date(time).toISOString(), kind: 'client_diagnostic', code: value['code'], module: value['module'], revision: value['revision'], requestId: request.id, untrustedClientReport: true })}\n`,
    );
    return { accepted: true };
  }
}
