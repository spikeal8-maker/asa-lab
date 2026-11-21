/** Keep the whole provider result available when it cannot fit the chat composer. */
export function mergeVoiceTranscript(
  draft: string,
  transcript: string,
): { draft: string; overflow: string | null } {
  const combined = draft.trim() ? draft.trimEnd() + ' ' + transcript : transcript;
  if (combined.length > 3000) return { draft, overflow: transcript };
  return { draft: combined, overflow: null };
}
