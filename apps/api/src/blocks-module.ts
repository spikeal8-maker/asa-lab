import {
  defineModule,
  type ModuleDiagnostic,
  type ModulePreviewDescriptor,
  type ModuleValidationResult,
} from '@asa-lab/module-sdk';

export interface BlocksAssetReferenceV1 {
  /** Scratch asset identifier (normally the content hash used by project.json). */
  readonly assetId: string;
  /** File extension without a dot: svg, png, wav, mp3, and so on. */
  readonly dataFormat: string;
  /** Stable object-store key. The bytes themselves never belong in Project Core JSONB. */
  readonly objectKey: string;
  /** Integrity digest of the stored bytes. */
  readonly sha256: string;
  readonly sizeBytes: number;
}

/**
 * ASA-owned envelope around Scratch 3 state.
 *
 * `projectJson` is the JSON document found inside an .sb3 archive. Binary assets
 * are deliberately represented by references only. M1 will connect these
 * references to the ASA object store and implement .sb3 import/export.
 */
export interface BlocksProjectDocumentV1 {
  readonly schemaVersion: 1;
  readonly format: 'scratch-3';
  /** Null until the embedded Scratch runtime has initialised its default project. */
  readonly projectJson: Record<string, unknown> | null;
  readonly assets: readonly BlocksAssetReferenceV1[];
}

function diagnostic(code: string, message: string): ModuleDiagnostic {
  return { code, severity: 'error', message };
}

function invalid(
  code: string,
  message: string,
): ModuleValidationResult<BlocksProjectDocumentV1> {
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

  // Inline bytes would make every autosave/checkpoint duplicate the complete
  // .sb3 payload in PostgreSQL. This is a hard architectural boundary.
  for (const forbidden of ['data', 'base64', 'bytes', 'dataUrl'] as const) {
    if (forbidden in value) {
      return diagnostic(
        'blocks.asset.inline_binary',
        `Scratch asset ${index} must reference object storage; inline ${forbidden} is forbidden.`,
      );
    }
  }

  if (
    typeof value.assetId !== 'string' ||
    value.assetId.length < 1 ||
    value.assetId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value.assetId)
  ) {
    return diagnostic('blocks.asset.asset_id', `Scratch asset ${index} has an invalid assetId.`);
  }
  if (
    typeof value.dataFormat !== 'string' ||
    value.dataFormat.length < 1 ||
    value.dataFormat.length > 16 ||
    !/^[a-z0-9]+$/.test(value.dataFormat)
  ) {
    return diagnostic('blocks.asset.data_format', `Scratch asset ${index} has an invalid dataFormat.`);
  }
  if (
    typeof value.objectKey !== 'string' ||
    value.objectKey.length < 1 ||
    value.objectKey.length > 1024 ||
    value.objectKey.includes('\\') ||
    value.objectKey.includes('..')
  ) {
    return diagnostic('blocks.asset.object_key', `Scratch asset ${index} has an invalid objectKey.`);
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    return diagnostic('blocks.asset.sha256', `Scratch asset ${index} has an invalid sha256 digest.`);
  }
  if (
    typeof value.sizeBytes !== 'number' ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1
  ) {
    return diagnostic('blocks.asset.size', `Scratch asset ${index} has an invalid sizeBytes value.`);
  }
  return null;
}

function validateDocument(value: unknown): ModuleValidationResult<BlocksProjectDocumentV1> {
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

function spriteCount(projectJson: Record<string, unknown> | null): number {
  if (!projectJson || !Array.isArray(projectJson.targets)) return 0;
  return projectJson.targets.filter(
    (target) => isRecord(target) && target.isStage !== true,
  ).length;
}

function createPreview(document: BlocksProjectDocumentV1): ModulePreviewDescriptor {
  if (document.projectJson === null) {
    return {
      kind: 'stage',
      summary: 'Scratch 3 · проект ещё не инициализирован',
    };
  }
  return {
    kind: 'stage',
    summary: `Scratch 3 · спрайтов: ${spriteCount(document.projectJson)} · ресурсов: ${document.assets.length}`,
  };
}

export const BLOCKS_MODULE = defineModule<BlocksProjectDocumentV1>({
  manifest: {
    moduleKey: 'blocks',
    moduleVersion: '0.1.0',
    displayName: 'Визуальное программирование',
    shortDescription: 'Блочное программирование, совместимое с проектами Scratch 3.',
    defaultProjectTitlePrefix: 'Визуальный проект',
    projectType: 'scratch-3',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/blocks',
    viewerRoute: '/view/projects/:versionId/blocks',
    safeModeSupported: true,
    // M0 is deliberately gated: save/load and asset persistence arrive in M1.
    availability: 'coming_soon',
    previewKind: 'stage',
    iconKey: 'blocks',
    categories: ['coding', 'creative'],
  },
  provider: {
    createEmptyProject: () => ({
      schemaVersion: 1,
      format: 'scratch-3',
      projectJson: null,
      assets: [],
    }),
    validate: validateDocument,
    createPreview,
  },
});
