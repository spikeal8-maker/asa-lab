import type { SaveStatus } from './workbench-model';

/**
 * What the editor knows about the draft the server holds.
 *
 * The comparison is document identity, not deep equality: every edit produces a
 * new document object, so `document === savedDocument` means the server holds
 * exactly the document the user is looking at.
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
  /** The last save attempt failed and no edit has been made since. */
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
