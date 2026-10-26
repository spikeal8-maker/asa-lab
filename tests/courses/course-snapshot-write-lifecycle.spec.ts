// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../apps/web/src/api';
import {
  registerProjectSnapshotSource,
  sendProjectSnapshot,
  setProjectSnapshotWriteAllowed,
} from '../../apps/web/src/modules/project-snapshot';

const openedSources: Array<() => void> = [];
const observedProjects: string[] = [];

function startSource(projectId: string, revision: () => number) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const release = registerProjectSnapshotSource(projectId, () => canvas, revision);
  openedSources.push(release);
  observedProjects.push(projectId);
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/webp;base64,U25hcHNob3Q=',
  );
});

afterEach(() => {
  for (const release of openedSources.splice(0)) release();
  for (const projectId of observedProjects.splice(0))
    setProjectSnapshotWriteAllowed(projectId, true);
  vi.restoreAllMocks();
});

describe('Courses E1: learning submission and snapshot write lifecycle', () => {
  it('does not send another snapshot after submission, and permits correction after re-admission', async () => {
    let revision = 1;
    const projectId = 'courses-snapshot-hand-in';
    startSource(projectId, () => revision);
    const writer = vi.spyOn(api, 'saveProjectSnapshot').mockImplementation(
      async (id, _image, sourceRevision) => ({
        ok: true,
        status: 200,
        data: {
          snapshot: {
            projectId: id,
            sourceRevision,
            contentType: 'image/webp',
            width: 160,
            height: 90,
            capturedAt: '2026-10-27T00:00:00.000Z',
          },
        },
      }),
    );

    expect(await sendProjectSnapshot(projectId)).toBe(true);
    expect(writer).toHaveBeenCalledTimes(1);

    // Immediately after an immutable Learning submission succeeds.
    setProjectSnapshotWriteAllowed(projectId, false);
    revision = 2;
    expect(await sendProjectSnapshot(projectId)).toBe(false);
    expect(writer).toHaveBeenCalledTimes(1);

    // Teacher returns the attempt and Learning Start re-admits editing.
    setProjectSnapshotWriteAllowed(projectId, true);
    expect(await sendProjectSnapshot(projectId)).toBe(true);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer.mock.calls[1]?.[2]).toBe(2);
  });

  it('rejects a stale async capture that crosses a successful hand-in', async () => {
    const projectId = 'courses-snapshot-capture-race';
    let deliver!: (canvas: HTMLCanvasElement) => void;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const release = registerProjectSnapshotSource(
      projectId,
      () => new Promise<HTMLCanvasElement>((resolve) => { deliver = resolve; }),
      () => 1,
    );
    openedSources.push(release);
    observedProjects.push(projectId);
    const writer = vi.spyOn(api, 'saveProjectSnapshot');

    const sending = sendProjectSnapshot(projectId);
    expect(deliver).toBeTypeOf('function');
    setProjectSnapshotWriteAllowed(projectId, false);
    deliver(canvas);

    expect(await sending).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it('aborts an in-flight background PUT when a Learning submission completes', async () => {
    const projectId = 'courses-snapshot-inflight-race';
    startSource(projectId, () => 1);
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(api, 'saveProjectSnapshot').mockImplementation(
      async (_id, _image, _revision, options) => {
        observedSignal = options.signal;
        return new Promise<never>(() => {});
      },
    );

    const sending = sendProjectSnapshot(projectId);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    expect(observedSignal?.aborted).toBe(false);

    setProjectSnapshotWriteAllowed(projectId, false);
    expect(observedSignal?.aborted).toBe(true);
    expect(await sending).toBe(false);
  });
});
