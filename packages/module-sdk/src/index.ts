/**
 * Stable, framework-independent contracts for subject modules.
 *
 * Classroom, publication, assignment and project-core code depend only on
 * these contracts. A subject module owns its payload, validation, preview and
 * optional analysis. The registry is intentionally small and synchronous for
 * the first product release; remote module loading is out of scope.
 */

export const PACKAGE_NAME = '@asa-lab/module-sdk';

export type ModuleAvailability = 'active' | 'coming_soon' | 'disabled';
export type ModulePreviewKind = 'schematic' | 'board' | 'stage' | 'scene' | 'drawing' | 'summary';
export type ModuleDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ModuleManifestV1 {
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly projectType: string;
  readonly schemaVersion: number;
  readonly editorRoute: string;
  readonly viewerRoute: string;
  readonly safeModeSupported: boolean;
  readonly availability: ModuleAvailability;
  readonly previewKind: ModulePreviewKind;
  readonly iconKey: string;
  readonly categories: readonly string[];
}

export interface ModuleAnchor {
  readonly type: string;
  readonly ref: string;
  readonly property?: string;
}

export interface ModuleDiagnostic {
  readonly code: string;
  readonly severity: ModuleDiagnosticSeverity;
  readonly message: string;
  readonly anchor?: ModuleAnchor;
}

export type ModuleValidationResult<TPayload> =
  | {
      readonly ok: true;
      readonly payload: TPayload;
      readonly diagnostics: readonly ModuleDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly ModuleDiagnostic[] };

/**
 * A preview drawn by Project Core without knowing the subject.
 *
 * The obvious implementation — let each module render its own thumbnail — puts
 * subject code back into the project list, and the list is the one screen every
 * visitor loads. So a module describes its preview in primitives instead, and
 * Core draws them. Electronics says "these rectangles and these lines"; chess
 * says "this grid and these discs"; Core does not know which is which.
 *
 * Coordinates are in the descriptor's own viewBox space, so a module picks
 * whatever units suit it and Core scales the result to the card.
 */
export type ModulePreviewShape =
  | {
      readonly shape: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly fill?: string;
      readonly stroke?: string;
      readonly radius?: number;
    }
  | {
      readonly shape: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill?: string;
      readonly stroke?: string;
    }
  | {
      readonly shape: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly stroke: string;
      readonly width?: number;
    };

export interface ModulePreviewFigure {
  readonly viewBox: { readonly width: number; readonly height: number };
  readonly background?: string;
  readonly shapes: readonly ModulePreviewShape[];
}

export interface ModulePreviewDescriptor {
  readonly kind: ModulePreviewKind;
  readonly digest?: string;
  readonly inlineData?: string;
  readonly artifactRef?: string;
  readonly summary?: string;
  /** Neutral drawing for the project card. Absent means "nothing to draw yet". */
  readonly figure?: ModulePreviewFigure;
}

/** How many shapes Core will draw. A preview is a thumbnail, not a document. */
export const MODULE_PREVIEW_SHAPE_LIMIT = 240;

export interface BoardPreviewPiece {
  /** Zero-based column from the left. */
  readonly file: number;
  /** Zero-based row from the top. */
  readonly rank: number;
  readonly fill: string;
  readonly stroke?: string;
  /** Drawn as a smaller inner disc: a crowned piece, a marker, a highlight. */
  readonly crowned?: boolean;
}

export interface BoardPreviewOptions {
  readonly size: number;
  readonly light: string;
  readonly dark: string;
  readonly pieces: readonly BoardPreviewPiece[];
}

/**
 * A square board with discs on it. Chess and checkers both need exactly this
 * and cannot import each other, so it lives here rather than being written
 * twice with two sets of rounding bugs.
 */
export function boardPreviewFigure(options: BoardPreviewOptions): ModulePreviewFigure {
  const cell = 12;
  const extent = options.size * cell;
  const shapes: ModulePreviewShape[] = [];

  for (let rank = 0; rank < options.size; rank += 1) {
    for (let file = 0; file < options.size; file += 1) {
      shapes.push({
        shape: 'rect',
        x: file * cell,
        y: rank * cell,
        width: cell,
        height: cell,
        fill: (file + rank) % 2 === 0 ? options.light : options.dark,
      });
    }
  }

  for (const piece of options.pieces) {
    if (piece.file < 0 || piece.file >= options.size) continue;
    if (piece.rank < 0 || piece.rank >= options.size) continue;
    const cx = piece.file * cell + cell / 2;
    const cy = piece.rank * cell + cell / 2;
    shapes.push({
      shape: 'circle',
      cx,
      cy,
      r: cell * 0.36,
      fill: piece.fill,
      ...(piece.stroke ? { stroke: piece.stroke } : {}),
    });
    if (piece.crowned === true) {
      shapes.push({ shape: 'circle', cx, cy, r: cell * 0.16, fill: piece.stroke ?? options.dark });
    }
  }

  return { viewBox: { width: extent, height: extent }, background: options.light, shapes };
}

