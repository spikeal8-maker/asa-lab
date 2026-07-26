import type pg from 'pg';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { createApiApp } from '../../apps/api/dist/app.factory.js';

export type NestApp = Awaited<ReturnType<typeof createApiApp>>;

/** The allowed dev web origin (state-changing requests are fail-closed and
 * must carry an explicitly allowed Origin header). */
export const WEB_ORIGIN = 'http://127.0.0.1:4610';

export async function buildTestApp(pool: pg.Pool): Promise<NestApp> {
  return createApiApp({ pool, webDist: null });
}

export function fastifyOf(app: NestApp) {
  return app.getHttpAdapter().getInstance();
}

/** inject() with the allowed web Origin attached (like a real browser). */
export function inject(app: NestApp, options: InjectOptions): Promise<LightMyRequestResponse> {
  const headers = { origin: WEB_ORIGIN, ...(options.headers ?? {}) };
  return fastifyOf(app).inject({ ...options, headers });
}
