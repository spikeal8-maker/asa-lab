export const AI_IMAGE_RECIPES = ['flux2-klein-4b-v1', 'flux2-klein-4b-fp8-izo-v1'] as const;
export type AiImageRecipe = (typeof AI_IMAGE_RECIPES)[number];
/** Local GPU images are independent of text-provider credentials and token budgets. */
/** Stable preset IDs, not a square side length. Existing square IDs remain unchanged. */
export const AI_IMAGE_PRESETS = [
  { id: 768, width: 768, height: 768, label: 'Квадрат · Стандартный · 768 × 768', aspect: '1:1' },
  { id: 1024, width: 1024, height: 1024, label: 'Квадрат · Большой · 1024 × 1024', aspect: '1:1' },
  { id: 1280, width: 1280, height: 720, label: 'Широкий · HD · 1280 × 720', aspect: '16:9' },
  { id: 1536, width: 1536, height: 864, label: 'Широкий · Большой · 1536 × 864', aspect: '16:9' },
  { id: 720, width: 720, height: 1280, label: 'Вертикальный · HD · 720 × 1280', aspect: '9:16' },
  {
    id: 864,
    width: 864,
    height: 1536,
    label: 'Вертикальный · Большой · 864 × 1536',
    aspect: '9:16',
  },
] as const;
export type AiImageSize = (typeof AI_IMAGE_PRESETS)[number]['id'];
/** Old jobs and their immutable receipts remain recoverable; 512 is not offered for new work. */
export type AiImageStoredSize = AiImageSize | 512;
export function aiImagePreset(size: unknown) {
  return AI_IMAGE_PRESETS.find((p) => p.id === size);
}
export function isAiImageSize(size: unknown): size is AiImageSize {
  return aiImagePreset(size) !== undefined;
}
export function aiImageDimensions(size: AiImageStoredSize): { width: number; height: number } {
  if (size === 512) return { width: 512, height: 512 };
  const preset = aiImagePreset(size);
  if (!preset) throw new Error('AI_IMAGE_SIZE_INVALID');
  return { width: preset.width, height: preset.height };
}
export function aiImageSizeLabel(size: AiImageSize): string {
  return aiImagePreset(size)?.label ?? 'Неизвестный размер';
}

export type AiImageJobState =
  | 'admitted'
  | 'submitting'
  | 'unknown'
  | 'running'
  | 'storing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface AiGeneratedImage {
  readonly requestId: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/png';
  readonly sizeBytes: number;
  /** Authenticated same-origin route, never a provider or object-storage URL. */
  readonly downloadUrl: string;
}

export interface AiImageGenerationStatus {
  /** Optional for compatibility with an older API response. */
  readonly recipe?: AiImageRecipe;
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly reason: string | null;
  readonly sizes: readonly AiImageSize[];
  readonly dailyLimit: number;
  readonly remainingToday: number;
}

export interface AiImageGenerationRequest {
  /** Stable across an uncertain response; never automatically replace or resend. */
  readonly requestId: string;
  readonly prompt: string;
  readonly size: AiImageSize;
}

export interface AiImageGenerationJob {
  readonly recipe?: AiImageRecipe;
  readonly size?: AiImageStoredSize;
  readonly requestId: string;
  readonly threadId: string;
  readonly state: AiImageJobState;
  readonly prompt: string;
  readonly createdAt: string;
  readonly cancelRequested: boolean;
  readonly errorCode: string | null;
  readonly image: AiGeneratedImage | null;
}

export interface AiImageGenerationAdminConfig {
  readonly configurationVersion: number;
  readonly enabled: boolean;
  readonly dailyLimit: number;
  readonly globalConcurrency: number;
  readonly sizes: readonly AiImageSize[];
  readonly ready: boolean;
  readonly reason: string | null;
  readonly recipe: AiImageRecipe;
}

export interface AiImageGenerationAdminUpdate {
  /** Omitted by older clients: retain current profile. */
  readonly recipe?: AiImageRecipe;
  readonly configurationVersion: number;
  readonly requestId: string;
  readonly enabled: boolean;
  readonly dailyLimit: number;
  readonly globalConcurrency: number;
  readonly sizes: readonly AiImageSize[];
}
