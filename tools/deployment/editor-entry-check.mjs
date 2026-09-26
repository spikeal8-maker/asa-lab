import { pathToFileURL } from 'node:url';

export function assertEntryConfiguration(entry, runtime, parent, profile) {
  let url;
  try {
    url = new URL(entry);
  } catch {
    throw new Error('invalid ASA portal origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== entry ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (['production', 'staging'].includes(profile) &&
      url.hostname !== '127.0.0.1' &&
      url.protocol !== 'https:') ||
    runtime !== entry ||
    parent !== entry
  ) {
    throw new Error('ASA portal, Scratch parent and browser runtime origins must match exactly');
  }
}

export async function verifyEmbeddedEntryHttp(origin, revision, fetcher = fetch) {
  async function get(path) {
    const response = await fetcher(`${origin}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200 || response.url !== `${origin}${path}`) {
      throw new Error(`HTTP ${response.status} or redirect: ${path}`);
    }
    return response.text();
  }
  const ready = JSON.parse(await get('/health/ready'));
  const metadata = JSON.parse(await get('/build-metadata.json'));
  const script = (await get('/runtime-config.js')).trim();
  const editor = await get('/internal/blocks/');
  const health = await get('/internal/blocks/healthz');
  const prefix = 'globalThis.__ASA_RUNTIME_CONFIG__=';
  if (!script.startsWith(prefix)) throw new Error('runtime config format');
  const config = JSON.parse(script.slice(prefix.length).replace(/;$/, ''));
  if (
    ready.status !== 'ready' ||
    ready.deployment?.revision !== revision ||
    ready.deployment?.synchronized !== true ||
    metadata.revision !== revision ||
    config.blocksRuntimeOrigin !== origin ||
    !editor.includes('data-asa-scratch-host=') ||
    health.trim() !== 'ok'
  ) {
    throw new Error('revision, editor origin or embedded editor response mismatch');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , action, ...values] = process.argv;
  try {
    if (action === 'config') assertEntryConfiguration(...values);
    else if (action === 'http') {
      await verifyEmbeddedEntryHttp(...values);
      console.log(`EDITOR ENTRY HTTP OK: ${values[0]}/internal/blocks/ revision=${values[1]}`);
    } else throw new Error('expected config or http');
  } catch (error) {
    console.error(`EDITOR_ENTRY: ${error.message}`);
    process.exitCode = 1;
  }
}
