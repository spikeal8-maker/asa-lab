import { useEffect, useRef, useState } from 'react';

/** Credentials are rendered only after an explicit reveal, never in hidden attributes. */
export function StudentCodeButton({
  code,
  showAll,
  epoch,
  onEdit,
  onCopied,
  onDenied,
  label = 'код ученика',
  className = '',
}: {
  code: string | null;
  showAll: boolean;
  epoch: number;
  onEdit?: () => void;
  onCopied: () => void;
  onDenied: () => void;
  label?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedVisible = useRef(false);
  const live = useRef(0);
  const visible = Boolean(code && (showAll || revealed === code));
  useEffect(() => {
    setRevealed(null);
    live.current++;
    return () => {
      live.current++;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [code, epoch]);
  async function revealAndCopy() {
    if (!code) return;
    setRevealed(code);
    const generation = live.current;
    try {
      await navigator.clipboard.writeText(code);
      if (generation === live.current) onCopied();
    } catch {
      if (generation === live.current) onDenied();
    }
  }
  return (
    <button
      type="button"
      className={className || 'classroom-login-handle'}
      disabled={!code}
      aria-label={visible ? `Копировать ${label}` : `Показать и скопировать ${label}`}
      aria-pressed={visible}
      title={
        visible
          ? onEdit
            ? 'Копировать; двойной клик или F2 — изменить код'
            : 'Копировать код'
          : 'Показать и скопировать код'
      }
      onKeyDown={(event) => {
        if (event.key === 'F2' && onEdit) {
          event.preventDefault();
          if (timer.current !== null) clearTimeout(timer.current);
          onEdit();
        }
      }}
      onClick={(event) => {
        if (event.detail > 1) {
          if (timer.current !== null) clearTimeout(timer.current);
          return;
        }
        startedVisible.current = visible;
        if (event.detail === 0 || !visible || !onEdit) void revealAndCopy();
        else
          timer.current = setTimeout(() => {
            timer.current = null;
            void revealAndCopy();
          }, 500);
      }}
      onDoubleClick={() => {
        if (timer.current !== null) clearTimeout(timer.current);
        if (startedVisible.current) onEdit?.();
      }}
    >
      {visible ? code : '******'}
    </button>
  );
}
