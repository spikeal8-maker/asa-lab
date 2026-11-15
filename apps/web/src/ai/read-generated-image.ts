import type { AiGeneratedImage } from '@asa-lab/contracts';
import { fetchWithSessionRefresh } from '../session-fetch';
import { aiScopeHeaders } from './ai-scope-api';

interface ReadTask {
  readonly signal: AbortSignal;
  readonly run: () => Promise<Blob>;
  readonly resolve: (blob: Blob) => void;
  readonly reject: (error: unknown) => void;
  readonly detach: () => void;
  started: boolean;
}
interface ReadQueue {
  active: boolean;
  pending: ReadTask[];
}
const queues = new Map<string, ReadQueue>();
const retryDelays = [500, 1500, 3000] as const;

export function generatedImagePath(threadId: string, requestId: string): string {
  return (
    '/api/ai/threads/' +
    encodeURIComponent(threadId) +
    '/image-generations/' +
    encodeURIComponent(requestId) +
    '/image'
  );
}

function drain(scope: string, queue: ReadQueue): void {
  if (queue.active) return;
  const task = queue.pending.shift();
  if (!task) {
    if (queues.get(scope) === queue) queues.delete(scope);
    return;
  }
  task.started = true;
  task.detach();
  queue.active = true;
  // Do not release the slot merely because headers arrived or a card unmounted.
  // The complete read and byte validation must settle first.
  void task
    .run()
    .then(task.resolve, task.reject)
    .finally(() => {
      queue.active = false;
      drain(scope, queue);
    });
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function readBytes(
  image: AiGeneratedImage,
  threadId: string,
  seatId: string | undefined,
  signal: AbortSignal,
): Promise<Blob> {
  const path = generatedImagePath(threadId, image.requestId);
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    const response = await fetchWithSessionRefresh(path, {
      headers: aiScopeHeaders(seatId),
      signal,
      cache: 'no-store',
    });
    signal.throwIfAborted();
    if (!response.ok) {
      let transferBusy = false;
      if (response.status === 429) {
        try {
          transferBusy = (await response.json())?.error?.code === 'ai_image_busy';
        } catch {
          /* Unrecognized errors are permanent. */
        }
      }
      signal.throwIfAborted();
      const delay = retryDelays[attempt];
      if (!transferBusy || delay === undefined) throw new Error('image unavailable');
      await waitForRetry(delay, signal);
      continue;
    }
    const blob = await response.blob();
    signal.throwIfAborted();
    if (blob.type !== 'image/png' || blob.size !== image.sizeBytes)
      throw new Error('invalid image');
    return blob;
  }
}

/** Serializes this document's reads for the selected canonical scope. Other tabs
 * still share the server permit, so only its typed temporary 429 is retried. No
 * bytes or URLs are cached across scopes or authentication changes. */
export function readGeneratedImage(
  image: AiGeneratedImage,
  threadId: string,
  seatId: string | undefined,
  signal: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const scope = seatId ? 'seat:' + seatId : 'personal';
    let queue = queues.get(scope);
    if (!queue) {
      queue = { active: false, pending: [] };
      queues.set(scope, queue);
    }
    const selected = queue;
    const abort = () => {
      if (task.started) return;
      const index = selected.pending.indexOf(task);
      if (index >= 0) selected.pending.splice(index, 1);
      task.detach();
      reject(signal.reason);
      if (!selected.active && !selected.pending.length && queues.get(scope) === selected)
        queues.delete(scope);
    };
    const task: ReadTask = {
      signal,
      resolve,
      reject,
      started: false,
      run: () => readBytes(image, threadId, seatId, signal),
      detach: () => signal.removeEventListener('abort', abort),
    };
    signal.addEventListener('abort', abort, { once: true });
    selected.pending.push(task);
    drain(scope, selected);
  });
}
