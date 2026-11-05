import { useRef, useState } from 'react';
import type { PublicRoboticsArtifact } from '@asa-lab/contracts';
import { RobotField } from '../robotics/RobotField';
import './public-robotics.css';

const ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3] as const;

export function PublicRoboticsViewer({
  artifact,
}: {
  readonly artifact: PublicRoboticsArtifact;
}): JSX.Element {
  const [view, setView] = useState<'field' | 'robot'>('field');
  const [zoomIndex, setZoomIndex] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const zoom = ZOOM_LEVELS[zoomIndex]!;
  function fit(): void {
    setZoomIndex(0);
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
  }
  function changeView(next: 'field' | 'robot'): void {
    setView(next);
    fit();
  }
  return (
    <section
      className="public-robotics-viewer"
      aria-label="Просмотр опубликованного робота"
      data-testid="public-robotics-viewer"
      data-revision-number={artifact.provenance.revisionNumber}
    >
      <div className="public-robotics-tools">
        <div role="group" aria-label="Вид робота">
          <button type="button" aria-pressed={view === 'field'} onClick={() => changeView('field')}>
            Поле
          </button>
          <button type="button" aria-pressed={view === 'robot'} onClick={() => changeView('robot')}>
            Конструкция
          </button>
        </div>
        <div role="group" aria-label="Масштаб просмотра">
          <button
            type="button"
            aria-label="Отдалить поле"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
          >
            −
          </button>
          <output aria-label="Текущий масштаб">{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            aria-label="Приблизить поле"
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            onClick={() => setZoomIndex((index) => Math.min(ZOOM_LEVELS.length - 1, index + 1))}
          >
            +
          </button>
          <button type="button" onClick={fit}>
            Показать целиком
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={showGrid}
            disabled={view === 'robot'}
            onChange={(event) => setShowGrid(event.target.checked)}
          />
          Сетка
        </label>
      </div>
      <div
        ref={viewport}
        className="public-robotics-stage"
        data-testid="public-robotics-stage"
        role="region"
        aria-label="Поле робота: масштаб кнопками, перемещение прокруткой"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Home') {
            event.preventDefault();
            fit();
          } else if (['+', '=', '-'].includes(event.key)) {
            event.preventDefault();
            setZoomIndex((index) =>
              Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + (event.key === '-' ? -1 : 1))),
            );
          }
        }}
      >
        <div
          className="public-robotics-scene"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        >
          <RobotField
            world={artifact.world}
            showGrid={showGrid}
            view={view}
            testIdPrefix="public-robotics"
          />
        </div>
      </div>
      <p className="public-robotics-caption">
        Опубликованная версия {artifact.provenance.revisionNumber}. Сохранённое поле и конструкция
        робота. При увеличении поле можно прокручивать.
      </p>
    </section>
  );
}
