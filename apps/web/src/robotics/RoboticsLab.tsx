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
import { ArduinoCodePanel, type ArduinoCodePanelHandle } from '../electronics/ArduinoCodePanel';
import { WorkbenchSidebars } from '../electronics/WorkbenchSidebars';
import { readArduinoProgramState } from '../electronics/arduino-program-state';
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
  createRoboticsWorldState,
  measureRoboticsDistance,
  ROBOTICS_RUN_LIMIT_MICROSECONDS,
  ROBOTICS_SENSOR_INTERVAL_MICROSECONDS,
} from './world';
import { useLocalRoboticsProject } from './use-local-robotics-project';
import { RobotField } from './RobotField';
import { RobotFieldEditor } from './RobotFieldEditor';
import { RobotAssemblyPanel } from './RobotAssemblyPanel';
import {
  createRoboticsProgramPreset,
  DEFAULT_ROBOTICS_PROGRAM_PRESET_ID,
  ROBOTICS_PROGRAM_PRESETS,
  type RoboticsProgramPresetId,
} from './robotics-program-presets';

const WORKBENCH_OPTIONS = {
  runtimeInputEventLimit: 1000,
  reportSimulationDiagnostics: false,
} as const;
const number = (value: number, digits = 1) =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const SECTIONS = [
  { id: 'field', label: 'Поле' },
  { id: 'robot', label: 'Робот' },
  { id: 'electronics', label: 'Электроника' },
  { id: 'program', label: 'Программа' },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

function programIdentity(project: RoboticsProject): string {
  return JSON.stringify(
    project.circuit.components
      .filter((component) => component.componentTypeId === 'arduino-uno')
      .map((component) => [component.id, readArduinoProgramState(component.stateProperties)]),
  );
}

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
  const [seed] = useState(
    () =>
      initialProject ??
      createDefaultRoboticsProject(createRoboticsProgramPreset(DEFAULT_ROBOTICS_PROGRAM_PRESET_ID)),
  );
  const [section, setSection] = useState<Section>('field');
  const [compactLayout, setCompactLayout] = useState(() => window.innerWidth <= 760);
  const local = useLocalRoboticsProject(seed);
  const controller = useElectronicsWorkbenchHost('asa-robotics-local-v1', local.host, {
    ...WORKBENCH_OPTIONS,
    keyboardShortcutsEnabled: section === 'electronics',
  });
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
  const codeOpen = section === 'program';
  const [codeMounted, setCodeMounted] = useState(false);
  const [codeWidth, setCodeWidth] = useState(() =>
    Math.max(320, Math.min(1456, window.innerWidth - 74)),
  );
  const [codeHeight, setCodeHeight] = useState(70);
  const programHandle = useRef<ArduinoCodePanelHandle | null>(null);
  const [programRevision, setProgramRevision] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [programPreset, setProgramPreset] = useState<RoboticsProgramPresetId | ''>('');
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const codeHostRef = useRef<HTMLDivElement | null>(null);
  const measuredProgramWidth = useRef<number | null>(null);
  const previousPaletteOpen = useRef(paletteOpen);
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
      (!controller.simulationRunning &&
        (previousRun.current || previousWorld.current !== sourceWorld))
    )
      resetWorld();
    previousRun.current = controller.simulationRunning;
    previousWorld.current = sourceWorld;
  }, [controller.simulationRunning, sourceWorld, resetWorld]);

  useEffect(() => {
    // Establish the requested pace after the shared passive run lifecycle has
    // installed its command receiver. A previous paused presenter keeps rate 0
    // through Reset; setting 1 before that receiver exists cannot resume it.
    if (controller.simulationRunning) controllerRef.current.setSimulationRate(1);
  }, [controller.simulationRunning]);

  useEffect(() => {
    const resized = () => setCompactLayout(window.innerWidth <= 760);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  useEffect(() => {
    if (compactLayout) controllerRef.current.setLibraryOpen(false);
  }, [compactLayout]);

  useEffect(() => {
    // Presentation-only fitting. Physical component dimensions and world time
    // stay unchanged, and the shared stage remains mounted throughout.
    const frame = window.requestAnimationFrame(() => controllerRef.current.fitScene());
    return () => window.cancelAnimationFrame(frame);
  }, [local.openRevision, section, compactLayout]);

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
    const measured = measureRoboticsDistance(sourceWorld, next.pose, next.balls);
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
    () => measureRoboticsDistance(sourceWorld, worldState.pose, worldState.balls),
    [sourceWorld, worldState.pose, worldState.balls],
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
  function primaryAction() {
    if (!running) {
      flushProgram();
      controller.cancelFamilyPlacement();
      const error = validateRoboticsBindings(local.getCurrentProject());
      if (error) {
        controller.setNotice(error);
        return;
      }
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
  function flushProgram() {
    programHandle.current?.flushPendingPublication();
  }
  function saveProject() {
    flushProgram();
    void controller.saveNow();
  }
  function openSaved() {
    flushProgram();
    if (
      local.hasUnsavedChanges() &&
      !window.confirm('Открыть сохранённый проект? Несохранённые изменения будут заменены.')
    )
      return;
    if (local.openSavedProject()) setProgramPreset('');
  }
  function navigate(next: Section) {
    flushProgram();
    controller.cancelFamilyPlacement();
    if (compactLayout && next === 'electronics' && section !== 'electronics')
      controller.setLibraryOpen(false);
    if (next === 'program') setCodeMounted(true);
    setSection(next);
    tabRefs.current[next]?.focus();
  }
  function chooseProgram(id: RoboticsProgramPresetId) {
    if (running) return;
    flushProgram();
    const metadata = ROBOTICS_PROGRAM_PRESETS.find((candidate) => candidate.id === id);
    if (
      !metadata ||
      !window.confirm(
        `Заменить текущую программу примером «${metadata.label}»? Схема и поле сохранятся. Изменение можно отменить.`,
      )
    )
      return;
    const current = local.getCurrentProject();
    const board = current.circuit.components.find(
      (part) => part.id === current.world.bindings.boardId,
    );
    if (board?.componentTypeId !== 'arduino-uno') {
      controller.setNotice('Выберите существующую Arduino Uno в разделе «Робот».');
      return;
    }
    const program = createRoboticsProgramPreset(id);
    controller.updateArduinoProgram(board.id, {
      arduinoCodeMode: program.mode,
      arduinoWorkspace: program.workspaceJson,
      arduinoSource: program.source,
      arduinoInputPins: program.inputPins,
    });
    setProgramPreset(id);
    // A deliberate source replacement gets a fresh workspace; navigation does not.
    setProgramRevision((value) => value + 1);
    setCodeMounted(true);
  }
  function moveHistory(direction: 'undo' | 'redo') {
    flushProgram();
    const previous = programIdentity(local.getCurrentProject());
    controller[direction]();
    if (programIdentity(local.getCurrentProject()) !== previous) {
      setProgramPreset('');
      setProgramRevision((value) => value + 1);
    }
  }
  useLayoutEffect(() => {
    if (stageHostRef.current) stageHostRef.current.inert = section !== 'electronics';
    // The catalog starts structural placement; runtime controls in the shared
    // inspector remain available. Keep the real Stage and native leaves visible.
    const library = stageHostRef.current?.querySelector<HTMLElement>('.workbench-library');
    if (library) library.inert = running;
  }, [section, running, controller.libraryOpen]);
  useLayoutEffect(() => {
    if (!codeOpen || !codeHostRef.current) return;
    const host = codeHostRef.current;
    let frame: number | null = null;
    const measure = () => {
      if (host.clientWidth <= 0) return;
      const previous = measuredProgramWidth.current;
      const width = host.clientWidth;
      measuredProgramWidth.current = width;
      setCodeWidth(width);
      if ((previous !== null && previous !== width) || (previous === null && width <= 760)) {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => programHandle.current?.revealProgramStart());
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [codeOpen]);
  useLayoutEffect(() => {
    const wasOpen = previousPaletteOpen.current;
    previousPaletteOpen.current = paletteOpen;
    if (!codeOpen || paletteOpen || !wasOpen) return;
    const frame = window.requestAnimationFrame(() => programHandle.current?.revealProgramStart());
    return () => window.cancelAnimationFrame(frame);
  }, [codeOpen, paletteOpen]);

  const board = local.robotProject.circuit.components.find(
    (part) => part.id === sourceWorld.bindings.boardId,
  );
  const programState = readArduinoProgramState(board?.stateProperties);
  const canCommand = running && !starting && pace.phase === 'running' && !haltReason;

  return (
    <main
      className="robotics-lab"
      data-testid="robotics-lab"
      data-section={section}
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
          <h1>
            Робототехника <span className="robotics-mode-badge">2D</span>
          </h1>
        </div>
        <div className="robotics-save-area">
          <span className={`robotics-save-status ${controller.saveStatus}`} role="status">
            {controller.saveStatus === 'saved'
              ? 'Сохранено на устройстве'
              : controller.saveStatus === 'error'
                ? 'Не удалось сохранить'
                : 'Есть изменения'}
          </span>
          <button type="button" className="robotics-button" onClick={saveProject}>
            <SmallIcon name="save" />
            Сохранить
          </button>
          <button
            type="button"
            className="robotics-button subtle"
            disabled={running || !local.hasSavedProject}
            onClick={openSaved}
          >
            Открыть
          </button>
        </div>
      </header>
      <nav className="robotics-tabs" role="tablist" aria-label="Разделы робототехники">
        {SECTIONS.map((item, index) => (
          <button
            type="button"
            key={item.id}
            id={`robotics-tab-${item.id}`}
            role="tab"
            aria-selected={section === item.id}
            aria-controls={`robotics-panel-${item.id}`}
            tabIndex={section === item.id ? 0 : -1}
            ref={(element) => {
              tabRefs.current[item.id] = element;
            }}
            onClick={() => navigate(item.id)}
            onKeyDown={(event) => {
              const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              const next =
                event.key === 'Home'
                  ? SECTIONS[0]
                  : event.key === 'End'
                    ? SECTIONS[SECTIONS.length - 1]
                    : offset
                      ? SECTIONS[(index + offset + SECTIONS.length) % SECTIONS.length]
                      : null;
              if (next) {
                event.preventDefault();
                navigate(next.id);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
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
        <div className="robotics-run-readout">
          <span className={`robotics-state-dot${running && !paused ? ' active' : ''}`} />
          <span>
            {haltReason
              ? 'Нужен сброс'
              : starting
                ? 'Запуск…'
                : paused
                  ? 'На паузе'
                  : pausing
                    ? 'Завершаем шаг'
                    : running
                      ? 'Выполняется'
                      : 'Готов к запуску'}
          </span>
          <output
            data-testid="robotics-time"
            data-microseconds={worldState.atMicroseconds}
            aria-label="Время"
          >
            {number(worldState.atMicroseconds / 1_000_000)} с
          </output>
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
      <div className="robotics-workspace">
        <section
          className="robotics-panel robotics-field-panel"
          role="tabpanel"
          id="robotics-panel-field"
          aria-labelledby="robotics-tab-field"
          hidden={section !== 'field'}
        >
          <RobotFieldEditor
            world={sourceWorld}
            state={worldState}
            distance={distance}
            running={running}
            showGrid={showGrid}
            onShowGridChange={setShowGrid}
            onCommit={local.setWorld}
          />
        </section>
        <section
          className="robotics-panel robotics-robot-panel"
          role="tabpanel"
          id="robotics-panel-robot"
          aria-labelledby="robotics-tab-robot"
          hidden={section !== 'robot'}
        >
          <RobotAssemblyPanel
            project={local.robotProject}
            running={running}
            onCommit={local.setWorld}
            onOpenElectronics={() => {
              navigate('electronics');
              controller.setLibraryOpen(true);
            }}
          />
        </section>
        <section
          className="robotics-panel robotics-electronics-panel"
          role="tabpanel"
          id="robotics-panel-electronics"
          aria-labelledby="robotics-tab-electronics"
          aria-owns={section === 'electronics' ? 'robotics-scheme' : undefined}
          hidden={section !== 'electronics'}
        >
          <div className="robotics-panel-toolbar">
            <h2>Схема робота</h2>
            <div className="robotics-inline-actions">
              <button type="button" className="robotics-button" onClick={controller.fitScene}>
                Вписать
              </button>
              <button
                type="button"
                className="robotics-button"
                onClick={() => controller.setLibraryOpen((value) => !value)}
                aria-pressed={controller.libraryOpen}
                disabled={running}
              >
                Компоненты
              </button>
              <button
                type="button"
                className="robotics-button"
                disabled={running || !controller.selection}
                onClick={controller.removeSelection}
              >
                Удалить
              </button>
            </div>
          </div>
          <p className="robotics-edit-hint">
            {running
              ? 'Остановите моделирование для изменения схемы.'
              : 'Выберите компонент в библиотеке, разместите его на схеме и соедините выводы.'}
          </p>
        </section>
        <section
          className="robotics-panel robotics-program-panel"
          role="tabpanel"
          id="robotics-panel-program"
          data-palette-open={paletteOpen}
          aria-labelledby="robotics-tab-program"
          hidden={!codeOpen}
        >
          <div className="robotics-panel-toolbar">
            <h2>Программа</h2>
            {programState.mode !== 'text' ? (
              <button
                type="button"
                className="robotics-button robotics-palette-toggle"
                aria-pressed={paletteOpen}
                onClick={() => setPaletteOpen((value) => !value)}
              >
                {paletteOpen ? 'Скрыть палитру' : 'Палитра блоков'}
              </button>
            ) : null}
            {programState.mode !== 'text' ? (
              <button
                type="button"
                className="robotics-button robotics-program-start"
                onClick={() => programHandle.current?.revealProgramStart()}
              >
                К началу
              </button>
            ) : null}
            <label className="robotics-preset-label">
              Пример
              <select
                aria-label="Пример программы"
                value={programPreset}
                disabled={running}
                onChange={(event) => chooseProgram(event.target.value as RoboticsProgramPresetId)}
              >
                <option value="" disabled>
                  Выбрать…
                </option>
                {ROBOTICS_PROGRAM_PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {programPreset === 'push-one-shot' ? (
            <p className="robotics-edit-hint">
              Для опыта поставьте мяч перед роботом. В «Роботе» задайте датчик: вперёд 0 мм, влево
              100 мм, угол 90°. Ближняя граница HC-SR04 — 2 см.
            </p>
          ) : null}
          {programState.mode === 'text' && !programState.workspaceJson ? (
            <p className="robotics-edit-hint">
              Открыт текстовый скетч. Можно редактировать C++ или явно заменить его роботным
              примером.
            </p>
          ) : null}
          <div
            ref={codeHostRef}
            className="workbench-shell robotics-program-shell"
            style={{ '--arduino-code-panel-width': `${codeWidth}px` } as CSSProperties}
          >
            {codeMounted ? (
              <ArduinoCodePanel
                key={`${local.openRevision}:${programRevision}`}
                controller={controller}
                open={codeOpen}
                drawerWidth={codeWidth}
                onDrawerWidthChange={setCodeWidth}
                mobileHeightPercent={codeHeight}
                onMobileHeightChange={setCodeHeight}
                onClose={() => navigate('field')}
                programHandleRef={programHandle}
              />
            ) : null}
          </div>
        </section>
        <aside className="robotics-observation" aria-label="Наблюдение за роботом">
          {section !== 'field' ? (
            <div className="robotics-mini-field">
              <div className="robotics-panel-toolbar">
                <h2>Поле</h2>
                <button type="button" onClick={() => navigate('field')} aria-label="Открыть поле">
                  ↗
                </button>
              </div>
              <RobotField
                world={sourceWorld}
                state={worldState}
                distance={distance}
                showGrid={showGrid}
                testIdPrefix="robotics-preview"
              />
            </div>
          ) : null}
          <dl className="robotics-metrics">
            <div>
              <dt>До препятствия</dt>
              <dd
                data-testid="robotics-distance"
                data-distance-meters={distance.status === 'ok' ? distance.distanceMeters : ''}
              >
                {distance.status === 'ok'
                  ? `${number(distance.distanceMeters * 100)} см`
                  : 'Вне диапазона'}
              </dd>
            </div>
            <div>
              <dt>Левый мотор</dt>
              <dd data-testid="robotics-left-rpm" data-rpm={worldState.leftRpm}>
                {number(worldState.leftRpm, 0)} об/мин
              </dd>
            </div>
            <div>
              <dt>Правый мотор</dt>
              <dd data-testid="robotics-right-rpm" data-rpm={worldState.rightRpm}>
                {number(worldState.rightRpm, 0)} об/мин
              </dd>
            </div>
          </dl>
          <details className="robotics-drive" open={section === 'field'}>
            <summary>Команды Serial</summary>
            <div className="robotics-drive-pad">
              {(
                [
                  ['F', 'Вперёд', '↑'],
                  ['L', 'Влево', '↶'],
                  ['S', 'Выбег', '■'],
                  ['R', 'Вправо', '↷'],
                ] as const
              ).map(([command, label, symbol]) => (
                <button
                  type="button"
                  key={command}
                  disabled={!canCommand}
                  onClick={() => sendCommand(command, label)}
                >
                  <span aria-hidden="true">{symbol}</span>
                  {label}
                </button>
              ))}
            </div>
            <p className="robotics-help">
              Команды F/L/R/S работают, если программа их обрабатывает.{' '}
              {paused || pausing
                ? 'Продолжите программу, чтобы отправить команду.'
                : lastCommand
                  ? `Отправлено: ${lastCommand}.`
                  : !running
                    ? 'Сначала запустите программу.'
                    : ''}
            </p>
          </details>
        </aside>
        <section
          className={`robotics-schematic ${section === 'electronics' ? 'editing' : 'preview'}`}
          id="robotics-scheme"
          aria-label={
            section === 'electronics' ? 'Редактор электрической схемы' : 'Схема: наблюдение'
          }
        >
          <div className="robotics-preview-heading">
            <h2>Схема</h2>
            <button type="button" onClick={() => navigate('electronics')}>
              Открыть схему ↗
            </button>
          </div>
          <div
            ref={stageHostRef}
            className={`workbench-shell robotics-workbench${controller.libraryOpen && section === 'electronics' ? '' : ' library-collapsed'}`}
          >
            <NativeOpticalProvider port={controller.nativeOpticalPresentation}>
              <div className="workbench-main">
                <WorkbenchStage controller={controller} showGrid={showGrid} />
                {section === 'electronics' ? <WorkbenchSidebars controller={controller} /> : null}
              </div>
            </NativeOpticalProvider>
          </div>
        </section>
      </div>
      <footer className="robotics-footer">
        <div className="robotics-history" aria-label="История проекта">
          <button
            type="button"
            disabled={running || !controller.canUndo}
            onClick={() => moveHistory('undo')}
          >
            Отменить
          </button>
          <button
            type="button"
            disabled={running || !controller.canRedo}
            onClick={() => moveHistory('redo')}
          >
            Повторить
          </button>
        </div>
        <span>Один опыт — до 40 с</span>
      </footer>
    </main>
  );
}
