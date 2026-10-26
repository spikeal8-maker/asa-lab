/** Existing chat fixtures admit/finish one fresh journal write unless overridden. */
export function aiUsageQueryFixture(sql: string) {
  if (sql === 'SELECT ai_generation_policy_runtime() AS value') return { rows: [{ value: null }] };
  if (sql.startsWith('SELECT ai_usage_begin(')) return { rows: [{ started: true }] };
  if (sql.startsWith('SELECT ai_usage_finish(')) return { rows: [{ recorded: true }] };
  return undefined;
}
