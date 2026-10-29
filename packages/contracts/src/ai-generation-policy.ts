/** Server-owned generation policy. Credentials and real profile values are never returned here. */
export interface AiPromptVariable {
  readonly name:
    | 'current_datetime'
    | 'current_date'
    | 'timezone'
    | 'display_name'
    | 'gender'
    | 'location'
    | 'capabilities'
    | 'tools'
    | 'materials';
  readonly label: string;
  readonly source: string;
  readonly missingValue: string;
}

export interface AiModelPreference {
  readonly id: string;
  readonly eligible: boolean;
  readonly order: number;
}
export interface AiCatalogObservation {
  readonly provider: 'openai' | 'deepseek';
  readonly source: string;
  readonly checkedAt: string | null;
  readonly failed: boolean;
  readonly credentialChanged?: boolean;
  readonly models: readonly { id: string; active: boolean }[];
}
export interface AiGenerationModel {
  readonly id: string;
  readonly provider: 'openai' | 'deepseek' | 'ollama-cloud' | 'ollama';
  readonly label: string;
  readonly ready: boolean;
  readonly selectable: boolean;
  readonly allowed: boolean;
  readonly eligible?: boolean;
  /** Selected by at least one enabled configured Cloud key, independent of temporary availability. */
  readonly connectionSelected?: boolean;
  readonly order?: number;
  readonly adapterCompatible?: boolean;
  readonly unavailableReason?: string | null;
}

export interface AiGenerationPolicy {
  readonly schemaVersion: 1;
  readonly configurationVersion: number;
  readonly systemPrompt: string;
  readonly defaultModel: string | null;
  readonly allowedModels: readonly string[];
  readonly models: readonly AiGenerationModel[];
  readonly variables: readonly AiPromptVariable[];
  readonly modelPreferences?: readonly AiModelPreference[];
  readonly providerOrder?: Readonly<Record<string, number>>;
  readonly observations?: readonly AiCatalogObservation[];
}

export interface AiGenerationPolicyUpdate {
  readonly configurationVersion: number;
  readonly systemPrompt: string;
  readonly defaultModel: string | null;
  readonly allowedModels: readonly string[];
  readonly modelPreferences?: readonly AiModelPreference[];
  readonly providerOrder?: Readonly<Record<string, number>>;
  /** Stable UUID retained across an uncertain save; changed payload requires a new UUID. */
  readonly requestId: string;
}
