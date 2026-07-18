import { buildApp } from './app.js';

export { buildApp, evaluateReadiness } from './app.js';
export type { LiveResponse, ReadyResponse, DependencyState } from './app.js';

const PORT = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
const HOST = process.env['API_HOST'] ?? '127.0.0.1';

/** Start the API server and return the running instance. */
export async function main(): Promise<ReturnType<typeof buildApp>> {
  const app = buildApp();
  await app.listen({ port: PORT, host: HOST });
  return app;
}