/**
 * A stable fingerprint of a preview. The parity gate asks that the same version
 * always produces the same preview; comparing digests is how that is checked
 * without comparing pictures.
 */
export function previewDigest(descriptor: ModulePreviewDescriptor): string {
  const canonical = JSON.stringify([
    descriptor.kind,
    descriptor.summary ?? null,
    descriptor.figure
      ? [descriptor.figure.viewBox, descriptor.figure.background ?? null, descriptor.figure.shapes]
      : null,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface ModuleProviderV1<TPayload = unknown, TAnalysis = unknown> {
  createEmptyProject(): TPayload;
  validate(payload: unknown): ModuleValidationResult<TPayload>;
  createPreview(payload: TPayload): ModulePreviewDescriptor;
  analyse?(payload: TPayload): TAnalysis;
}

export interface RegisteredModule<TPayload = unknown, TAnalysis = unknown> {
  readonly manifest: ModuleManifestV1;
  readonly provider?: ModuleProviderV1<TPayload, TAnalysis>;
}

export interface ModuleSummary {
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly projectType: string;
  readonly schemaVersion: number;
  readonly editorRoute: string;
  readonly viewerRoute: string;
  readonly safeModeSupported: boolean;
  readonly availability: ModuleAvailability;
  readonly previewKind: ModulePreviewKind;
  readonly iconKey: string;
  readonly categories: readonly string[];
  readonly creatable: boolean;
}

export class ModuleRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleRegistryError';
  }
}

function validateManifest(manifest: ModuleManifestV1): void {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(manifest.moduleKey)) {
    throw new ModuleRegistryError(`invalid moduleKey: ${manifest.moduleKey}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.moduleVersion)) {
    throw new ModuleRegistryError(`invalid moduleVersion for ${manifest.moduleKey}`);
  }
  if (!manifest.displayName.trim() || !manifest.shortDescription.trim()) {
    throw new ModuleRegistryError(`module ${manifest.moduleKey} requires display text`);
  }
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) {
    throw new ModuleRegistryError(`module ${manifest.moduleKey} has invalid schemaVersion`);
  }
  if (!manifest.editorRoute.startsWith('/') || !manifest.viewerRoute.startsWith('/')) {
    throw new ModuleRegistryError(`module ${manifest.moduleKey} routes must start with /`);
  }
  if (manifest.categories.length === 0) {
    throw new ModuleRegistryError(`module ${manifest.moduleKey} requires at least one category`);
  }
}

function toSummary(entry: RegisteredModule): ModuleSummary {
  const manifest = entry.manifest;
  return {
    moduleKey: manifest.moduleKey,
    moduleVersion: manifest.moduleVersion,
    displayName: manifest.displayName,
    shortDescription: manifest.shortDescription,
    projectType: manifest.projectType,
    schemaVersion: manifest.schemaVersion,
    editorRoute: manifest.editorRoute,
    viewerRoute: manifest.viewerRoute,
    safeModeSupported: manifest.safeModeSupported,
    availability: manifest.availability,
    previewKind: manifest.previewKind,
    iconKey: manifest.iconKey,
    categories: manifest.categories,
    creatable: manifest.availability === 'active' && entry.provider !== undefined,
  };
}

export class ModuleRegistry {
  private readonly entries = new Map<string, RegisteredModule>();

  constructor(modules: readonly RegisteredModule[]) {
    for (const entry of modules) {
      validateManifest(entry.manifest);
      if (this.entries.has(entry.manifest.moduleKey)) {
        throw new ModuleRegistryError(`duplicate moduleKey: ${entry.manifest.moduleKey}`);
      }
      if (entry.manifest.availability === 'active' && entry.provider === undefined) {
        throw new ModuleRegistryError(
          `active module ${entry.manifest.moduleKey} requires a provider`,
        );
      }
      this.entries.set(entry.manifest.moduleKey, entry);
    }
  }

  list(): readonly ModuleSummary[] {
    return [...this.entries.values()]
      .map(toSummary)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru'));
  }

  listCreatable(): readonly ModuleSummary[] {
    return this.list().filter((module) => module.creatable);
  }

  get(moduleKey: string): RegisteredModule | null {
    return this.entries.get(moduleKey) ?? null;
  }

  require(moduleKey: string): RegisteredModule {
    const entry = this.get(moduleKey);
    if (!entry) {
      throw new ModuleRegistryError(`unknown module: ${moduleKey}`);
    }
    return entry;
  }

  getCreatable(moduleKey: string): RegisteredModule | null {
    const entry = this.get(moduleKey);
    if (!entry || entry.manifest.availability !== 'active' || entry.provider === undefined) {
      return null;
    }
    return entry;
  }
}

export function defineModule<TPayload, TAnalysis = unknown>(
  manifest: ModuleManifestV1,
  provider: ModuleProviderV1<TPayload, TAnalysis>,
): RegisteredModule<TPayload, TAnalysis> {
  return { manifest, provider };
}

export function defineFutureModule(manifest: ModuleManifestV1): RegisteredModule {
  if (manifest.availability === 'active') {
    throw new ModuleRegistryError('defineFutureModule cannot create an active module');
  }
  return { manifest };
}
