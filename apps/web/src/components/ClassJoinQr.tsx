import { useEffect, useState } from 'react';

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

const MODULE_SIZE = 6;
const QUIET_ZONE = 4;

export function ClassJoinQr({
  url,
  label,
}: {
  readonly url: string;
  readonly label: string;
}): JSX.Element {
  const [paths, setPaths] = useState<{ size: number; d: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import('qrcode-generator')
      .then(({ default: qr }) => {
        if (cancelled) return;
        // Error correction M: readable when a printed sheet gets a thumbprint
        // on it, without making the square denser than a phone likes.
        const code = qr(0, 'M');
        code.addData(url);
        code.make();
        const count = code.getModuleCount();
        let d = '';
        for (let row = 0; row < count; row += 1) {
          for (let column = 0; column < count; column += 1) {
            if (!code.isDark(row, column)) continue;
            const x = (column + QUIET_ZONE) * MODULE_SIZE;
            const y = (row + QUIET_ZONE) * MODULE_SIZE;
            d += `M${x} ${y}h${MODULE_SIZE}v${MODULE_SIZE}h-${MODULE_SIZE}z`;
          }
        }
        setPaths({ size: (count + QUIET_ZONE * 2) * MODULE_SIZE, d });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return <p className="class-qr-failed">Не удалось построить QR-код. Код класса рядом.</p>;
  }
  if (!paths) {
    return (
      <div className="class-qr-loading" role="status">
        Готовим QR-код…
      </div>
    );
  }

  return (
    <svg
      className="class-qr"
      viewBox={`0 0 ${paths.size} ${paths.size}`}
      role="img"
      aria-label={label}
      data-testid="class-join-qr"
    >
      <rect x="0" y="0" width={paths.size} height={paths.size} fill="#ffffff" />
      <path d={paths.d} fill="#12232d" />
    </svg>
  );
}
