export interface BlocksRuntimeServerConfig {
  readonly runtimeOrigin: string;
  readonly signingKey: Uint8Array;
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
