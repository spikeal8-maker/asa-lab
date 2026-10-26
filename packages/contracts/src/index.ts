/** Foundation surface for the contracts package. OpenAPI/JSON Schema and event contract types. */
export const PACKAGE_NAME = '@asa-lab/contracts';
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
