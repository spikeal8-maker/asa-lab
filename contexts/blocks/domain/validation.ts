import type { ModuleDiagnostic, ModuleValidationResult } from '@asa-lab/module-sdk';
import type { BlocksAssetFormat, BlocksProjectDocumentV1 } from './document.js';

const ASSET_KEYS = new Set(['assetId', 'dataFormat', 'sha256', 'sizeBytes']);
const ASSET_FORMATS = new Set<BlocksAssetFormat>(['svg', 'png', 'jpg', 'wav', 'mp3']);

function diagnostic(code: string, message: string): ModuleDiagnostic {
  return { code, severity: 'error', message };
}

function invalid(code: string, message: string): ModuleValidationResult<BlocksProjectDocumentV1> {
  return { ok: false, diagnostics: [diagnostic(code, message)] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateProjectJson(value: unknown): ModuleDiagnostic | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    return diagnostic('blocks.project_json.type', 'Scratch projectJson must be an object or null.');
  }
  for (const field of ['targets', 'monitors', 'extensions'] as const) {
    if (!Array.isArray(value[field])) {
      return diagnostic(
        `blocks.project_json.${field}`,
        `Scratch projectJson.${field} must be an array.`,
      );
    }
  }
  return null;
}

function validateAsset(value: unknown, index: number): ModuleDiagnostic | null {
  if (!isRecord(value)) {
    return diagnostic('blocks.asset.type', `Scratch asset ${index} must be an object.`);
  }

  for (const forbidden of ['data', 'base64', 'bytes', 'dataUrl'] as const) {
    if (forbidden in value) {
      return diagnostic(
        'blocks.asset.inline_binary',
        `Scratch asset ${index} must reference durable storage; inline ${forbidden} is forbidden.`,
      );
    }
  }

  for (const key of Object.keys(value)) {
    if (!ASSET_KEYS.has(key)) {
      return diagnostic(
        'blocks.asset.unknown_field',
        `Scratch asset ${index} contains unsupported field ${key}.`,
      );
    }
  }

  if (typeof value.assetId !== 'string' || !/^[a-f0-9]{32}$/.test(value.assetId)) {
    return diagnostic(
      'blocks.asset.asset_id',
      `Scratch asset ${index} must use a lowercase 32-hex assetId.`,
    );
  }
  if (
    typeof value.dataFormat !== 'string' ||
    !ASSET_FORMATS.has(value.dataFormat as BlocksAssetFormat)
  ) {
    return diagnostic(
      'blocks.asset.data_format',
      `Scratch asset ${index} must use one of svg, png, jpg, wav, mp3.`,
    );
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    return diagnostic(
      'blocks.asset.sha256',
      `Scratch asset ${index} has an invalid sha256 digest.`,
    );
  }
  if (
    typeof value.sizeBytes !== 'number' ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1
  ) {
    return diagnostic(
      'blocks.asset.size',
      `Scratch asset ${index} has an invalid sizeBytes value.`,
    );
  }
  return null;
}

export function validateBlocksDocument(
  value: unknown,
): ModuleValidationResult<BlocksProjectDocumentV1> {
  if (!isRecord(value)) {
    return invalid('blocks.document.type', 'Visual-programming project must be a JSON object.');
  }
  if ('sb3Base64' in value || 'sb3' in value) {
    return invalid(
      'blocks.document.inline_sb3',
      'An .sb3 archive must not be embedded in Project Core JSONB.',
    );
  }
  if (value.schemaVersion !== 1) {
    return invalid('blocks.document.schema_version', 'Visual-programming schemaVersion must be 1.');
  }
  if (value.format !== 'scratch-3') {
    return invalid('blocks.document.format', 'Visual-programming format must be scratch-3.');
  }

  const projectDiagnostic = validateProjectJson(value.projectJson);
  if (projectDiagnostic) return { ok: false, diagnostics: [projectDiagnostic] };

  if (!Array.isArray(value.assets)) {
    return invalid('blocks.document.assets', 'Visual-programming assets must be an array.');
  }
  for (let index = 0; index < value.assets.length; index += 1) {
    const assetDiagnostic = validateAsset(value.assets[index], index);
    if (assetDiagnostic) return { ok: false, diagnostics: [assetDiagnostic] };
  }

  return {
    ok: true,
    payload: value as unknown as BlocksProjectDocumentV1,
    diagnostics: [],
  };
}
