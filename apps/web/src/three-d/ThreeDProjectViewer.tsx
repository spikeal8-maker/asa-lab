import { useRef, useState, type ReactNode } from 'react';
import type { ThreeDDocument } from '@asa-lab/three-d';
import { FitIcon, RotateIcon, ZoomInIcon, ZoomOutIcon } from '../electronics/workbench-icons';
import { ScaleIcon } from './three-d-icons';
import { ThreeDPresentation, type ThreeDPresentationHandle } from './ThreeDPresentation';

export function ThreeDProjectViewer({
  document: model,
  label,
  fallback,
  testId,
  onReady,
  onUnavailable,
}: {
  readonly document: ThreeDDocument;
  readonly label: string;
  readonly fallback: ReactNode;
  readonly testId?: string;
  readonly onReady?: () => void;
  readonly onUnavailable?: () => void;
}): JSX.Element {
  const viewport = useRef<ThreeDPresentationHandle>(null);
  const section = useRef<HTMLElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [fullscreenError, setFullscreenError] = useState(false);
  const ready = state === 'ready';

  if (state === 'failed') {
    return (
      <>
        <p role="status">Не удалось запустить 3D-просмотр.</p>
        {fallback}
      </>
    );
  }
  return (
    <section
      ref={section}
      className="public-three-d-viewer"
      aria-label={label}
      data-testid={testId}
      data-ready={ready}
    >
      <div className="public-three-d-tools" role="group" aria-label="Управление 3D-просмотром">
        <button
          type="button"
          aria-label="Повернуть модель влево"
          title="Повернуть влево"
          disabled={!ready}
          onClick={() => viewport.current?.rotate(12, 0)}
        >
          <RotateIcon width={19} height={19} style={{ transform: 'scaleX(-1)' }} />
        </button>
        <button
          type="button"
          aria-label="Повернуть модель вправо"
          title="Повернуть вправо"
          disabled={!ready}
          onClick={() => viewport.current?.rotate(-12, 0)}
        >
          <RotateIcon width={19} height={19} />
        </button>
        <button
          type="button"
          aria-label="Приблизить модель"
          title="Приблизить"
          disabled={!ready}
          onClick={() => viewport.current?.zoom(1)}
        >
          <ZoomInIcon width={19} height={19} />
        </button>
        <button
          type="button"
          aria-label="Отдалить модель"
          title="Отдалить"
          disabled={!ready}
          onClick={() => viewport.current?.zoom(-1)}
        >
          <ZoomOutIcon width={19} height={19} />
        </button>
        <button
          type="button"
          className="project-playback-fit"
          aria-label="Исходный вид"
          title="Исходный вид"
          disabled={!ready}
          onClick={() => viewport.current?.fit()}
        >
          <span>Исходный вид</span>
          <FitIcon width={19} height={19} />
        </button>
        <button
          type="button"
          aria-label="Развернуть 3D-модель на весь экран"
          title="На весь экран"
          disabled={!ready}
          onClick={() => {
            const change = document.fullscreenElement
              ? document.exitFullscreen()
              : section.current?.requestFullscreen?.();
            if (change) void change.catch(() => setFullscreenError(true));
            else setFullscreenError(true);
          }}
        >
          <ScaleIcon width={19} height={19} />
        </button>
      </div>
      <div
        className="public-three-d-stage"
        data-ready={ready}
        onKeyDown={(event) => {
          if (!(event.target instanceof HTMLCanvasElement)) return;
          const scene = viewport.current;
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
          ref={viewport}
          document={model}
          onReady={() => {
            setState('ready');
            onReady?.();
          }}
          onError={() => {
            setState('failed');
            onUnavailable?.();
          }}
        />
        {!ready && <div className="public-three-d-fallback">{fallback}</div>}
      </div>
      {fullscreenError && <p role="status">Полноэкранный режим недоступен.</p>}
    </section>
  );
}
