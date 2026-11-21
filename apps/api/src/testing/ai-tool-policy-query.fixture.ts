import { AI_TOOL_IDS } from '@asa-lab/contracts';

/** Explicit enabled policy for transport unit fixtures; real authorization is tested with PG. */
export function aiToolPolicyQueryFixture(sql: string) {
  if (sql.includes("to_regprocedure('public.ai_tool_policy_permit"))
    return { rows: [{ ready: true }] };
  if (sql.includes('SELECT ai_tool_policy_permit')) return { rows: [{ value: true }] };
  if (sql.includes('ai_tool_policy_snapshot'))
    return {
      rows: [
        {
          value: {
            revision: 1,
            tools: AI_TOOL_IDS.map((id) => ({ id, enabled: true, instructions: '' })),
          },
        },
      ],
    };
  return null;
}
