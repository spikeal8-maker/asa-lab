class ClassroomActionRefusal extends Error {}

export function confirmedClassroomResult<T>(
  result: { ok: true; data: T } | { ok: false; error: { message: string } },
  fallback: string,
): T {
  if (!result.ok) throw new ClassroomActionRefusal(result.error.message || fallback);
  return result.data;
}

/** Busy always covers the request and confirmation, including thrown transport errors. */
export async function runClassroomAction(
  work: () => Promise<void>,
  fallback: string,
  state: { start(): void; fail(message: string): void; finish(): void },
): Promise<string | null> {
  state.start();
  try {
    await work();
    return null;
  } catch (error) {
    const message = `${error instanceof ClassroomActionRefusal ? error.message : fallback} Повторите попытку.`;
    state.fail(message);
    return message;
  } finally {
    state.finish();
  }
}
