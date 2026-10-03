import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_INTERVAL_MS,
  WorkbenchAutosaveScheduler,
  autosaveIsDue,
  draftSaveStatus,
  type TimedDraftSaveState,
} from '../workbench-autosave';

interface Draft {
  readonly resistorOhms: number;
}

const at220: Draft = { resistorOhms: 220 };
const at1000: Draft = { resistorOhms: 1000 };

afterEach(() => vi.useRealTimers());

describe('workbench draft save state', () => {
  it('reports saved only for the document the editor is showing', () => {
    expect(
      draftSaveStatus({
        document: at220,
        savedDocument: at220,
        savingDocument: null,
        failed: false,
      }),
    ).toBe('saved');
  });

  it('keeps an untouched project saved before anything is loaded', () => {
    expect(
      draftSaveStatus({
        document: null,
        savedDocument: null,
        savingDocument: null,
        failed: false,
      }),
    ).toBe('saved');
    expect(
      autosaveIsDue({ document: null, savedDocument: null, savingDocument: null, failed: false }),
    ).toBe(false);
  });

  it('does not report saved when the completed save carried the previous document', () => {
    // The resistance edit landed while the save of the previous document was in
    // flight. That save makes 220 Ω durable and says nothing about 1000 Ω, so a
    // checkpoint taken here would capture the document from before the edit.
    const afterStaleSave = {
      document: at1000,
      savedDocument: at220,
      savingDocument: null,
      failed: false,
    };

    expect(draftSaveStatus(afterStaleSave)).toBe('dirty');
    expect(autosaveIsDue(afterStaleSave)).toBe(true);
  });

  it('reports saving only while the request covering the latest edit is in flight', () => {
    expect(
      draftSaveStatus({
        document: at1000,
        savedDocument: at220,
        savingDocument: at1000,
        failed: false,
      }),
    ).toBe('saving');
    expect(
      draftSaveStatus({
        document: at1000,
        savedDocument: null,
        savingDocument: at220,
        failed: false,
      }),
    ).toBe('dirty');
  });

  it('holds autosave back until the request in flight completes', () => {
    // A second overlapping request can reach the server in either order, which
    // is how an older document ends up written on top of a newer one.
    expect(
      autosaveIsDue({
        document: at1000,
        savedDocument: null,
        savingDocument: at220,
        failed: false,
      }),
    ).toBe(false);
  });

  it('depends on documents being replaced rather than mutated', () => {
    // The comparison is identity, which is what makes it cheap and exact. The
    // cost is a contract: an edit must produce a new document object. Mutating
    // one in place leaves the editor believing the server already holds the
    // change, and the change is then lost exactly as before this fix.
    //
    // This is asserted rather than described so the contract fails loudly if a
    // future call site starts mutating. Every write goes through setDocument in
    // use-workbench-project-state.ts, which is the only place that has to honour it.
    const mutable = { resistorOhms: 220 };
    const stateBefore = {
      document: mutable,
      savedDocument: mutable,
      savingDocument: null,
      failed: false,
    };
    expect(draftSaveStatus(stateBefore)).toBe('saved');

    mutable.resistorOhms = 1000;

    expect(draftSaveStatus(stateBefore)).toBe('saved');
    expect(autosaveIsDue(stateBefore)).toBe(false);

    // Replacing the object — what every edit path actually does — is detected.
    const stateAfterReplacement = { ...stateBefore, document: { resistorOhms: 1000 } };
    expect(draftSaveStatus(stateAfterReplacement)).toBe('dirty');
    expect(autosaveIsDue(stateAfterReplacement)).toBe(true);
  });

  it('stops autosave after a failed save and resumes on the next edit', () => {
    expect(
      draftSaveStatus({
        document: at220,
        savedDocument: null,
        savingDocument: null,
        failed: true,
      }),
    ).toBe('error');
    expect(
      autosaveIsDue({ document: at220, savedDocument: null, savingDocument: null, failed: true }),
    ).toBe(false);
    expect(
      autosaveIsDue({ document: at1000, savedDocument: null, savingDocument: null, failed: false }),
    ).toBe(true);
  });

  it('anchors the deadline to the first edit and reads the newest document at expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let state: TimedDraftSaveState<Draft> = {
      document: at220,
      savedDocument: at220,
      savingDocument: null,
      failed: false,
      paused: false,
    };
    const save = vi.fn();
    const scheduler = new WorkbenchAutosaveScheduler(() => state, save);
    state = { ...state, document: at1000 };
    scheduler.update();
    vi.advanceTimersByTime(30_000);
    const latest = { resistorOhms: 470 };
    state = { ...state, document: latest };
    scheduler.update();
    vi.advanceTimersByTime(29_999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(latest);
    scheduler.dispose();
  });

  it('starts a new minute for an edit during an in-flight request', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let state: TimedDraftSaveState<Draft> = {
      document: at1000,
      savedDocument: at220,
      savingDocument: null,
      failed: false,
      paused: false,
    };
    const save = vi.fn();
    const scheduler = new WorkbenchAutosaveScheduler(() => state, save);
    scheduler.update();
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    expect(save).toHaveBeenCalledWith(at1000);
    state = { ...state, savingDocument: at1000 };
    scheduler.update();
    vi.advanceTimersByTime(10_000);
    const next = { resistorOhms: 680 };
    state = { ...state, document: next };
    scheduler.update();
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    expect(save).toHaveBeenCalledTimes(1);
    state = { ...state, savedDocument: at1000, savingDocument: null };
    scheduler.update();
    vi.advanceTimersByTime(0);
    expect(save).toHaveBeenLastCalledWith(next);
    scheduler.dispose();
  });
});
