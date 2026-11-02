/** Provider-reported counts only. Missing/invalid usage must never become zero. */
export interface AiProviderUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly actualModel: string | null;
}

export function providerTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function providerModel(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(value) &&
    !value.includes('://')
    ? value
    : null;
}

export function providerUsage(
  provider: 'openai' | 'deepseek' | 'ollama' | 'ollama-cloud' | 'polza',
  payload: unknown,
): AiProviderUsage | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const packet = payload as Record<string, unknown>;
  const usage =
    packet.usage && typeof packet.usage === 'object'
      ? (packet.usage as Record<string, unknown>)
      : {};
  const inputTokens = providerTokenCount(
    provider === 'ollama'
      ? packet.prompt_eval_count
      : provider === 'openai'
        ? usage.input_tokens
        : usage.prompt_tokens,
  );
  const outputTokens = providerTokenCount(
    provider === 'ollama'
      ? packet.eval_count
      : provider === 'openai'
        ? usage.output_tokens
        : usage.completion_tokens,
  );
  const actualModel = providerModel(packet.model);
  return inputTokens !== null || outputTokens !== null || actualModel !== null
    ? { inputTokens, outputTokens, actualModel }
    : undefined;
}

export function mergeProviderUsage(
  previous: AiProviderUsage | undefined,
  next: AiProviderUsage | undefined,
): AiProviderUsage | undefined {
  if (!next) return previous;
  return {
    inputTokens: next.inputTokens ?? previous?.inputTokens ?? null,
    outputTokens: next.outputTokens ?? previous?.outputTokens ?? null,
    actualModel: next.actualModel ?? previous?.actualModel ?? null,
  };
}
