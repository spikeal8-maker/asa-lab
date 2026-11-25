import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';
import type { PublicRoboticsArtifact, PublicRoboticsArtifactV6 } from '@asa-lab/contracts';
import { RobotField, type RoboticsFieldGeometry } from '../robotics/RobotField';
import type { RoboticsWorldState, RoboticsDistanceMeasurement } from '../robotics/world';
import './public-robotics.css';

const ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3] as const;
const PLAYBACK_ZOOM_LEVELS = [...ZOOM_LEVELS, 5, 8];

export function PublicRoboticsViewer({
  artifact,
}: {
  readonly artifact: PublicRoboticsArtifact | PublicRoboticsArtifactV6;
}): JSX.Element {
  return (
    <RoboticsFieldViewer
      key={artifact.provenance.publicationId + ':' + artifact.provenance.revisionNumber}
      world={artifact.world}
      label="Просмотр опубликованного робота"
      testIdPrefix="public-robotics"
      revisionNumber={artifact.provenance.revisionNumber}
    />
  );
}

export function RoboticsFieldViewer({
  world,
  label,
  testIdPrefix,
  revisionNumber,
  controls,
  program,
  onKeyDown,
  state,
  distance,
}: {
  readonly world: RoboticsFieldGeometry;
  readonly label: string;
  readonly testIdPrefix: string;
  readonly revisionNumber?: number;
  readonly controls?: ReactNode;
  readonly program?: ReactNode;
  readonly onKeyDown?: KeyboardEventHandler<HTMLElement>;
  readonly state?: RoboticsWorldState;
  readonly distance?: RoboticsDistanceMeasurement;
}): JSX.Element {
  const [view, setView] = useState<'field' | 'robot'>('field');
  const interactive = Boolean(controls);
  const levels = interactive ? PLAYBACK_ZOOM_LEVELS : ZOOM_LEVELS;
  const desiredZoom =
    Math.min(world.field.widthMeters, world.field.heightMeters) /
    (5 * Math.max(world.robot.bodyLengthMeters, world.robot.bodyWidthMeters));
  const nearest = levels.findIndex((level) => level >= desiredZoom);
  const robotZoom = nearest < 0 ? levels.length - 1 : nearest;
  const [zoomIndex, setZoomIndex] = useState(interactive ? robotZoom : 0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const zoom = levels[zoomIndex]!;
  useLayoutEffect(() => {
    const stage = viewport.current;
    if (!stage || !interactive || view !== 'field' || zoom <= 1) return;
    function centerRobot() {
      if (!stage) return;
      const robot = stage.querySelector<SVGGElement>('g[data-object-kind="robot"]');
      const matrix = robot?.getScreenCTM();
      if (!matrix) return;
      const rect = stage.getBoundingClientRect();
      stage.scrollLeft += matrix.e - rect.left - stage.clientLeft - stage.clientWidth / 2;
      stage.scrollTop += matrix.f - rect.top - stage.clientTop - stage.clientHeight / 2;
    }
    centerRobot();
    const observer = new ResizeObserver(centerRobot);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [interactive, view, zoom, focusRequest]);
  function focusRobot(): void {
    setZoomIndex(robotZoom);
    setFocusRequest((request) => request + 1);
  }
  function fit(): void {
    setZoomIndex(0);
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
  }
  function changeView(next: 'field' | 'robot'): void {
    setView(next);
    if (interactive && next === 'field') focusRobot();
    else fit();
  }
  return (
    <section
      className="public-robotics-viewer"
      aria-label={label}
      data-testid={testIdPrefix + '-viewer'}
      data-revision-number={revisionNumber}
      onKeyDown={onKeyDown}
    >
      <div className="public-robotics-tools">
        {controls}
        {controls && (
          <button
            type="button"
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            Вид
          </button>
        )}
        <div
          className="public-robotics-options"
          id={optionsId}
          hidden={Boolean(controls) && !optionsOpen}
        >
          <div role="group" aria-label="Вид робота">
            <button
              type="button"
              aria-pressed={view === 'field'}
              onClick={() => changeView('field')}
            >
              Поле
            </button>
            <button
              type="button"
              aria-pressed={view === 'robot'}
              onClick={() => changeView('robot')}
            >
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
              disabled={zoomIndex === levels.length - 1}
              onClick={() => setZoomIndex((index) => Math.min(levels.length - 1, index + 1))}
            >
              +
            </button>
            {interactive && view === 'field' && (
              <button type="button" onClick={focusRobot}>
                К роботу
              </button>
            )}
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
      </div>
      <div
        ref={viewport}
        className="public-robotics-stage"
        data-testid={testIdPrefix + '-stage'}
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
              Math.max(0, Math.min(levels.length - 1, index + (event.key === '-' ? -1 : 1))),
            );
          }
        }}
      >
        <div
          className="public-robotics-scene"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        >
          <RobotField
            world={world}
            {...(state ? { state } : {})}
            {...(distance ? { distance } : {})}
            showGrid={showGrid}
            view={view}
            testIdPrefix={testIdPrefix}
          />
        </div>
      </div>
      {program}
    </section>
  );
}
