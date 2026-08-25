import { api } from '../api';

/**
 * The picture a project card shows, taken from the editor that drew it.
 *
 * A module knows how to render itself and nothing else; Project Core decides
 * how large the picture is, what format it is in and when it is sent. So an
 * editor registers one function that hands back a canvas showing its current
 * state, and everything after that is the same for every subject.
 *
 * The canvas must be readable at the moment it is returned. A WebGL editor has
 * to render into it in the same turn, because a drawing buffer is discarded
 * once the frame is presented; this module draws from it immediately and never
 * awaits in between.
 */

/** Wide enough for the largest card, small enough to stay a thumbnail. */
export const SNAPSHOT_WIDTH = 480;
const SNAPSHOT_QUALITY = 0.72;

/** First capture after the editor has had time to load and settle. */
const FIRST_CAPTURE_MS = 4_000;
/** How often a capture is retried while the learner keeps working. */
const REPEAT_CAPTURE_MS = 60_000;

/**
 * A body sent during page unload is only guaranteed while it stays small.
 * Above this a capture is still sent from a live page, but the last-moment
 * attempt is skipped rather than pretending it will arrive.
 */
const KEEPALIVE_LIMIT_BYTES = 60_000;

/**
 * A source may answer synchronously or not. A WebGL editor must be synchronous,
 * because its drawing buffer is gone by the next turn; an editor that has to
 * rasterise an SVG first returns a promise, and the canvas it resolves with is
 * an ordinary one that keeps its contents.
 */
export type SnapshotSource = () => HTMLCanvasElement | null | Promise<HTMLCanvasElement | null>;

interface RegisteredSnapshotSource {
  readonly capture: SnapshotSource;
  readonly revision: () => number | null;
}

interface CapturedSnapshot {
  readonly image: string;
  readonly sourceRevision: number;
}

const sources = new Map<string, RegisteredSnapshotSource>();
const lastSent = new Map<string, string>();

/**
 * Called by an editor while it is mounted. The returned function unregisters,
 * so a project that is closed cannot be photographed by a later one.
 */
export function registerProjectSnapshotSource(
  projectId: string,
  source: SnapshotSource,
  revision: () => number | null,
): () => void {
  const registration = { capture: source, revision };
  sources.set(projectId, registration);
  return () => {
    if (sources.get(projectId) === registration) sources.delete(projectId);
  };
}

/**
 * Scales a rendered canvas down to card size and encodes it.
 *
 * WebP is asked for first; a browser that cannot encode it returns PNG from the
 * same call, and the server accepts either, so there is nothing to detect.
 */
export function encodeSnapshot(canvas: HTMLCanvasElement): string | null {
  if (canvas.width < 1 || canvas.height < 1) return null;
  const scale = Math.min(1, SNAPSHOT_WIDTH / canvas.width);
  const width = Math.max(16, Math.round(canvas.width * scale));
  const height = Math.max(16, Math.round(canvas.height * scale));
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const context = target.getContext('2d');
  if (!context) return null;
  // An editor may render onto transparency; a card is opaque, and a transparent
  // PNG would show the card gradient through the middle of the drawing.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  try {
    context.drawImage(canvas, 0, 0, width, height);
  } catch {
    // A tainted canvas cannot be read. That is a bug in whatever drew it, and
    // it must not take down the editor.
    return null;
  }
  const encoded = target.toDataURL('image/webp', SNAPSHOT_QUALITY);
  return encoded.startsWith('data:image/') ? encoded : null;
}

export async function captureProjectSnapshot(projectId: string): Promise<CapturedSnapshot | null> {
  const registered = sources.get(projectId);
  if (!registered) return null;
  try {
    const sourceRevision = registered.revision();
    if (sourceRevision === null || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1) {
      return null;
    }
    // A synchronous source is encoded in this same turn: awaiting a plain value
    // would still yield, and a WebGL drawing buffer does not survive that.
    const produced = registered.capture();
    const canvas = produced instanceof Promise ? await produced : produced;
    const image = canvas ? encodeSnapshot(canvas) : null;
    return image ? { image, sourceRevision } : null;
  } catch {
    // An editor mid-teardown, a lost WebGL context, a module bug: none of them
    // are worth interrupting the learner over.
    return null;
  }
}

/**
 * Sends the picture unless it is the one already stored. Editors capture on a
 * timer, and a learner reading the screen produces the same bytes every time.
 */
export async function sendProjectSnapshot(
  projectId: string,
  options: { unloading?: boolean } = {},
): Promise<boolean> {
  const captured = await captureProjectSnapshot(projectId);
  if (!captured || lastSent.get(projectId) === captured.image) return false;
  if (options.unloading === true && captured.image.length > KEEPALIVE_LIMIT_BYTES) return false;
  // Recorded before the request completes: a failure is not worth retrying on
  // the next tick with the same bytes, and the next real change will differ.
  lastSent.set(projectId, captured.image);
  const result = await api.saveProjectSnapshot(
    projectId,
    captured.image,
    captured.sourceRevision,
    options,
  );
  return result.ok;
}

/**
 * Capture triggers.
 *
 * Tinkercad refreshes a design thumbnail when the author walks back to the
 * dashboard from inside the editor, which is why its own help centre documents
 * how to fix a stale one. A class does not leave that way: thirty learners
 * close a laptop lid when the bell goes. So a capture is taken shortly after
 * the editor settles, again on a slow timer, and once more when the page is
 * hidden or unloaded — the last one best-effort, the earlier ones reliable.
 */
export function startProjectSnapshots(projectId: string): () => void {
  let stopped = false;
  const run = (unloading: boolean): void => {
    if (stopped) return;
    void sendProjectSnapshot(projectId, { unloading });
  };

  const first = window.setTimeout(() => run(false), FIRST_CAPTURE_MS);
  const repeat = window.setInterval(() => {
    if (document.visibilityState === 'visible') run(false);
  }, REPEAT_CAPTURE_MS);

  const onVisibility = (): void => {
    // Still a live page here, so a full-size body is fine.
    if (document.visibilityState === 'hidden') run(false);
  };
  const onPageHide = (): void => run(true);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    stopped = true;
    window.clearTimeout(first);
    window.clearInterval(repeat);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}
