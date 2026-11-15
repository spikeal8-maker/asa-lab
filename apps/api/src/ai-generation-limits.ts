/** One bounded answer budget shared by JSON, SSE and local/cloud transports.
 * Concise prose is a prompt policy; the ceiling must also fit a complete small program.
 * Paid output remains bounded. Local Qwen retains #790's untruncated responses;
 * migration 0262 separately extends its owner-bound generation lease.
 */
export const AI_MAX_OUTPUT_TOKENS = 8192;
export const AI_MAX_ANSWER_CHARS = 65536;
export const AI_GENERATION_TIMEOUT_MS = 300000;
