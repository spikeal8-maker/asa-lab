/**
 * Read-only public authentication readiness check for the ASA Lab test installation.
 * No session, bot token, authentication cookie or POST operation is used.
 *
 * Run: node tools/auth-staging-readiness.mjs
 * Run: node tools/auth-staging-readiness.mjs --expect-ready
 * Run: node tools/auth-staging-readiness.mjs --expect-live-proof
 */
import { fileURLToPath } from 'node:url';

export const DEFAULT_ORIGIN = 'https://test.asa-lab.ru';
const MAX_BODY_BYTES = 128 * 1024;
const READ_TIMEOUT_MS = 12_000;
const PROVIDER_IDS = ['max', 'telegram', 'email'];
const REASONS = new Set([
  'ready', 'disabled', 'not_configured', 'invalid_token',
  'delivery_unavailable', 'unavailable', 'delivery_unverified',
]);

export function safeOrigin(input = DEFAULT_ORIGIN) {
  if (typeof input !== 'string') throw new Error('invalid_origin');
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('invalid_origin');
  }
  const isStage = url.protocol === 'https:' && url.hostname === 'test.asa-lab.ru' && !url.port;
  const isLocal = url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if ((!isStage && !isLocal) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('origin_not_allowed');
  }
  return url.origin;
}

function safeReason(input) {
  return typeof input === 'string' && REASONS.has(input) ? input : 'unrecognized';
}

function safeProvider(entry, id) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { id, status: 'missing' };
  }
  return {
    id,
    status: 'reported',
    available: entry.available === true,
    reason: safeReason(entry.reason),
    enforcementEligible: entry.enforcementEligible === true,
    enforcementReason: safeReason(entry.enforcementReason),
  };
}

/** This check intentionally never returns response bodies or external fetch errors. */
async function readStatus(fetchImpl, url, accept, now, expectJson = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      headers: { accept, 'cache-control': 'no-cache' },
      signal: controller.signal,
    });
    if (!response || typeof response.status !== 'number') {
      return { status: 'invalid_response', httpStatus: null };
    }
    if (!response.ok) {
      return { status: 'http_error', httpStatus: response.status };
    }
    if (!expectJson) return { status: 'ok', httpStatus: response.status };
    let body;
    try {
      body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        return { status: 'body_too_large', httpStatus: response.status };
      }
      return { status: 'ok', httpStatus: response.status, json: JSON.parse(body) };
    } catch {
      return { status: 'invalid_json', httpStatus: response.status };
    }
  } catch {
    return { status: 'network_error', httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeStaging({
  origin = DEFAULT_ORIGIN,
  fetchImpl = fetch,
  clock = () => new Date(),
  expectReady = false,
  expectLiveProof = false,
} = {}) {
  const base = safeOrigin(origin);
  const [web, api] = await Promise.all([
    readStatus(fetchImpl, base + '/', 'text/html', clock),
    readStatus(fetchImpl, base + '/api/auth/providers', 'application/json', clock, true),
  ]);

  let providers = PROVIDER_IDS.map((id) => ({ id, status: 'unknown' }));
  let providerSchema = 'not_checked';
  if (api.status === 'ok') {
    const list = api.json?.providers;
    if (Array.isArray(list) && list.length <= 32 &&
        list.every((item) => item && typeof item === 'object' && typeof item.id === 'string')) {
      providers = PROVIDER_IDS.map((id) =>
        safeProvider(list.find((item) => item.id === id), id));
      providerSchema = 'valid';
    } else {
      providerSchema = 'invalid';
    }
  }
  const ready = providers.filter((p) => ['max', 'telegram'].includes(p.id))
    .every((p) => p.status === 'reported' && p.available && p.reason === 'ready');
  const liveProof = providers.filter((p) => ['max', 'telegram'].includes(p.id))
    .every((p) => p.status === 'reported' && p.enforcementEligible &&
      p.enforcementReason === 'ready');
  const reachable = web.status === 'ok' && api.status === 'ok' && providerSchema === 'valid';
  const pass = reachable && (!expectReady || ready) && (!expectLiveProof || liveProof);
  return {
    report: {
      schema: 'asa-auth-staging-readiness-v1',
      checkedAt: clock().toISOString(),
      origin: base,
      mode: { expectReady: !!expectReady, expectLiveProof: !!expectLiveProof },
      web: { status: web.status, httpStatus: web.httpStatus },
      api: { status: api.status, httpStatus: api.httpStatus, providerSchema },
      providers,
      assessment: {
        endpointReachable: reachable,
        providersReady: ready,
        liveConfirmationRecorded: liveProof,
        pass,
      },
    },
    exitCode: pass ? 0 : 2,
  };
}

export function parseArgs(argv) {
  let origin = DEFAULT_ORIGIN;
  let expectReady = false;
  let expectLiveProof = false;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--origin' && argv[i + 1]) origin = argv[++i];
    else if (arg === '--expect-ready') expectReady = true;
    else if (arg === '--expect-live-proof') expectLiveProof = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else throw new Error('invalid_argument');
  }
  return { origin: safeOrigin(origin), expectReady, expectLiveProof, help };
}

async function cli() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'invalid_arguments', code: error.message }));
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log('Usage: node tools/auth-staging-readiness.mjs [--origin https://test.asa-lab.ru] [--expect-ready] [--expect-live-proof]');
    return;
  }
  const result = await probeStaging(options);
  console.log(JSON.stringify(result.report, null, 2));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await cli();
}
