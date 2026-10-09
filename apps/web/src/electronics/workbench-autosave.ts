import type { SaveStatus } from './workbench-model';

/**
 * What the editor knows about the draft the server holds.
 *
 * The comparison is document identity, not deep equality: every edit produces a
 * new document object, so `document === savedDocument` means the server holds
 * exactly the document the user is looking at.
 *
 * That makes immutable updates a contract rather than a style preference. A
 * document mutated in place would read as already saved and the change would be
 * lost — the exact failure this module exists to prevent. `setDocument` in
 * use-workbench-project-state.ts is the single write path that honours it, and
 * the contract is asserted in workbench-autosave.spec.ts.
 *
 * A save only makes durable the document it carried, which is why the document
 * in flight is tracked separately. A request that started before the latest edit
 * says nothing about that edit, and treating its completion as "saved" is what
 * lets a checkpoint taken right after an edit capture the previous document.
 */
export interface DraftSaveState<TDocument> {
  /** Newest document in the editor. */
  readonly document: TDocument | null;
  /** Document the server is known to hold. */
  readonly savedDocument: TDocument | null;
  /** Document carried by the request in flight, or null when nothing is in flight. */
  readonly savingDocument: TDocument | null;
  /** A failure remains unresolved; a new edit cannot resolve a conflict. */
  readonly failed: boolean;
}

/**
 * The indicator only claims success for the document currently on screen.
 * Anything else — an older save still running, an edit made while one was
 * running — reads as still saving.
 */
export function draftSaveStatus<TDocument>(state: DraftSaveState<TDocument>): SaveStatus {
  if (state.failed) return 'error';
  if (state.document === state.savedDocument) return 'saved';
  return state.savingDocument === state.document ? 'saving' : 'dirty';
}

/**
 * True when the newest document still has to reach the server and nothing is in
 * flight. One request at a time keeps the stored draft ordered: two overlapping
 * saves can be applied in either order, which is how an older document ends up
 * written on top of a newer one.
 */
export function autosaveIsDue<TDocument>(state: DraftSaveState<TDocument>): boolean {
  return (
    !state.failed &&
    state.document !== null &&
    state.document !== state.savedDocument &&
    state.savingDocument === null
  );
}

export const AUTOSAVE_INTERVAL_MS = 60_000;

/** At most one attempt per minute after the initial bounded backoff. */
export function transientSaveRetryDelay(attempt: number): number {
  return Math.min(AUTOSAVE_INTERVAL_MS, 5_000 * 2 ** Math.min(4, Math.max(0, attempt - 1)));
}

export interface TimedDraftSaveState<TDocument> extends DraftSaveState<TDocument> {
  /** A simulation is starting, so its first local Worker result has not arrived yet. */
  readonly paused: boolean;
  /** Only transient failures may be retried. Null/absent means a hard stop. */
  readonly retryAt?: number | null;
}

/**
 * One deadline starts with the first edit that is not already being saved. Later
 * edits replace the document read at the deadline, without moving that deadline.
 * An edit during an in-flight request starts its own minute; when that minute
 * expires, the next request waits for the previous one to finish.
 */
export class WorkbenchAutosaveScheduler<TDocument> {
  private deadline: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly readState: () => TimedDraftSaveState<TDocument>,
    private readonly save: (document: TDocument) => void,
  ) {}

  update(): void {
    this.clearTimer();
    const state = this.readState();
    if (state.document === null || state.document === state.savedDocument) {
      this.deadline = null;
      return;
    }
    if (state.failed) {
      this.deadline = state.retryAt ?? null;
      if (this.deadline === null) return;
    } else if (state.document === state.savingDocument) return;
    this.deadline ??= Date.now() + AUTOSAVE_INTERVAL_MS;
    if (state.savingDocument !== null || state.paused) return;

    this.timer = setTimeout(() => this.onDeadline(), Math.max(0, this.deadline - Date.now()));
  }

  /** An immediate manual/safety save (or the due autosave) covers this document. */
  markSaveRequested(document: TDocument): void {
    if (this.readState().document !== document) return;
    this.deadline = null;
    this.clearTimer();
  }

  dispose(): void {
    this.clearTimer();
    this.deadline = null;
  }

  private onDeadline(): void {
    this.timer = null;
    const state = this.readState();
    if (
      (state.failed
        ? state.document === null || state.savingDocument !== null || state.retryAt == null
        : !autosaveIsDue(state)) ||
      state.paused ||
      this.deadline === null ||
      Date.now() < this.deadline
    ) {
      this.update();
      return;
    }
    const document = state.document;
    if (document === null) return;
    this.markSaveRequested(document);
    this.save(document);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
