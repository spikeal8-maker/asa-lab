/** Counts describe work to do, not unread messages. Never invent an event from a count. */
export function classAttention(unfinished: number, awaitingReview: number): string | null {
  const pending = Number.isFinite(unfinished) ? Math.max(0, Math.floor(unfinished)) : 0;
  const review = Number.isFinite(awaitingReview) ? Math.max(0, Math.floor(awaitingReview)) : 0;
  return (
    [pending ? `Задания: ${pending}` : '', review ? `На проверку: ${review}` : '']
      .filter(Boolean)
      .join(' · ') || null
  );
}
