import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { ArduinoCodePanel } from '../electronics/ArduinoCodePanel';
import { NativeOpticalProvider } from '../electronics/NativeOpticalComponentVisual';
import { WorkbenchStage } from '../electronics/WorkbenchStage';
import { useCommittedObservation } from '../electronics/committed-result-presentation';
import { useElectronicsWorkbenchHost } from '../electronics/use-electronics-workbench';
import {
  createDefaultRoboticsProject,
  validateRoboticsBindings,
  type RoboticsProject,
} from './robotics-project';
import {
  advanceRoboticsWorld,
  createRoboticsWorldDocument,
  createRoboticsWorldState,
  measureRoboticsDistance,
  ROBOTICS_FIELD_PRESETS,
  ROBOTICS_RUN_LIMIT_MICROSECONDS,
  ROBOTICS_SENSOR_INTERVAL_MICROSECONDS,
  type RoboticsFieldPresetId,
} from './world';
import { useLocalRoboticsProject } from './use-local-robotics-project';
import { RobotField } from './RobotField';

const WORKBENCH_OPTIONS = {
  runtimeInputEventLimit: 1000,
  reportSimulationDiagnostics: false,
} as const;
const number = (value: number, digits = 1) =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const FUTURE_MODULES = ['Драйвер с реверсом', 'Датчик цвета', 'Датчик линии', 'Энкодер'];

