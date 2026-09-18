import { fetchWithSessionRefresh } from '../session-fetch';

export type BlocksRuntimeAssetFormat = 'svg' | 'png' | 'jpg' | 'wav' | 'mp3';

export interface BlocksRuntimeAsset {
  readonly assetId: string;
  readonly dataFormat: BlocksRuntimeAssetFormat;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface BlocksRuntimeSession {
  readonly runtimeOrigin: string;
  readonly runtimeToken: string;
  readonly expiresAt: number;
  readonly draftRevision: number;
  readonly projectJson: Record<string, unknown> | null;
  readonly assets: readonly BlocksRuntimeAsset[];
}

const SESSION_KEYS = new Set([
  'runtimeOrigin',
  'runtimeToken',
  'expiresAt',
  'draftRevision',
  'projectJson',
  'assets',
]);

const ASSET_KEYS = new Set(['assetId', 'dataFormat', 'sha256', 'sizeBytes']);
const ASSET_FORMATS = new Set<BlocksRuntimeAssetFormat>(['svg', 'png', 'jpg', 'wav', 'mp3']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return (
    Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key))
  );
}

function isExactHttpOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isProjectJson(value: unknown): value is Record<string, unknown> | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return ['targets', 'monitors', 'extensions'].every((field) => Array.isArray(value[field]));
}

function isAsset(value: unknown): value is BlocksRuntimeAsset {
  if (!isRecord(value) || !hasExactKeys(value, ASSET_KEYS)) return false;
  return (
    typeof value.assetId === 'string' &&
    /^[a-f0-9]{32}$/.test(value.assetId) &&
    typeof value.dataFormat === 'string' &&
    ASSET_FORMATS.has(value.dataFormat as BlocksRuntimeAssetFormat) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.sizeBytes === 'number' &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes >= 1
  );
}

export function parseBlocksRuntimeSession(
  value: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): BlocksRuntimeSession | null {
  if (!isRecord(value) || !hasExactKeys(value, SESSION_KEYS)) return null;
  if (!isExactHttpOrigin(value.runtimeOrigin)) return null;
  if (
    typeof value.runtimeToken !== 'string' ||
    value.runtimeToken.length < 1 ||
    value.runtimeToken.length > 4096
  )
    return null;
  if (
    typeof value.expiresAt !== 'number' ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= nowSeconds
  )
    return null;

  if (
    typeof value.draftRevision !== 'number' ||
    !Number.isSafeInteger(value.draftRevision) ||
    value.draftRevision < 0
  )
    return null;
  if (!isProjectJson(value.projectJson)) return null;
  if (!Array.isArray(value.assets) || !value.assets.every(isAsset)) return null;

  return Object.freeze({
    runtimeOrigin: value.runtimeOrigin,
    runtimeToken: value.runtimeToken,
    expiresAt: value.expiresAt,
    draftRevision: value.draftRevision,
    projectJson: value.projectJson,
    assets: Object.freeze([...value.assets]),
  });
}

export async function requestBlocksRuntimeSession(
  projectId: string,
  signal: AbortSignal,
): Promise<BlocksRuntimeSession | null> {
  let response: Response;
  try {
    response = await fetchWithSessionRefresh(
      `/api/projects/${encodeURIComponent(projectId)}/blocks/runtime-session`,
      {
        method: 'POST',
        signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{}',
      },
    );
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  return parseBlocksRuntimeSession(payload);
}
