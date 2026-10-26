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

export interface AiGenerationModel {
  readonly id: string;
  readonly provider: 'openai' | 'deepseek' | 'ollama-cloud' | 'ollama';
  readonly label: string;
  readonly ready: boolean;
  readonly selectable: boolean;
  readonly allowed: boolean;
}

export interface AiGenerationPolicy {
  readonly schemaVersion: 1;
  readonly configurationVersion: number;
  readonly systemPrompt: string;
  readonly defaultModel: string | null;
  readonly allowedModels: readonly string[];
  readonly models: readonly AiGenerationModel[];
  readonly variables: readonly AiPromptVariable[];
}

export interface AiGenerationPolicyUpdate {
  readonly configurationVersion: number;
  readonly systemPrompt: string;
  readonly defaultModel: string | null;
  readonly allowedModels: readonly string[];
  /** Stable UUID retained across an uncertain save; changed payload requires a new UUID. */
  readonly requestId: string;
}
