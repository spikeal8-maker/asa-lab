/** Foundation surface for the contracts package. OpenAPI/JSON Schema and event contract types. */
export const PACKAGE_NAME = '@asa-lab/contracts';
export { PUBLIC_ARTIFACT_V1_LIMITS, validatePublicArtifact } from './public-artifact.js';
export type {
  PublicArtifact,
  PublicArtifactProvenance,
  PublicArtifactViewerFamily,
  PublicArtifactCapabilities,
  PublicArtifactValidation,
} from './public-artifact.js';
export type {
  AiImageSize,
  AiImageJobState,
  AiGeneratedImage,
  AiImageGenerationStatus,
  AiImageGenerationRequest,
  AiImageGenerationJob,
  AiImageGenerationAdminConfig,
  AiImageGenerationAdminUpdate,
} from './ai-image-generation.js';
export type {
  AiPromptVariable,
  AiGenerationModel,
  AiGenerationPolicy,
  AiGenerationPolicyUpdate,
} from './ai-generation-policy.js';
export type { AiUsageOverview, AiUsageTokenTotal } from './ai-usage-overview.js';
export type {
  AiWebSearchMode,
  AiWebSource,
  AiWebImage,
  AiWebWeather,
  AiWebSearchEvidence,
  AiWebSearchStatus,
  AiWebSearchAdminConfig,
  AiWebSearchAdminUpdate,
} from './ai-web-search.js';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}

export {
  ELECTRONICS_DISPLAY_LIMITS,
  validatePublicProjectDisplayArtifact,
} from './public-project-display-artifact.js';
export type {
  ElectronicsDisplayArtifact,
  PublicProjectDisplayArtifact,
  PublicDisplayComponent,
  PublicDisplayConnection,
  PublicDisplayPoint,
  PublicDisplayComponentKind,
  PublicDisplayVisualProperties,
} from './public-project-display-artifact.js';
export type { PublicScratchPlayerBootstrap } from './public-scratch-player';
