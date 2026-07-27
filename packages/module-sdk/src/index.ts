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
  | { readonly ok: true; readonly payload: TPayload; readonly diagnostics: readonly ModuleDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly ModuleDiagnostic[] };

export interface ModulePreviewDescriptor {
  readonly kind: ModulePreviewKind;
  readonly digest?: string;
  readonly inlineData?: string;
  readonly artifactRef?: string;
  readonly summary?: string;
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
        throw new ModuleRegistryError(`active module ${entry.manifest.moduleKey} requires a provider`);
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
