/** Existing chat fixtures admit/finish one fresh journal write unless overridden. */
export function aiUsageQueryFixture(sql: string) {
  if (sql === 'SELECT ai_ollama_cloud_catalog_runtime() AS value')
    return {
      rows: [
        {
          value: {
            models: [
              {
                id: 'gemma4:31b',
                model: 'gemma4:31b',
                capabilities: ['completion', 'vision'],
                active: true,
              },
              {
                id: 'gpt-oss:120b',
                model: 'gpt-oss:120b',
                capabilities: ['completion'],
                active: true,
              },
              {
                id: 'gpt-oss:20b',
                model: 'gpt-oss:20b',
                capabilities: ['completion'],
                active: true,
              },
            ],
            checkedAt: null,
          },
        },
      ],
    };
  if (sql === 'SELECT ai_generation_policy_runtime() AS value') return { rows: [{ value: null }] };
  if (sql.startsWith('SELECT ai_usage_begin(')) return { rows: [{ started: true }] };
  if (sql.startsWith('SELECT ai_usage_finish(')) return { rows: [{ recorded: true }] };
  return undefined;
}
