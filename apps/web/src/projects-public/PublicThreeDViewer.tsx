import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicThreeDArtifact } from '@asa-lab/contracts';
import { ThreeDPresentation, type ThreeDPresentationHandle } from '../three-d/ThreeDPresentation';
import { publicThreeDDocument } from '../three-d/public-three-d-document';

export function PublicThreeDViewer({
  artifact,
  fallback,
}: {
  readonly artifact: PublicThreeDArtifact;
  readonly fallback: ReactNode;
}): JSX.Element {
  const document = useMemo(() => publicThreeDDocument(artifact), [artifact]);
  const view = useRef<ThreeDPresentationHandle>(null),
    section = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <section
      ref={section}
      className="public-three-d-viewer"
      aria-label="Интерактивная 3D-модель"
      data-testid="public-three-d-viewer"
    >
      <div className="public-three-d-tools" aria-label="Управление просмотром 3D">
        <button
          type="button"
          aria-label="Повернуть модель влево"
          title="Повернуть влево"
          onClick={() => view.current?.rotate(12, 0)}
        >
          ↶
        </button>
        <button
          type="button"
          aria-label="Повернуть модель вправо"
          title="Повернуть вправо"
          onClick={() => view.current?.rotate(-12, 0)}
        >
          ↷
        </button>
        <button
          type="button"
          aria-label="Приблизить модель"
          title="Приблизить"
          onClick={() => view.current?.zoom(1)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Отдалить модель"
          title="Отдалить"
          onClick={() => view.current?.zoom(-1)}
        >
          −
        </button>
        <button type="button" onClick={() => view.current?.fit()}>
          Исходный вид
        </button>
        <button
          type="button"
          aria-label="Развернуть 3D-модель на весь экран"
          title="На весь экран"
          onClick={() => {
            void section.current?.requestFullscreen?.().catch(() => {});
          }}
        >
          ⛶
        </button>
      </div>
      <div
        className="public-three-d-stage"
        data-ready={ready && !failed}
        onKeyDown={(event) => {
          if (!(event.target instanceof HTMLCanvasElement)) return;
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [12, 0],
            ArrowRight: [-12, 0],
            ArrowUp: [0, 10],
            ArrowDown: [0, -10],
          };
          const delta = directions[event.key];
          if (delta) {
            event.preventDefault();
            view.current?.rotate(...delta);
          } else if (['+', '=', '-', 'Home'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Home') view.current?.fit();
            else view.current?.zoom(event.key === '-' ? -1 : 1);
          }
        }}
      >
        {!failed && (
          <ThreeDPresentation
            ref={view}
            document={document}
            onReady={() => setReady(true)}
            onError={() => setFailed(true)}
          />
        )}
        <div className="public-three-d-fallback" hidden={ready && !failed}>
          {fallback}
        </div>
      </div>
      {failed && (
        <p role="status">Не удалось запустить 3D-просмотр. Показано сохранённое изображение.</p>
      )}
    </section>
  );
}
