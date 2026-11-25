import { useMemo, useRef, useState, type ReactNode } from 'react';
import { parseThreeDDocument } from '@asa-lab/three-d/document';
import { ThreeDPresentation, type ThreeDPresentationHandle } from '../three-d/ThreeDPresentation';

export interface ClassroomExactThreeDViewerProps {
  readonly document: unknown;
  readonly fallback: ReactNode;
}

export default function ClassroomExactThreeDViewer({
  document,
  fallback,
}: ClassroomExactThreeDViewerProps): JSX.Element {
  const parsed = useMemo(() => parseThreeDDocument(document), [document]);
  const view = useRef<ThreeDPresentationHandle>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  if (!parsed.ok || status === 'failed') {
    return (
      <>
        <p role="status">Не удалось запустить 3D-просмотр.</p>
        {fallback}
      </>
    );
  }

  const ready = status === 'ready';
  return (
    <section aria-label="Сданная 3D-модель" className="gradebook-three-d-view" data-ready={ready}>
      <div className="gradebook-three-d-tools" role="group" aria-label="Управление 3D-просмотром">
        <button
          type="button"
          className="btn-secondary"
          aria-label="Повернуть модель влево"
          disabled={!ready}
          onClick={() => view.current?.rotate(12, 0)}
        >
          ↶
        </button>
        <button
          type="button"
          className="btn-secondary"
          aria-label="Повернуть модель вправо"
          disabled={!ready}
          onClick={() => view.current?.rotate(-12, 0)}
        >
          ↷
        </button>
        <button
          type="button"
          className="btn-secondary"
          aria-label="Приблизить модель"
          disabled={!ready}
          onClick={() => view.current?.zoom(1)}
        >
          +
        </button>
        <button
          type="button"
          className="btn-secondary"
          aria-label="Отдалить модель"
          disabled={!ready}
          onClick={() => view.current?.zoom(-1)}
        >
          −
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!ready}
          onClick={() => view.current?.fit()}
        >
          Исходный вид
        </button>
      </div>
      <div
        className="gradebook-three-d-stage"
        onKeyDown={(event) => {
          if (!(event.target instanceof HTMLCanvasElement)) return;
          const scene = view.current;
          if (!scene) return;
          switch (event.key) {
            case 'ArrowLeft':
              scene.rotate(12, 0);
              break;
            case 'ArrowRight':
              scene.rotate(-12, 0);
              break;
            case 'ArrowUp':
              scene.rotate(0, 10);
              break;
            case 'ArrowDown':
              scene.rotate(0, -10);
              break;
            case '+':
            case '=':
              scene.zoom(1);
              break;
            case '-':
              scene.zoom(-1);
              break;
            case 'Home':
              scene.fit();
              break;
            default:
              return;
          }
          event.preventDefault();
        }}
      >
        <ThreeDPresentation
          ref={view}
          document={parsed.value}
          onReady={() => setStatus((current) => (current === 'failed' ? current : 'ready'))}
          onError={() => setStatus('failed')}
        />
        {!ready && <p role="status">Загружаем 3D-модель…</p>}
      </div>
    </section>
  );
}
