import type pg from 'pg';
import { createApiApp } from '../../apps/api/dist/app.factory.js';

export type NestApp = Awaited<ReturnType<typeof createApiApp>>;

export async function buildTestApp(pool: pg.Pool): Promise<NestApp> {
  return createApiApp({ pool, webDist: null });
}

export function fastifyOf(app: NestApp) {
  return app.getHttpAdapter().getInstance();
}
