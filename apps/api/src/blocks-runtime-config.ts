import {
  isAllowedMutationOrigin,
  resolveAdditionalWebOrigins,
  resolveCanonicalWebOrigin,
  resolveLocalApiOrigin,
  resolveWebOriginPatterns,
  resolveIsolatedTestWebOrigin,
} from './origin-policy.js';

export interface BlocksRuntimeServerConfig {
  readonly runtimeOrigin: string;
  readonly signingKey: Uint8Array;
}

export class BlocksRuntimeEntryOriginError extends Error {}

/** Bind each capability to its validated entry, not the installation's old primary address. */
export function readBlocksRuntimeEntryConfig(
  env: NodeJS.ProcessEnv,
  origin: string | undefined,
): BlocksRuntimeServerConfig {
  const mode = env['ASA_BLOCKS_SAME_ORIGIN'];
  if (mode !== undefined && mode !== 'true' && mode !== 'false') {
    throw new Error('ASA_BLOCKS_SAME_ORIGIN must be true or false.');
  }
  if (mode !== 'true') return readBlocksRuntimeServerConfig(env);
  const isolated = resolveIsolatedTestWebOrigin(
    env['ASA_ISOLATED_TEST_WEB_ORIGIN'],
    env['NODE_ENV'],
    env['APP_DATABASE_URL'],
  );
  let requestHost: string | undefined;
  try {
    requestHost = origin ? new URL(origin).host : undefined;
  } catch {
    /* fail closed below */
  }
  if (
    !origin ||
    !isAllowedMutationOrigin({
      origin,
      allowedWebOrigin: resolveCanonicalWebOrigin(env['ASA_WEB_PORT']),
      allowedLocalApiOrigin: resolveLocalApiOrigin(env['API_PORT']),
      additionalAllowedOrigins: [
        ...resolveAdditionalWebOrigins(env['ASA_PUBLIC_WEB_ORIGINS']),
        ...(isolated ? [isolated] : []),
      ],
      allowedOriginPatterns: resolveWebOriginPatterns(env['ASA_PUBLIC_WEB_ORIGIN_PATTERNS']),
      // This validates configuration membership only. Browser issuance is also
      // guarded by the mutation hook's actual request Host and authenticated actor.
      requestHost,
    })
  )
    throw new BlocksRuntimeEntryOriginError('Blocks runtime entry origin is not allowed.');
  return readBlocksRuntimeServerConfig({ ...env, ASA_BLOCKS_RUNTIME_ORIGIN: origin });
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Blocks runtime.`);
  return value;
}

export function readBlocksRuntimeServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): BlocksRuntimeServerConfig {
  const rawOrigin = required(env, 'ASA_BLOCKS_RUNTIME_ORIGIN');
  const rawKey = env['ASA_BLOCKS_RUNTIME_SIGNING_KEY'];
  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    throw new Error('ASA_BLOCKS_RUNTIME_SIGNING_KEY is required for Blocks runtime.');
  }
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error('ASA_BLOCKS_RUNTIME_ORIGIN must be an exact http(s) origin.');
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== rawOrigin ||
    origin.username ||
    origin.password
  ) {
    throw new Error('ASA_BLOCKS_RUNTIME_ORIGIN must be an exact http(s) origin.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error('ASA_BLOCKS_RUNTIME_SIGNING_KEY must be exactly 32 bytes encoded as hex.');
  }
  return Object.freeze({
    runtimeOrigin: origin.origin,
    signingKey: Uint8Array.from(Buffer.from(rawKey, 'hex')),
  });
}
