import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  classroomArduinoPrograms,
  useArduinoProgramPreview,
} from '../components/ClassroomExactArduinoSource';
import {
  productionLibraryReady,
  loadProductionLibrary,
} from '../electronics/production-manifest-adapter';
import { RoboticsFieldViewer } from '../projects-public/PublicRoboticsViewer';
import {
  parseRoboticsProject,
  validateRoboticsBindings,
  type RoboticsProject,
} from './robotics-project';
import { startRoboticsPreview } from './robotics-preview-playback';
import { measureRoboticsDistance, type RoboticsWorldState } from './world';

export default function RoboticsProjectViewer({
  document,
  sessionId,
  fallback,
}: {
  readonly document: unknown;
  readonly sessionId: string;
  readonly fallback: ReactNode;
}) {
  const parsed = useMemo(() => parseRoboticsProject(document), [document]);
  if (!parsed.ok)
    return (
      <>
        <p role="status">{parsed.message}</p>
        {fallback}
      </>
    );
  return <SavedRobot key={sessionId} project={parsed.project} sessionId={sessionId} />;
}

function SavedRobot({ project, sessionId }: { project: RoboticsProject; sessionId: string }) {
  const [catalog, setCatalog] = useState<'ready' | 'loading' | 'error'>(() =>
    productionLibraryReady() ? 'ready' : 'loading',
  );
  const [running, setRunning] = useState(false);
  const [frame, setFrame] = useState<RoboticsWorldState | null>(null);
  const [message, setMessage] = useState('');
  const playback = useRef<ReturnType<typeof startRoboticsPreview> | null>(null);
  const boards = useMemo(() => classroomArduinoPrograms(project.circuit), [project.circuit]);
  const program = useArduinoProgramPreview(boards);
  useEffect(() => {
    if (productionLibraryReady()) {
      setCatalog('ready');
      return;
    }
    let mounted = true;
    void loadProductionLibrary().then(
      () => {
        if (mounted) setCatalog(productionLibraryReady() ? 'ready' : 'error');
      },
      () => {
        if (mounted) setCatalog('error');
      },
    );
    return () => {
      mounted = false;
    };
  }, []);
  const bindingError = catalog === 'ready' ? validateRoboticsBindings(project) : null;
  useEffect(() => {
    if (!running) return;
    const stop = (reason: string) => {
      setRunning(false);
      setMessage(reason);
    };
    try {
      playback.current = startRoboticsPreview(project, sessionId, setFrame, stop);
    } catch {
      stop('Не удалось запустить моделирование робота.');
    }
    const blur = () => stop('Просмотр остановлен при потере фокуса.');
    const hide = () => {
      if (document.hidden) stop('Просмотр остановлен в фоновой вкладке.');
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hide);
    return () => {
      playback.current?.dispose();
      playback.current = null;
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [project, running, sessionId]);
  const feedback =
    bindingError ?? (catalog === 'error' ? 'Не удалось загрузить компоненты робота.' : message);
  return (
    <>
      <RoboticsFieldViewer
        world={project.world}
        label="Просмотр сохранённого робота"
        testIdPrefix="classroom-robotics"
        {...(frame
          ? {
              state: frame,
              distance: measureRoboticsDistance(
                project.world,
                frame.pose,
                frame.balls,
                frame.bodies,
              ),
            }
          : {})}
        onKeyDown={program.onKeyDown}
        controls={
          <>
            <button
              type="button"
              data-testid="classroom-robotics-start"
              disabled={catalog !== 'ready' || Boolean(bindingError)}
              onClick={() => {
                setMessage('');
                if (!running) setFrame(null);
                setRunning(!running);
              }}
            >
              {running ? 'Остановить' : 'Запустить'}
            </button>
            {program.button}
            {frame && (
              <output aria-label="Время моделирования" data-microseconds={frame.atMicroseconds}>
                {(frame.atMicroseconds / 1_000_000).toLocaleString('ru-RU', {
                  maximumFractionDigits: 1,
                })}{' '}
                с
              </output>
            )}
          </>
        }
        program={program.panel}
      />
      {running && frame && (
        <div
          className="robotics-preview-commands"
          role="group"
          aria-label="Команды роботу через Serial"
        >
          {(
            [
              ['F', 'Вперёд'],
              ['L', 'Влево'],
              ['R', 'Вправо'],
              ['S', 'Стоп'],
            ] as const
          ).map(([command, label]) => (
            <button
              type="button"
              key={command}
              className="btn-secondary"
              onClick={() => playback.current?.sendSerial(command)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {feedback && (
        <p className="robotics-preview-message" role="status">
          {feedback}
        </p>
      )}
    </>
  );
}
