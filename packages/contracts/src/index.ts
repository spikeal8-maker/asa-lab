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
  AiModelPreference,
  AiCatalogObservation,
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
  PUBLIC_ELECTRONICS_PROPERTIES,
  PUBLIC_ELECTRONICS_EDITOR_PROPERTIES,
  validatePublicProjectDisplayArtifact,
} from './public-project-display-artifact.js';
export type {
  ElectronicsDisplayArtifact,
  ElectronicsSimulationArtifact,
  PublicSimulationComponent,
  PublicProjectDisplayArtifact,
  PublicDisplayComponent,
  PublicDisplayConnection,
  PublicDisplayPoint,
  PublicDisplayComponentKind,
  PublicDisplayVisualProperties,
} from './public-project-display-artifact.js';
export type { PublicScratchPlayerBootstrap } from './public-scratch-player';

export type {
  AiOllamaCloudModel,
  AiOllamaCloudAccount,
  AiOllamaCloudInspection,
  AiOllamaCloudKey,
  AiOllamaCloudPool,
  AiOllamaCloudKeyUpdate,
} from './ai-ollama-cloud.js';
export type {
  AiTokenBudgetLimit,
  AiTokenBudgetAdmin,
  AiTokenBudgetUpdate,
  AiTokenBudgetsOwn,
} from './ai-token-budgets.js';

export {
  AI_IMAGE_PRESETS,
  aiImagePreset,
  aiImageDimensions,
  isAiImageSize,
  aiImageSizeLabel,
} from './ai-image-generation.js';
export type { AiImageStoredSize } from './ai-image-generation.js';

export { AI_IMAGE_RECIPES } from './ai-image-generation.js';
export type { AiImageRecipe } from './ai-image-generation.js';
