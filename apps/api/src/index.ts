import { buildApp } from './app.js';

export { buildApp } from './app.js';
export type { HealthResponse } from './app.js';

const PORT = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
const HOST = process.env['API_HOST'] ?? '127.0.0.1';

/** Start the API server. Wired to a runnable entry point in a later task. */
export async function main(): Promise<void> {
  const app = buildApp();
  await app.listen({ port: PORT, host: HOST });
}
