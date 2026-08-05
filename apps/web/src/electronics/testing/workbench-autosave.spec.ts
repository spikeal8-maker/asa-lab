import { describe, expect, it } from 'vitest';
import { autosaveIsDue, draftSaveStatus } from '../workbench-autosave';

interface Draft {
  readonly resistorOhms: number;
}

const at220: Draft = { resistorOhms: 220 };
const at1000: Draft = { resistorOhms: 1000 };

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
});
