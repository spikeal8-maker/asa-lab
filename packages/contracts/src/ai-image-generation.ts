/** Local GPU images are independent of text-provider credentials and token budgets. */
export type AiImageSize = 512 | 768 | 1024;
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
  readonly recipe: 'flux2-klein-4b-v1';
}

export interface AiImageGenerationAdminUpdate {
  readonly configurationVersion: number;
  readonly requestId: string;
  readonly enabled: boolean;
  readonly dailyLimit: number;
  readonly globalConcurrency: number;
  readonly sizes: readonly AiImageSize[];
}
