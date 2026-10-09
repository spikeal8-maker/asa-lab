import { useEffect, useState } from 'react';
import { encodeClassJoinQr } from './class-join-qr-encoder';

/**
 * The class join link as a square a phone can read.
 *
 * A code typed from a whiteboard costs a primary class ten minutes and produces
 * a queue of "it says wrong code". A camera does not mistype. The reference
 * product has no such thing, which is exactly why it is worth having.
 *
 * The encoder is loaded only when a teacher asks for the square, so it never
 * reaches the bundle that everyone else downloads. Nothing leaves the browser:
 * the code is drawn locally, never sent to an image service, because a class
 * join code is a key to a room full of children.
 */

export function ClassJoinQr({
  url,
  label,
}: {
  readonly url: string;
  readonly label: string;
}): JSX.Element {
  const [state, setState] = useState<
    { url: string; kind: 'ready'; size: number; d: string } | { url: string; kind: 'failed' } | null
  >(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void encodeClassJoinQr(url)
      .then((paths) => {
        if (cancelled) return;
        setState({ url, kind: 'ready', ...paths });
      })
      .catch(() => {
        if (!cancelled) setState({ url, kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [url, attempt]);

  if (state?.url === url && state.kind === 'failed') {
    return (
      <div className="class-qr-failed" role="alert">
        <p>Не удалось построить QR-код. Код класса рядом.</p>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setState(null);
            setAttempt((value) => value + 1);
          }}
        >
          Повторить
        </button>
      </div>
    );
  }
  // A URL change hides the old square in the very first render, before effects run.
  if (!state || state.url !== url || state.kind !== 'ready') {
    return (
      <div className="class-qr-loading" role="status">
        Готовим QR-код…
      </div>
    );
  }

  return (
    <svg
      className="class-qr"
      viewBox={`0 0 ${state.size} ${state.size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      data-testid="class-join-qr"
    >
      <rect x="0" y="0" width={state.size} height={state.size} fill="#ffffff" />
      <path d={state.d} fill="#000000" />
    </svg>
  );
}