function SmallIcon({ name }: { name: 'play' | 'pause' | 'reset' | 'code' | 'save' | 'stop' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="robotics-icon">
      {name === 'play' ? <path d="m8 5 11 7-11 7V5Z" fill="currentColor" /> : null}
      {name === 'pause' ? <path d="M7 5v14M17 5v14" stroke="currentColor" strokeWidth="4" /> : null}
      {name === 'stop' ? (
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
      ) : null}
      {name === 'reset' ? (
        <path
          d="M5 9a8 8 0 1 1-.5 5M5 3v6h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'code' ? (
        <path
          d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'save' ? (
        <path
          d="M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

export function RoboticsLab({ initialProject }: { initialProject?: RoboticsProject }) {
  const [seed] = useState(() => initialProject ?? createDefaultRoboticsProject());
  const local = useLocalRoboticsProject(seed);
  const controller = useElectronicsWorkbenchHost(
    'asa-robotics-local-v1',
    local.host,
    WORKBENCH_OPTIONS,
  );
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const observation = useCommittedObservation(controller.nativeOpticalPresentation);
  const pace = useSyncExternalStore(
    controller.simulationPacing.subscribe,
    controller.simulationPacing.read,
    controller.simulationPacing.read,
  );
  const sourceWorld = local.robotProject.world;
  const [worldState, setWorldState] = useState(() => createRoboticsWorldState(sourceWorld));
  const worldRef = useRef(worldState);
  const processedObservation = useRef<typeof observation>(null);
  const lastSensorAt = useRef(0);
  const [haltReason, setHaltReason] = useState<string | null>(null);
  const haltedRef = useRef<string | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeMounted, setCodeMounted] = useState(false);
  const [codeWidth, setCodeWidth] = useState(() =>
    Math.max(320, Math.min(1456, window.innerWidth - 74)),
  );
  const [codeHeight, setCodeHeight] = useState(70);
  const codeSectionRef = useRef<HTMLElement | null>(null);
  const codeHostRef = useRef<HTMLDivElement | null>(null);
  const codeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousRun = useRef(false);
  const previousWorld = useRef(sourceWorld);

  const resetWorld = useCallback(() => {
    const next = createRoboticsWorldState(local.getCurrentProject().world);
    worldRef.current = next;
    processedObservation.current = null;
    lastSensorAt.current = 0;
    haltedRef.current = null;
    setWorldState(next);
    setHaltReason(null);
    setLastCommand(null);
  }, [local.getCurrentProject]);

  useLayoutEffect(() => {
    if (
      (controller.simulationRunning && !previousRun.current) ||
      (!controller.simulationRunning && previousWorld.current !== sourceWorld)
    )
      resetWorld();
    previousRun.current = controller.simulationRunning;
    previousWorld.current = sourceWorld;
  }, [controller.simulationRunning, sourceWorld, resetWorld]);

  useEffect(() => {
    // Presentation-only fitting. Physical component dimensions and world time
    // stay unchanged, and the shared stage remains mounted throughout.
    const frame = window.requestAnimationFrame(() => controllerRef.current.fitScene());
    return () => window.cancelAnimationFrame(frame);
  }, [local.openRevision]);

  const halt = useCallback((message: string) => {
    if (haltedRef.current) return;
    haltedRef.current = message;
    setHaltReason(message);
    if (controllerRef.current.simulationRunning) controllerRef.current.setSimulationRate(0);
  }, []);

  useEffect(() => {
    const current = controllerRef.current;
    if (!current.simulationRunning || current.simulationStatus !== 'running' || !observation)
      return;
    if (processedObservation.current === observation) return;
    const time = observation.frame.atMicroseconds;
    // The shared Arduino reset starts a new canonical generation at zero.
    if (time < worldRef.current.atMicroseconds) resetWorld();
    processedObservation.current = observation;
    if (haltedRef.current) return;
    const result = observation.result;
    if (!result.solved || result.status !== 'solved' || result.quality?.passed !== true) {
      halt('Расчёт схемы не дал достоверного результата. Проверьте электронику и сбросьте запуск.');
      return;
    }
    const bindings = sourceWorld.bindings;
    const leftRpm = result.components.find(
      (part) => part.componentId === bindings.leftMotorId,
    )?.outputRpm;
    const rightRpm = result.components.find(
      (part) => part.componentId === bindings.rightMotorId,
    )?.outputRpm;
    if (
      leftRpm === undefined ||
      rightRpm === undefined ||
      !Number.isFinite(leftRpm) ||
      !Number.isFinite(rightRpm)
    ) {
      halt('Нет достоверных оборотов одного из двигателей. Проверьте схему и привязки робота.');
      return;
    }
    const next = advanceRoboticsWorld(sourceWorld, worldRef.current, {
      atMicroseconds: time,
      leftRpm,
      rightRpm,
    });
    worldRef.current = next;
    setWorldState(next);
    if (next.haltReason) {
      halt(next.haltReason);
      return;
    }
    if (time >= ROBOTICS_RUN_LIMIT_MICROSECONDS) {
      halt(
        'Демонстрация завершена: 40 секунд модельного времени. Нажмите «Сбросить» для нового запуска.',
      );
      return;
    }
    // Sampling follows only committed source time. A pause may finish one
    // committed presentation frame, but must not create another sensor input.
    if (
      pace.phase !== 'running' ||
      time - lastSensorAt.current < ROBOTICS_SENSOR_INTERVAL_MICROSECONDS
    )
      return;
    const measured = measureRoboticsDistance(sourceWorld, next.pose);
    if (measured.status !== 'ok') {
      halt(measured.message);
      return;
    }
    if (!current.setRuntimeSensorDistance(bindings.distanceSensorId, measured.distanceMeters)) {
      halt('Не удалось передать расстояние датчику. Проверьте схему и сбросьте запуск.');
      return;
    }
    lastSensorAt.current = time;
  }, [
    observation,
    controller.simulationRunning,
    controller.simulationStatus,
    sourceWorld,
    pace.phase,
    halt,
    resetWorld,
  ]);

  const budget = controller.runtimeInputBudget;
  useEffect(() => {
    if (
      controller.simulationRunning &&
      controller.simulationStatus === 'running' &&
      budget?.exhausted
    )
      halt(
        'Достигнут лимит вводов этого запуска. Нажмите «Сбросить», чтобы начать новую демонстрацию.',
      );
  }, [budget?.exhausted, controller.simulationRunning, controller.simulationStatus, halt]);

  const distance = useMemo(
    () => measureRoboticsDistance(sourceWorld, worldState.pose),
    [sourceWorld, worldState.pose],
  );
  const bindingError = validateRoboticsBindings(local.robotProject);
  const running = controller.simulationRunning;
  const starting = running && controller.simulationStatus === 'starting';
  const paused = running && pace.phase === 'paused';
  const pausing = running && pace.phase === 'pausing';
  const primaryLabel = !running
    ? 'Запустить'
    : starting
      ? 'Запускается…'
      : paused
        ? 'Продолжить'
        : pausing
          ? 'Пауза…'
          : 'Пауза';
  const messages = [
    ...new Set(
      [controller.simulationMessage?.text, haltReason, bindingError, controller.notice].filter(
        (message): message is string => Boolean(message),
      ),
    ),
  ];
  const preset = ROBOTICS_FIELD_PRESETS.find(
    (item) =>
      item.widthMeters === sourceWorld.field.widthMeters &&
      item.heightMeters === sourceWorld.field.heightMeters,
  );
  const obstacle = sourceWorld.field.obstacles[0];

  function primaryAction() {
    if (!running) {
      controller.setSimulationRate(1);
      void controller.toggleSimulation();
    } else if (paused) controller.setSimulationRate(pace.lastNonZero);
    else controller.setSimulationRate(0);
  }
  function reset() {
    controller.resetSimulation();
    resetWorld();
  }
  function sendCommand(command: 'F' | 'L' | 'R' | 'S', label: string) {
    if (!running || starting || pace.phase !== 'running' || haltedRef.current) return;
    controller.sendArduinoSerialRx(sourceWorld.bindings.boardId, command);
    setLastCommand(label);
  }
  function changePreset(value: string) {
    const selected = ROBOTICS_FIELD_PRESETS.find((item) => item.id === value);
    if (!selected) return;
    const next = createRoboticsWorldDocument(selected.id as RoboticsFieldPresetId);
    local.setWorld({ ...sourceWorld, field: next.field, initialPose: next.initialPose });
  }
  function changeObstacle(xMeters: number) {
    if (!obstacle || !Number.isFinite(xMeters)) return;
    local.setWorld({
      ...sourceWorld,
      field: {
        ...sourceWorld.field,
        obstacles: sourceWorld.field.obstacles.map((item) =>
          item.id === obstacle.id ? { ...item, xMeters } : item,
        ),
      },
    });
  }
  function openSaved() {
    if (
      controller.saveStatus !== 'saved' &&
      !window.confirm('Открыть сохранённый проект? Несохранённые изменения будут заменены.')
    )
      return;
    local.openSavedProject();
  }
  function openCode() {
    setCodeMounted(true);
    setCodeOpen((value) => !value);
  }
  useEffect(() => {
    if (!codeOpen) return;
    codeSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [codeOpen]);
  useLayoutEffect(() => {
    if (!codeOpen || !codeHostRef.current) return;
    const host = codeHostRef.current;
    const measure = () => {
      if (host.clientWidth > 0) setCodeWidth(host.clientWidth);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [codeOpen]);

  return (
    <main
      className="robotics-lab"
      data-testid="robotics-lab"
      data-input-admitted={budget?.admitted ?? 0}
      data-input-accepted={budget?.accepted ?? 0}
      data-input-pending={budget?.pending ?? 0}
      data-input-inflight={budget?.inFlight ?? 0}
      data-input-exhausted={budget?.exhausted ?? false}
    >
      <header className="robotics-header">
        <div className="robotics-brand">
          <span className="robotics-brand-mark" aria-hidden="true">
            A<span>·</span>
          </span>
          <div>
            <span className="robotics-eyebrow">ASA LAB</span>
            <h1>
              Робототехника <span className="robotics-mode-badge">2D</span>
            </h1>
          </div>
        </div>
        <div className="robotics-save-area">
          <span className={`robotics-save-status ${controller.saveStatus}`} role="status">
            {controller.saveStatus === 'saved'
              ? 'Сохранено на устройстве'
              : controller.saveStatus === 'error'
                ? 'Не удалось сохранить'
                : 'Есть несохранённые изменения'}
          </span>
          <div className="robotics-save-buttons">
            <button
              type="button"
              className="robotics-button"
              onClick={() => void controller.saveNow()}
            >
              <SmallIcon name="save" />
              Сохранить
            </button>
            <button
              type="button"
              className="robotics-button subtle"
              disabled={running || !local.hasSavedProject}
              onClick={openSaved}
            >
              Открыть сохранённое
            </button>
          </div>
        </div>
      </header>

      <section className="robotics-run-bar" aria-label="Управление моделированием">
        <div className="robotics-run-buttons">
          <button
            type="button"
            className="robotics-button primary"
            onClick={primaryAction}
            disabled={
              starting || pausing || Boolean(bindingError) || (running && Boolean(haltReason))
            }
          >
            <SmallIcon name={running && !paused ? 'pause' : 'play'} />
            {primaryLabel}
          </button>
          <button
            type="button"
            className="robotics-button"
            disabled={!running}
            onClick={() => void controller.toggleSimulation()}
          >
            <SmallIcon name="stop" />
            Остановить
          </button>
          <button type="button" className="robotics-button" onClick={reset}>
            <SmallIcon name="reset" />
            Сбросить
          </button>
        </div>
        <div className={`robotics-run-state${running && !paused && !haltReason ? ' active' : ''}`}>
          <span className="robotics-state-dot" aria-hidden="true" />
          {haltReason
            ? 'Остановлено — требуется сброс'
            : starting
              ? 'Запускаем схему'
              : paused
                ? 'На паузе'
                : pausing
                  ? 'Завершаем шаг'
                  : running
                    ? 'Программа выполняется'
                    : 'Готов к запуску'}
        </div>
      </section>

      <div
        className="robotics-notice"
        data-testid="robotics-notice"
        role="status"
        aria-live="polite"
        hidden={messages.length === 0}
      >
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>

      <div className="robotics-dashboard">
        <section
          className="robotics-card robotics-field-card"
          aria-labelledby="robotics-field-heading"
        >
          <div className="robotics-card-heading">
            <div>
              <h2 id="robotics-field-heading">Поле</h2>
              <p>Робот, препятствие и путь</p>
            </div>
            <label className="robotics-grid-toggle">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(event) => setShowGrid(event.target.checked)}
              />
              Сетка
            </label>
          </div>
          <div className="robotics-field-controls">
            <label htmlFor="robotics-field-preset">Размер поля</label>
            <select
              id="robotics-field-preset"
              value={preset?.id ?? ''}
              disabled={running}
              onChange={(event) => changePreset(event.target.value)}
            >
              {!preset ? <option value="">Свой размер</option> : null}
              {ROBOTICS_FIELD_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="robotics-field-canvas">
            <RobotField
              world={sourceWorld}
              state={worldState}
              distance={distance}
              showGrid={showGrid}
            />
          </div>
          <div className="robotics-field-legend">
            <span>
              <i className="robotics-legend-ray" />
              Луч HC-SR04
            </span>
            <span>
              <i className="robotics-legend-trail" />
              След робота
            </span>
            <span>Клетка {Math.round(sourceWorld.field.gridMeters * 100)} см</span>
          </div>
          {obstacle ? (
            <label className="robotics-obstacle-control">
              <span>
                Положение препятствия <output>{number(obstacle.xMeters * 100, 0)} см</output>
              </span>
              <input
                type="range"
                aria-label="Положение препятствия"
                min={0.5}
                max={sourceWorld.field.widthMeters - obstacle.widthMeters - 0.04}
                step={0.01}
                value={obstacle.xMeters}
                disabled={running}
                onChange={(event) => changeObstacle(Number(event.target.value))}
              />
            </label>
          ) : null}
        </section>

        <aside className="robotics-console" aria-label="Показания и конфигурация робота">
          <section className="robotics-card robotics-telemetry">
            <div className="robotics-card-heading">
              <h2>Показания</h2>
              <span className="robotics-small-badge">HC-SR04</span>
            </div>
            <dl className="robotics-metrics">
              <div className="robotics-metric distance">
                <dt>До препятствия</dt>
                <dd
                  data-testid="robotics-distance"
                  data-distance-meters={distance.status === 'ok' ? distance.distanceMeters : ''}
                >
                  {distance.status === 'ok' ? (
                    <>
                      {number(distance.distanceMeters * 100)} <small>см</small>
                    </>
                  ) : (
                    'Вне диапазона'
                  )}
                </dd>
              </div>
              <div className="robotics-metric">
                <dt>Модельное время</dt>
                <dd data-testid="robotics-time" data-microseconds={worldState.atMicroseconds}>
                  {number(worldState.atMicroseconds / 1_000_000)} <small>с</small>
                </dd>
              </div>
              <div className="robotics-metric">
                <dt>Левый мотор</dt>
                <dd data-testid="robotics-left-rpm" data-rpm={worldState.leftRpm}>
                  {number(worldState.leftRpm, 0)} <small>об/мин</small>
                </dd>
              </div>
              <div className="robotics-metric">
                <dt>Правый мотор</dt>
                <dd data-testid="robotics-right-rpm" data-rpm={worldState.rightRpm}>
                  {number(worldState.rightRpm, 0)} <small>об/мин</small>
                </dd>
              </div>
            </dl>
          </section>
          <section className="robotics-card robotics-drive">
            <div className="robotics-card-heading">
              <div>
                <h2>Команды</h2>
                <p>В программу через Serial</p>
              </div>
            </div>
            <div className="robotics-drive-pad">
              <button
                type="button"
                className="forward"
                disabled={!running || starting || pace.phase !== 'running' || Boolean(haltReason)}
                onClick={() => sendCommand('F', 'Вперёд')}
              >
                <span aria-hidden="true">↑</span>Вперёд
              </button>
              <button
                type="button"
                disabled={!running || starting || pace.phase !== 'running' || Boolean(haltReason)}
                onClick={() => sendCommand('L', 'Влево')}
              >
                <span aria-hidden="true">↶</span>Влево
              </button>
              <button
                type="button"
                className="motor-stop"
                disabled={!running || starting || pace.phase !== 'running' || Boolean(haltReason)}
                onClick={() => sendCommand('S', 'Отключить приводы')}
              >
                <span aria-hidden="true">■</span>Выбег
              </button>
              <button
                type="button"
                disabled={!running || starting || pace.phase !== 'running' || Boolean(haltReason)}
                onClick={() => sendCommand('R', 'Вправо')}
              >
                <span aria-hidden="true">↷</span>Вправо
              </button>
            </div>
            <p className="robotics-command-status">
              {paused || pausing
                ? 'Продолжите программу, чтобы отправить команду.'
                : lastCommand
                  ? `Отправлено: ${lastCommand}`
                  : running
                    ? 'Программа управляет приводами.'
                    : 'Сначала запустите программу.'}
            </p>
            <p className="robotics-help">
              Скетч реагирует на расстояние. После отключения питания колёса продолжают свободный
              выбег.
            </p>
          </section>
          <details className="robotics-card robotics-configuration">
            <summary>Сборка · двухколёсная тележка</summary>
            <dl>
              <div>
                <dt>Плата</dt>
                <dd>Arduino Uno</dd>
              </div>
              <div>
                <dt>Колёса</dt>
                <dd>Ø {number(sourceWorld.robot.wheelRadiusMeters * 2000, 0)} мм</dd>
              </div>
              <div>
                <dt>Колея</dt>
                <dd>{number(sourceWorld.robot.wheelTrackMeters * 1000, 0)} мм</dd>
              </div>
              <div>
                <dt>Привод</dt>
                <dd>Два FET-ключа · вперёд и поворот</dd>
              </div>
            </dl>
            <p className="robotics-help">
              Первый учебный пресет. Контакт останавливает демонстрацию; нагрузка от столкновения на
              мотор пока не рассчитывается.
            </p>
            <h3>Arduino · будущие модули</h3>
            <ul className="robotics-future-modules">
              {FUTURE_MODULES.map((label) => (
                <li key={label}>
                  <span className="robotics-module-placeholder" aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>Модель ещё не подключена</small>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </aside>
      </div>

      <section
        className="robotics-card robotics-electronics"
        aria-labelledby="robotics-electronics-heading"
      >
        <div className="robotics-card-heading robotics-schematic-heading">
          <div>
            <h2 id="robotics-electronics-heading">Электроника робота</h2>
            <p>Настоящая схема и редактор ASA Lab</p>
          </div>
          <div className="robotics-schematic-actions">
            <button type="button" className="robotics-button" onClick={controller.fitScene}>
              Вписать схему
            </button>
            <button
              ref={codeButtonRef}
              type="button"
              className={`robotics-button${codeOpen ? ' selected' : ''}`}
              aria-expanded={codeOpen}
              aria-controls="robotics-program"
              onClick={openCode}
            >
              <SmallIcon name="code" />
              Программа
            </button>
          </div>
        </div>
        <div className="robotics-edit-actions" aria-label="Редактирование схемы">
          <button type="button" disabled={running || !controller.canUndo} onClick={controller.undo}>
            Отменить
          </button>
          <button type="button" disabled={running || !controller.canRedo} onClick={controller.redo}>
            Повторить
          </button>
          <button
            type="button"
            disabled={running || !controller.selection}
            onClick={controller.removeSelection}
          >
            Удалить выбранное
          </button>
          <span>
            {running
              ? 'Для изменения схемы остановите моделирование.'
              : 'Соединяйте выводы и редактируйте схему обычными инструментами.'}
          </span>
        </div>
        <NativeOpticalProvider port={controller.nativeOpticalPresentation}>
          <div className="workbench-shell library-collapsed robotics-workbench">
            <div className="workbench-main">
              <WorkbenchStage controller={controller} showGrid={showGrid} />
            </div>
          </div>
        </NativeOpticalProvider>
      </section>

      {codeMounted ? (
        <section
          id="robotics-program"
          ref={codeSectionRef}
          className="robotics-card robotics-program"
          hidden={!codeOpen}
          aria-labelledby="robotics-program-heading"
        >
          <div className="robotics-card-heading">
            <div>
              <h2 id="robotics-program-heading">Программа Arduino</h2>
              <p>Общие блоки, C++ и монитор порта</p>
            </div>
            <button
              type="button"
              className="robotics-button subtle"
              onClick={() => {
                setCodeOpen(false);
                codeButtonRef.current?.focus();
              }}
            >
              Закрыть программу
            </button>
          </div>
          <div
            ref={codeHostRef}
            className="workbench-shell robotics-program-shell"
            style={
              {
                '--arduino-code-panel-width': `${codeWidth}px`,
                '--robotics-code-height': `${codeHeight}vh`,
              } as CSSProperties
            }
          >
            <ArduinoCodePanel
              controller={controller}
              open={codeOpen}
              drawerWidth={codeWidth}
              onDrawerWidthChange={(width) =>
                setCodeWidth(Math.max(460, Math.min(width, window.innerWidth - 32)))
              }
              mobileHeightPercent={codeHeight}
              onMobileHeightChange={(height) => setCodeHeight(Math.max(45, Math.min(height, 90)))}
              onClose={() => {
                setCodeOpen(false);
                codeButtonRef.current?.focus();
              }}
            />
          </div>
        </section>
      ) : null}
      <footer className="robotics-footer">
        <span>ASA Lab Robotics · первый рабочий пресет</span>
        <span>Один запуск — до 40 секунд модельного времени</span>
      </footer>
    </main>
  );
}
