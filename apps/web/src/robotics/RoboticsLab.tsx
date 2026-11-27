import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ArduinoCodePanel, type ArduinoCodePanelHandle } from '../electronics/ArduinoCodePanel';
import { CircuitIcon, CodeIcon, SaveIcon } from '../electronics/workbench-icons';
import { SimulationSpeedControl } from '../electronics/SimulationSpeedControl';
import { ProjectModuleIcon } from '../modules/ProjectModuleIcon';
import { EditorAvatar, type EditorAvatarModel } from '../components/editor-chrome/EditorAvatar';
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
  createRoboticsWorldState,
  measureRoboticsDistance,
  ROBOTICS_RUN_LIMIT_MICROSECONDS,
  ROBOTICS_SENSOR_INTERVAL_MICROSECONDS,
} from './world';
import { createRoboticsRuntime, type RoboticsRuntime } from '@asa-lab/robotics/runtime';
import { useLocalRoboticsProject } from './use-local-robotics-project';
import type { RoboticsProjectController } from './use-robotics-project';
import { RobotField } from './RobotField';
import { RobotFieldEditor } from './RobotFieldEditor';
import { RoboticsElectronicsToolbar } from './RoboticsElectronicsToolbar';
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
const ROBOTICS_SIDE_STORAGE_KEY = 'asa-lab:robotics:side-width:v1';
const ROBOTICS_EDITOR_STORAGE_KEY = 'asa-lab:robotics:editor-width:v1';
const ROBOTICS_OBSERVATION_STORAGE_KEY = 'asa-lab:robotics:electronics-observation-width:v1';
const ROBOTICS_OBSERVATION_MIN = 200;
const ROBOTICS_OBSERVATION_MAX = 360;
const ROBOTICS_EDITOR_MIN = 320;
const ROBOTICS_FIELD_MIN = 640;
const ROBOTICS_SIDE_MIN = 180;
const ROBOTICS_SIDE_MAX = 960;
function roboticsSideWidth(value: number, available: number): number {
  const max = Math.max(ROBOTICS_SIDE_MIN, Math.min(ROBOTICS_SIDE_MAX, Math.floor(available / 2)));
  return Math.max(ROBOTICS_SIDE_MIN, Math.min(max, Math.round(value)));
}
const SECTIONS = [
  { id: 'field', label: 'Поле' },
  { id: 'robot', label: 'Робот' },
  { id: 'electronics', label: 'Электроника' },
  { id: 'program', label: 'Код' },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

function RoboticsSectionIcon({ section }: { readonly section: Section }): JSX.Element {
  if (section === 'electronics') return <CircuitIcon />;
  if (section === 'program') return <CodeIcon />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {section === 'field' ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </>
      ) : (
        <>
          <rect x="5" y="8" width="14" height="12" rx="3" />
          <path d="M12 4v4M9 4h6M8 20v2M16 20v2M2 12v4M22 12v4" />
          <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
          <path d="M9 17h6" />
        </>
      )}
    </svg>
  );
}

interface RoboticsHeaderNavigation {
  readonly disabled: boolean;
  readonly onHome: () => void;
  readonly onProjects: () => void;
  readonly onAccount: () => void;
  readonly onPublish?: () => void;
}

interface RoboticsHeaderProps {
  readonly tabs: ReactNode;
  readonly simulationControls?: ReactNode;
  readonly notices?: readonly string[];
  readonly title: string;
  readonly onTitleChange: (value: string) => void;
  readonly onTitleCommit: () => void | Promise<void>;
  readonly onTitleCancel: () => void;
  readonly statusKind: string;
  readonly statusLabel: string;
  readonly statusDetail?: string;
  readonly onSave: () => void;
  readonly onExit?: () => void;
  readonly navigation?: RoboticsHeaderNavigation;
  readonly avatar?: EditorAvatarModel;
  readonly onOpenSaved?: () => void;
  readonly canOpenSaved?: boolean;
}

/** Shares the brand, project identity and avatar primitives with Electronics. */
export function RoboticsHeader({
  tabs,
  simulationControls,
  notices = [],
  title,
  onTitleChange,
  onTitleCommit,
  onTitleCancel,
  statusKind,
  statusLabel,
  statusDetail,
  onSave,
  onExit,
  navigation,
  avatar,
  onOpenSaved,
  canOpenSaved = false,
}: RoboticsHeaderProps): JSX.Element {
  const skipNextTitleBlur = useRef(false);
  const brand = (
    <>
      <img className="workbench-brand-mark" src="/asa-lab-mark.svg" alt="" aria-hidden="true" />
      <span className="workbench-brand-name">ASA Lab</span>
    </>
  );
  const navItems = navigation
    ? [
        { id: 'home', label: 'Главная', activate: navigation.onHome },
        { id: 'projects', label: 'Мои проекты', activate: navigation.onProjects },
        { id: 'account', label: 'Аккаунт', activate: navigation.onAccount },
      ]
    : [];

  return (
    <header className="workbench-header robotics-unified-header" data-module-id="robotics">
      <div className="workbench-brand-zone robotics-header-brand-zone">
        {onExit ? (
          <button
            type="button"
            className="workbench-brand"
            aria-label="Вернуться к проектам"
            title="Вернуться к проектам"
            onClick={onExit}
          >
            {brand}
          </button>
        ) : (
          <span className="workbench-brand">{brand}</span>
        )}
        <span className="robotics-header-module-icon" title="Робототехника">
          <ProjectModuleIcon moduleKey="robotics" size={22} />
        </span>
        <input
          className="workbench-title-input robotics-header-title-input"
          aria-label="Название проекта"
          value={title}
          maxLength={255}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={() => {
            if (skipNextTitleBlur.current) {
              skipNextTitleBlur.current = false;
              return;
            }
            void onTitleCommit();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            skipNextTitleBlur.current = true;
            if (event.key === 'Enter') void onTitleCommit();
            else onTitleCancel();
            event.currentTarget.blur();
          }}
        />
      </div>
      <span className={'robotics-header-status is-' + statusKind} role="status" aria-live="polite">
        {statusLabel}
      </span>
      <button
        type="button"
        className={'robotics-header-save is-' + statusKind}
        data-save-state={statusKind}
        disabled={statusKind === 'saving' || (navigation?.disabled ?? false)}
        onClick={onSave}
        aria-label="Сохранить"
        title={statusDetail ? statusLabel + ': ' + statusDetail : statusLabel}
      >
        <SaveIcon />
        <span>{statusKind === 'saving' ? 'Сохраняем…' : 'Сохранить'}</span>
      </button>
      <div
        className="robotics-header-notice"
        data-testid="robotics-notice"
        role="status"
        aria-live="polite"
        hidden={notices.length === 0}
      >
        {notices.length > 0 ? (
          <details className="robotics-header-notice-details">
            <summary title={notices.join(' · ')} aria-label="Уведомления робототехники">
              <span className="robotics-header-notice-icon" aria-hidden="true">
                !
              </span>
              <span className="robotics-header-notice-caption">{notices[0]}</span>
            </summary>
            <div className="robotics-header-notice-panel">
              {notices.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      {simulationControls}
      <div className="robotics-header-controls">
        {tabs}
        {onOpenSaved ? (
          <button
            type="button"
            className="robotics-header-open"
            disabled={!canOpenSaved}
            onClick={onOpenSaved}
          >
            Открыть
          </button>
        ) : null}
        {avatar ? (
          <details className="robotics-header-menu robotics-header-profile">
            <summary aria-label="Профиль и действия" title={avatar.title}>
              <EditorAvatar avatar={avatar} className="workbench-avatar robotics-header-avatar" />
            </summary>
            <div className="robotics-header-menu-panel" role="group" aria-label="Действия проекта">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={navigation?.disabled}
                  onClick={item.activate}
                >
                  {item.label}
                </button>
              ))}
              {navigation?.onPublish ? (
                <button
                  type="button"
                  className="robotics-header-publish"
                  disabled={navigation.disabled}
                  onClick={navigation.onPublish}
                >
                  Публикация
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </header>
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
  const local = useLocalRoboticsProject(seed);
  return <RoboticsWorkspace project={local} />;
}

/** The same M1 workspace is hosted by either a local or an account project. */
export function RoboticsWorkspace({
  project: local,
  projectId = 'asa-robotics-local-v1',
  allowDistribution = true,
  header,
}: {
  readonly project: RoboticsProjectController;
  readonly projectId?: string;
  readonly allowDistribution?: boolean;
  readonly header?: (
    tabs: ReactNode,
    notices: readonly string[],
    simulationControls: ReactNode,
  ) => ReactNode;
}) {
  const [section, setSection] = useState<Section>('field');
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [sideWidth, setSideWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(ROBOTICS_SIDE_STORAGE_KEY));
      return roboticsSideWidth(saved > 0 ? saved : 240, window.innerWidth);
    } catch {
      return roboticsSideWidth(240, window.innerWidth);
    }
  });
  const [editorPreference, setEditorPreference] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(ROBOTICS_EDITOR_STORAGE_KEY));
      return Number.isFinite(saved) && saved >= ROBOTICS_EDITOR_MIN ? Math.min(960, saved) : 480;
    } catch {
      return 480;
    }
  });
  const [observationPreference, setObservationPreference] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(ROBOTICS_OBSERVATION_STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= ROBOTICS_OBSERVATION_MIN)
        return Math.min(saved, ROBOTICS_OBSERVATION_MAX);
    } catch {
      /* The local preference is optional. */
    }
    return 240;
  });
  const [observationSubject, setObservationSubject] = useState<'field' | 'robot'>('field');
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth);
  const [compactLayout, setCompactLayout] = useState(() => window.innerWidth <= 760);
  const electronicsObserver = section === 'electronics';
  const split = electronicsObserver || section === 'program';
  const compactSplit = split && workspaceWidth < 1024;
  const [pane, setPane] = useState<'editor' | 'field'>('editor');
  const paneLayout = useRef({ section, pane, compactSplit, observationSubject });
  paneLayout.current = { section, pane, compactSplit, observationSubject };
  const [shortcutOwner, setShortcutOwner] = useState<'editor' | 'field' | 'none'>('none');
  const [codeDrawerOpen, setCodeDrawerOpen] = useState(false);
  const codeDrawerVisible = section === 'electronics' && codeDrawerOpen;
  const editorVisible = split && (!compactSplit || pane === 'editor');
  const observationVisible = split && (!compactSplit || pane === 'field');
  const fieldVisible =
    section === 'field' ||
    (observationVisible && (!electronicsObserver || observationSubject === 'field'));
  const robotVisible =
    section === 'robot' ||
    (electronicsObserver && observationVisible && observationSubject === 'robot');
  const editorMaximum = Math.max(
    ROBOTICS_EDITOR_MIN,
    Math.min(960, workspaceWidth - ROBOTICS_FIELD_MIN),
  );
  const editorWidth = Math.max(ROBOTICS_EDITOR_MIN, Math.min(editorMaximum, editorPreference));
  const observationMaximum = Math.max(
    ROBOTICS_OBSERVATION_MIN,
    Math.min(ROBOTICS_OBSERVATION_MAX, workspaceWidth - ROBOTICS_FIELD_MIN),
  );
  const observationWidth = Math.min(observationPreference, observationMaximum);
  const paneWidth = electronicsObserver ? observationWidth : split ? editorWidth : sideWidth;
  const paneMinimum = electronicsObserver
    ? ROBOTICS_OBSERVATION_MIN
    : split
      ? ROBOTICS_EDITOR_MIN
      : ROBOTICS_SIDE_MIN;
  const paneMaximum = electronicsObserver
    ? observationMaximum
    : split
      ? editorMaximum
      : Math.max(ROBOTICS_SIDE_MIN, Math.min(ROBOTICS_SIDE_MAX, Math.floor(workspaceWidth / 2)));
  const sideDragRef = useRef<{ pointerId: number; clientX: number; width: number } | null>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const circuitPointer = useRef<{ target: SVGSVGElement; id: number; type: string } | null>(null);
  function cancelCircuitGesture(): void {
    const owned = circuitPointer.current;
    circuitPointer.current = null;
    if (!owned) return;
    // Notify the real Stage lifecycle, including its local vertex press and
    // native controller draft. This is cancellation, never a synthetic move/up.
    const event =
      typeof PointerEvent === 'function'
        ? new PointerEvent('pointercancel', {
            bubbles: true,
            pointerId: owned.id,
            pointerType: owned.type,
          })
        : Object.defineProperties(new Event('pointercancel', { bubbles: true }), {
            pointerId: { value: owned.id },
            pointerType: { value: owned.type },
          });
    owned.target.dispatchEvent(event);
  }
  function beginCircuitPointer(event: ReactPointerEvent<HTMLElement>) {
    ownPane('editor');
    const target = event.target as Element;
    if (target.closest('[data-testid="ultrasonic-target"]')) return;
    const svg = target.closest<SVGSVGElement>('svg.workbench-canvas');
    if (svg) circuitPointer.current = { target: svg, id: event.pointerId, type: event.pointerType };
  }
  function finishCircuitPointer(event: ReactPointerEvent<HTMLElement>) {
    if (circuitPointer.current?.id === event.pointerId) circuitPointer.current = null;
  }
  function loseCircuitPointer(event: ReactPointerEvent<HTMLElement>) {
    if (circuitPointer.current?.id === event.pointerId) cancelCircuitGesture();
  }
  const fieldPanelRef = useRef<HTMLElement>(null);
  const robotPanelRef = useRef<HTMLElement>(null);
  const lastPaneFocus = useRef<Partial<Record<'editor' | 'field', HTMLElement>>>({});
  function updateSideWidth(value: number): void {
    const width = Math.max(paneMinimum, Math.min(paneMaximum, Math.round(value)));
    if (electronicsObserver) setObservationPreference(width);
    else if (split) setEditorPreference(width);
    else setSideWidth(width);
  }
  function cancelSideDrag(): void {
    const current = sideDragRef.current;
    sideDragRef.current = null;
    if (current && separatorRef.current?.hasPointerCapture?.(current.pointerId))
      separatorRef.current.releasePointerCapture(current.pointerId);
  }
  function sidePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || (split ? compactSplit : compactLayout)) return;
    setShortcutOwner('none');
    cancelCircuitGesture();
    controllerRef.current.cancelFamilyPlacement();
    sideDragRef.current = { pointerId: event.pointerId, clientX: event.clientX, width: paneWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function sidePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = sideDragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    updateSideWidth(drag.width + event.clientX - drag.clientX);
  }
  function sidePointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    if (sideDragRef.current?.pointerId === event.pointerId) cancelSideDrag();
  }
  function sideKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 40 : 16;
    const next =
      event.key === 'ArrowLeft'
        ? paneWidth - step
        : event.key === 'ArrowRight'
          ? paneWidth + step
          : event.key === 'Home'
            ? paneMinimum
            : event.key === 'End'
              ? paneMaximum
              : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    updateSideWidth(next);
  }
  useEffect(() => {
    try {
      window.localStorage.setItem(ROBOTICS_SIDE_STORAGE_KEY, String(sideWidth));
    } catch {
      /* The local preference is optional. */
    }
  }, [sideWidth]);
  useEffect(() => {
    try {
      window.localStorage.setItem(ROBOTICS_EDITOR_STORAGE_KEY, String(editorPreference));
    } catch {
      /* A narrow viewport never replaces the desktop preference. */
    }
  }, [editorPreference]);
  useEffect(() => {
    try {
      window.localStorage.setItem(ROBOTICS_OBSERVATION_STORAGE_KEY, String(observationPreference));
    } catch {
      /* A narrow viewport never replaces the desktop preference. */
    }
  }, [observationPreference]);
  useLayoutEffect(() => {
    let measuredWidth = workspaceRef.current?.clientWidth || window.innerWidth;
    const measure = () => {
      const width = workspaceRef.current?.clientWidth || window.innerWidth;
      if (width === measuredWidth) return;
      measuredWidth = width;
      setWorkspaceWidth(width);
      setSideWidth((current) => roboticsSideWidth(current, width));
      cancelSideDrag();
      cancelCircuitGesture();
    };
    setWorkspaceWidth(measuredWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (workspaceRef.current) observer?.observe(workspaceRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      cancelSideDrag();
    };
  }, []);
  const controller = useElectronicsWorkbenchHost(projectId, local.host, {
    ...WORKBENCH_OPTIONS,
    keyboardShortcutsEnabled:
      section === 'electronics' &&
      editorVisible &&
      !codeDrawerVisible &&
      shortcutOwner === 'editor',
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
  const runtimeRef = useRef<RoboticsRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = createRoboticsRuntime(sourceWorld);
  const processedObservation = useRef<typeof observation>(null);
  const lastSensorAt = useRef(0);
  const [haltReason, setHaltReason] = useState<string | null>(null);
  const haltedRef = useRef<string | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const selectedRateRef = useRef(1);
  const [showGrid, setShowGrid] = useState(true);
  const codeOpen = editorVisible && (section === 'program' || codeDrawerVisible);
  const [codeMounted, setCodeMounted] = useState(false);
  const [codeWidth, setCodeWidth] = useState(() =>
    Math.max(320, Math.min(1456, window.innerWidth - 74)),
  );
  const [codeHeight, setCodeHeight] = useState(70);
  const programHandle = useRef<ArduinoCodePanelHandle | null>(null);
  const flushRef = useRef(flushProgram);
  flushRef.current = flushProgram;
  useLayoutEffect(() => {
    const release = local.registerProgramFlush(() => flushRef.current());
    return () => {
      flushRef.current();
      release();
    };
  }, [local.registerProgramFlush]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chosenProgramPreset, setChosenProgramPreset] = useState<{
    id: RoboticsProgramPresetId;
    revision: number;
  } | null>(null);
  const programPreset =
    chosenProgramPreset?.revision === local.programRevision ? chosenProgramPreset.id : '';
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const codeHostRef = useRef<HTMLDivElement | null>(null);
  const fittedCircuitRevision = useRef<number | null>(null);
  const revealedProgramRevision = useRef<number | null>(null);
  const previousPaletteOpen = useRef(paletteOpen);
  const previousRun = useRef(false);
  const previousWorld = useRef(sourceWorld);

  const resetWorld = useCallback(() => {
    runtimeRef.current = createRoboticsRuntime(local.getCurrentProject().world);
    const next = runtimeRef.current.read();
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
    if (controller.simulationRunning)
      controllerRef.current.setSimulationRate(selectedRateRef.current);
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
    // Preserve source geometry; begin Electronics at 50% of the usual fitted zoom.
    if (
      section !== 'electronics' ||
      !editorVisible ||
      codeDrawerVisible ||
      fittedCircuitRevision.current === local.openRevision
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      controllerRef.current.fitSceneScaled(0.5);
      fittedCircuitRevision.current = local.openRevision;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [local.openRevision, section, editorVisible, codeDrawerVisible]);

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
    const next = runtimeRef.current!.advance({
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
    const measured = measureRoboticsDistance(sourceWorld, next.pose, next.balls, next.bodies);
    if (measured.status !== 'ok' && measured.status !== 'no-echo') {
      halt(measured.message);
      return;
    }
    const accepted =
      local.robotProject.schemaVersion === 3
        ? current.setRuntimeHcSr04EnvironmentSample(
            bindings.distanceSensorId,
            measured.status === 'ok'
              ? { kind: 'echo', distanceMeters: measured.distanceMeters }
              : { kind: 'no-echo' },
          )
        : measured.status === 'ok' &&
          current.setRuntimeSensorDistance(bindings.distanceSensorId, measured.distanceMeters);
    if (!accepted) {
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
    local.robotProject.schemaVersion,
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
    () =>
      measureRoboticsDistance(sourceWorld, worldState.pose, worldState.balls, worldState.bodies),
    [sourceWorld, worldState.pose, worldState.balls, worldState.bodies],
  );
  const bindingError = validateRoboticsBindings(local.robotProject);
  const running = controller.simulationRunning;
  const starting = running && controller.simulationStatus === 'starting';
  const paused = running && pace.phase === 'paused';
  const pausing = running && pace.phase === 'pausing';
  const primaryLabel = !running ? 'Запустить' : starting ? 'Запускается…' : 'Остановить';
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
      controller.setSimulationRate(selectedRateRef.current);
      void controller.toggleSimulation();
    } else void controller.toggleSimulation();
  }
  function togglePause() {
    if (!running || starting || pausing || haltReason) return;
    controller.setSimulationRate(paused ? pace.lastNonZero : 0);
  }
  function changeRate(rate: number) {
    // A terminal halt freezes robot physics and Arduino execution together.
    // Never let the speed menu resume Arduino while the robot is still halted.
    if (haltedRef.current || haltReason) return;
    if (rate > 0) selectedRateRef.current = rate;
    controller.setSimulationRate(rate);
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
    if (local.getProgramRevision() !== local.programRevision) return;
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
    if (local.openSavedProject()) setChosenProgramPreset(null);
  }
  function navigate(next: Section) {
    cancelCircuitGesture();
    flushProgram();
    controller.cancelFamilyPlacement();
    cancelSideDrag();
    setShortcutOwner('none');
    setPane('editor');
    if (next === 'electronics' && section !== 'electronics')
      controller.setLibraryOpen(!compactLayout);
    if (next === 'program') setCodeMounted(true);
    if (next !== 'electronics') setCodeDrawerOpen(false);
    setSection(next);
    tabRefs.current[next]?.focus();
  }
  function chooseProgram(id: RoboticsProgramPresetId) {
    if (running) return;
    flushProgram();
    const metadata = ROBOTICS_PROGRAM_PRESETS.find((candidate) => candidate.id === id);
    if (!metadata) return;
    const current = local.getCurrentProject();
    const board = current.circuit.components.find(
      (part) => part.id === current.world.bindings.boardId,
    );
    if (board?.componentTypeId !== 'arduino-uno') {
      controller.setNotice('Выберите существующую Arduino Uno в разделе «Робот».');
      return;
    }
    const boardName = board.name?.trim() || 'Arduino Uno R3';
    if (
      !window.confirm(
        `Заменить программу платы робота «${boardName}» (${board.id}) примером «${metadata.label}»? Редактор откроет эту плату. Программы других плат, схема и поле сохранятся. Изменение можно отменить.`,
      )
    )
      return;
    const program = createRoboticsProgramPreset(id);
    local.replaceProgram(() =>
      controller.updateArduinoProgram(board.id, {
        arduinoCodeMode: program.mode,
        arduinoWorkspace: program.workspaceJson,
        arduinoSource: program.source,
        arduinoInputPins: program.inputPins,
      }),
    );
    controller.selectComponent(board.id, false);
    setChosenProgramPreset({ id, revision: local.getProgramRevision() });
    setCodeMounted(true);
  }
  // A publication retained by the previous editor must not overwrite an Undo
  // in the same event or from a pending debounce before its effect is disposed.
  const programController = {
    ...controller,
    updateArduinoProgram: (...args: Parameters<typeof controller.updateArduinoProgram>) => {
      if (local.getProgramRevision() !== local.programRevision) return;
      controller.updateArduinoProgram(...args);
    },
  };
  useLayoutEffect(() => {
    if (stageHostRef.current)
      stageHostRef.current.inert = section !== 'electronics' || !editorVisible || codeDrawerVisible;
    // The catalog starts structural placement; runtime controls in the shared
    // inspector remain available. Keep the real Stage and native leaves visible.
    const library = stageHostRef.current?.querySelector<HTMLElement>('.workbench-library');
    if (library) library.inert = running;
  }, [section, editorVisible, codeDrawerVisible, running, controller.libraryOpen]);
  useLayoutEffect(() => {
    if (!codeOpen || !codeHostRef.current) return;
    const host = codeHostRef.current;
    let frame: number | null = null;
    const measure = () => {
      if (host.clientWidth <= 0) return;
      setCodeWidth(host.clientWidth);
      // Resize the real editor without resetting its selection, scroll or Blockly zoom.
      if (revealedProgramRevision.current !== local.programRevision) {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          programHandle.current?.revealProgramStart();
          revealedProgramRevision.current = local.programRevision;
        });
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
  }, [codeOpen, local.programRevision]);
  useLayoutEffect(() => {
    const wasOpen = previousPaletteOpen.current;
    previousPaletteOpen.current = paletteOpen;
    if (!codeOpen || paletteOpen || !wasOpen) return;
    const frame = window.requestAnimationFrame(() => programHandle.current?.revealProgramStart());
    return () => window.cancelAnimationFrame(frame);
  }, [codeOpen, paletteOpen]);

  function focusPane(next: 'editor' | 'field') {
    cancelCircuitGesture();
    flushProgram();
    controller.cancelFamilyPlacement();
    cancelSideDrag();
    setShortcutOwner('none');
    setPane(next);
    const fromSection = section;
    requestAnimationFrame(() => {
      const current = paneLayout.current;
      if (current.section !== fromSection || current.pane !== next || !current.compactSplit) return;
      const host =
        next === 'field'
          ? electronicsObserver && current.observationSubject === 'robot'
            ? robotPanelRef.current
            : fieldPanelRef.current
          : section === 'program' || codeDrawerVisible
            ? codeHostRef.current
            : stageHostRef.current;
      if (!host || host.closest('[hidden], [inert]')) return;
      const candidates = host.querySelectorAll<HTMLElement>('textarea, [tabindex="0"], button');
      const usable = (node: HTMLElement) =>
        host.contains(node) &&
        node.getClientRects().length > 0 &&
        !node.closest('[hidden], [inert]') &&
        !node.matches(':disabled, [aria-disabled="true"]');
      const previous = lastPaneFocus.current[next];
      const first = previous && usable(previous) ? previous : [...candidates].find(usable);
      (first ?? host).focus({ preventScroll: true });
    });
  }
  function ownPane(next: 'editor' | 'field', focused?: HTMLElement) {
    if (focused) lastPaneFocus.current[next] = focused;
    setShortcutOwner(next);
    if (next !== 'editor') {
      cancelCircuitGesture();
      controller.cancelFamilyPlacement();
    }
  }
  function fieldKeys(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      ['z', 'y'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (running) return;
      flushProgram();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) controller.redo();
      else controller.undo();
    }
  }

  const board = local.robotProject.circuit.components.find(
    (part) => part.id === sourceWorld.bindings.boardId,
  );
  const programState = readArduinoProgramState(board?.stateProperties);
  const canCommand = running && !starting && pace.phase === 'running' && !haltReason;

  // Educational example replacement is optional, not a simulation parameter.
  // Keep it behind an explicit menu in the native Arduino toolbar.
  const codeAccessory = (
    <details className="robotics-code-extras">
      <summary
        aria-label="Дополнительные инструменты кода"
        title="Учебные примеры и навигация по блокам"
      >
        ⋯
      </summary>
      <div className="robotics-code-extras-menu">
        <strong>Дополнительно</strong>
        <p>
          Учебные примеры заменяют код выбранной платы Arduino только после подтверждения. «Толкнуть
          мяч» — демонстрационный опыт, а не параметр движения робота.
        </p>
        <label>
          Учебный пример
          <select
            aria-label="Пример программы"
            value={programPreset}
            disabled={running}
            onChange={(event) => chooseProgram(event.target.value as RoboticsProgramPresetId)}
          >
            <option value="" disabled>
              Не выбран
            </option>
            {ROBOTICS_PROGRAM_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {programState.mode !== 'text' ? (
          <>
            <button
              type="button"
              aria-pressed={paletteOpen}
              onClick={() => setPaletteOpen((value) => !value)}
            >
              {paletteOpen ? 'Скрыть палитру блоков' : 'Палитра блоков'}
            </button>
            <button type="button" onClick={() => programHandle.current?.revealProgramStart()}>
              К началу программы
            </button>
          </>
        ) : null}
        {programPreset === 'push-one-shot' ? (
          <p>Для опыта разместите мяч перед роботом и проверьте положение HC-SR04.</p>
        ) : null}
      </div>
    </details>
  );

  const simulationControls = (
    <section className="robotics-run-bar" aria-label="Управление моделированием">
      <div className="robotics-run-readout">
        <SimulationSpeedControl pacing={controller.simulationPacing} onChange={changeRate}>
          <output
            data-testid="robotics-time"
            data-microseconds={worldState.atMicroseconds}
            aria-label="Время моделирования"
          >
            {number(worldState.atMicroseconds / 1_000_000)} с
          </output>
        </SimulationSpeedControl>
      </div>
      <div className="robotics-run-buttons">
        <button
          type="button"
          className={'robotics-button primary' + (running ? ' is-running' : '')}
          aria-label={primaryLabel}
          onClick={primaryAction}
          disabled={starting || (!running && Boolean(bindingError))}
        >
          <SmallIcon name={running ? 'stop' : 'play'} />
          <span>{primaryLabel}</span>
        </button>
        <button
          type="button"
          className="robotics-button robotics-pause-button"
          aria-label={paused ? 'Продолжить' : 'Пауза'}
          title={paused ? 'Продолжить' : 'Пауза'}
          disabled={!running || starting || pausing || Boolean(haltReason)}
          onClick={togglePause}
        >
          <SmallIcon name={paused ? 'play' : 'pause'} />
        </button>
        <button
          type="button"
          className="robotics-button robotics-reset-button"
          aria-label="Сбросить"
          title="Сбросить"
          onClick={reset}
        >
          <SmallIcon name="reset" />
        </button>
      </div>
    </section>
  );

  const tabs = (
    <nav
      className="workbench-mode-buttons robotics-tabs"
      role="tablist"
      aria-label="Разделы робототехники"
    >
      {SECTIONS.map((item, index) => (
        <button
          type="button"
          key={item.id}
          className={section === item.id ? 'active' : ''}
          id={`robotics-tab-${item.id}`}
          role="tab"
          aria-label={item.label}
          title={item.label}
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
          <RoboticsSectionIcon section={item.id} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <main
      className="robotics-lab"
      data-testid="robotics-lab"
      data-section={section}
      onFocusCapture={(event) => {
        if (!(event.target as Element).closest('[data-editing-pane]')) {
          cancelCircuitGesture();
          setShortcutOwner('none');
        }
      }}
      onPointerDownCapture={(event) => {
        if (!(event.target as Element).closest('[data-editing-pane]')) {
          cancelCircuitGesture();
          setShortcutOwner('none');
        }
      }}
      data-input-admitted={budget?.admitted ?? 0}
      data-input-accepted={budget?.accepted ?? 0}
      data-input-pending={budget?.pending ?? 0}
      data-input-inflight={budget?.inFlight ?? 0}
      data-input-exhausted={budget?.exhausted ?? false}
    >
      {header ? (
        header(tabs, messages, simulationControls)
      ) : (
        <RoboticsHeader
          tabs={tabs}
          simulationControls={simulationControls}
          notices={messages}
          title={local.host.projectTitle}
          onTitleChange={local.host.setProjectTitle}
          onTitleCommit={local.host.renameProject}
          onTitleCancel={() => local.host.setProjectTitle(local.host.project?.title ?? '')}
          statusKind={controller.saveStatus}
          statusLabel={
            controller.saveStatus === 'saved'
              ? 'Сохранено на устройстве'
              : controller.saveStatus === 'saving'
                ? 'Сохраняем…'
                : controller.saveStatus === 'error'
                  ? 'Не удалось сохранить'
                  : 'Есть изменения'
          }
          onSave={saveProject}
          onOpenSaved={openSaved}
          canOpenSaved={!running && local.hasSavedProject}
        />
      )}
      <div
        className="robotics-workspace"
        ref={workspaceRef}
        data-split={split}
        data-compact-split={compactSplit}
        data-electronics-observer={electronicsObserver}
        data-observation-subject={observationSubject}
        data-observation-width={observationWidth}
        data-pane={pane}
        data-editor-width={editorWidth}
        data-shortcut-owner={shortcutOwner}
        style={
          {
            '--robotics-side-width': `${sideWidth}px`,
            '--robotics-editor-width': `${editorWidth}px`,
            '--robotics-observation-width': `${observationWidth}px`,
          } as CSSProperties
        }
      >
        <div
          className="robotics-pane-choice"
          role="group"
          aria-label="Рабочая область"
          hidden={!compactSplit}
        >
          <button
            type="button"
            aria-pressed={pane === 'editor'}
            onClick={() => focusPane('editor')}
          >
            Редактор
          </button>
          <button type="button" aria-pressed={pane === 'field'} onClick={() => focusPane('field')}>
            {electronicsObserver ? 'Наблюдение' : 'Поле'}
          </button>
        </div>
        <div
          className="robotics-observation-switch"
          data-testid="robotics-observation-switch"
          data-editing-pane="field"
          role="group"
          aria-label="Режим наблюдения"
          hidden={!electronicsObserver || !observationVisible}
          onFocusCapture={() => ownPane('field')}
          onPointerDownCapture={() => ownPane('field')}
        >
          <button
            type="button"
            aria-pressed={observationSubject === 'field'}
            onClick={() => setObservationSubject('field')}
          >
            Поле
          </button>
          <button
            type="button"
            aria-pressed={observationSubject === 'robot'}
            onClick={() => setObservationSubject('robot')}
          >
            Робот
          </button>
        </div>
        <section
          ref={fieldPanelRef}
          data-editing-pane="field"
          tabIndex={-1}
          onFocusCapture={(event) => ownPane('field', event.target as HTMLElement)}
          onPointerDownCapture={() => ownPane('field')}
          onKeyDown={electronicsObserver ? undefined : fieldKeys}
          className="robotics-panel robotics-field-panel"
          role={section === 'field' ? 'tabpanel' : 'region'}
          id="robotics-panel-field"
          aria-label={section === 'field' ? undefined : 'Поле'}
          aria-labelledby={section === 'field' ? 'robotics-tab-field' : undefined}
          hidden={!fieldVisible}
        >
          <RobotFieldEditor
            allowExport={allowDistribution}
            active={fieldVisible}
            compactDock={split}
            observation={electronicsObserver}
            interactionKey={`${section}:${pane}:${observationSubject}:${paneWidth}`}
            interactive={shortcutOwner === 'field' || (!split && fieldVisible)}
            sourceSchemaVersion={local.robotProject.schemaVersion}
            onUpgradeField={local.enableExtendedField}
            world={sourceWorld}
            state={worldState}
            distance={distance}
            running={running}
            showGrid={showGrid}
            onShowGridChange={setShowGrid}
            onCommit={local.setWorld}
            canUndo={controller.canUndo}
            canRedo={controller.canRedo}
            onUndo={() => controller.undo()}
            onRedo={() => controller.redo()}
          />
        </section>
        <section
          ref={robotPanelRef}
          className="robotics-panel robotics-robot-panel"
          role={electronicsObserver ? 'region' : 'tabpanel'}
          id="robotics-panel-robot"
          aria-label={electronicsObserver ? 'Робот' : undefined}
          aria-labelledby={electronicsObserver ? undefined : 'robotics-tab-robot'}
          data-editing-pane={electronicsObserver ? 'field' : undefined}
          tabIndex={electronicsObserver ? -1 : undefined}
          onFocusCapture={
            electronicsObserver
              ? (event) => ownPane('field', event.target as HTMLElement)
              : undefined
          }
          onPointerDownCapture={electronicsObserver ? () => ownPane('field') : undefined}
          hidden={!robotVisible}
        >
          <RobotAssemblyPanel
            active={robotVisible}
            observation={electronicsObserver}
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
          data-editing-pane="editor"
          onFocusCapture={(event) => ownPane('editor', event.target as HTMLElement)}
          onPointerDownCapture={() => ownPane('editor')}
          className="robotics-panel robotics-electronics-panel"
          role="tabpanel"
          id="robotics-panel-electronics"
          aria-labelledby="robotics-tab-electronics"
          aria-owns={section === 'electronics' ? 'robotics-scheme' : undefined}
          hidden={section !== 'electronics' || !editorVisible}
        >
          <div className="robotics-panel-toolbar robotics-electronics-toolbar">
            <RoboticsElectronicsToolbar
              controller={controller}
              running={running}
              codeOpen={codeDrawerVisible}
              onToggleCode={() => {
                setCodeMounted(true);
                cancelCircuitGesture();
                controller.cancelFamilyPlacement();
                setShortcutOwner('none');
                setCodeDrawerOpen((current) => !current);
              }}
            />
          </div>
        </section>
        <section
          data-editing-pane="editor"
          onFocusCapture={(event) => ownPane('editor', event.target as HTMLElement)}
          onPointerDownCapture={() => ownPane('editor')}
          className="robotics-panel robotics-program-panel"
          role={codeDrawerVisible ? 'region' : 'tabpanel'}
          id="robotics-panel-program"
          data-palette-open={paletteOpen}
          data-drawer-open={codeDrawerVisible}
          aria-label={codeDrawerVisible ? 'Выдвижной редактор кода Arduino' : undefined}
          aria-labelledby={codeDrawerVisible ? undefined : 'robotics-tab-program'}
          hidden={!codeOpen}
        >
          <div
            ref={codeHostRef}
            tabIndex={-1}
            className="workbench-shell robotics-program-shell"
            style={{ '--arduino-code-panel-width': `${codeWidth}px` } as CSSProperties}
          >
            {codeMounted ? (
              <ArduinoCodePanel
                key={`${local.openRevision}:${local.programRevision}`}
                controller={programController}
                allowDownload={allowDistribution}
                open={codeOpen}
                drawerWidth={codeWidth}
                onDrawerWidthChange={setCodeWidth}
                mobileHeightPercent={codeHeight}
                onMobileHeightChange={setCodeHeight}
                onClose={() =>
                  codeDrawerVisible ? setCodeDrawerOpen(false) : navigate('electronics')
                }
                programHandleRef={programHandle}
                toolbarAccessory={section === 'program' ? codeAccessory : undefined}
              />
            ) : null}
          </div>
        </section>
        <aside
          className="robotics-observation"
          aria-label="Наблюдение за роботом"
          hidden={split && !observationVisible}
        >
          {section === 'robot' ? (
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
          <details className="robotics-status-popover" open={split ? undefined : true}>
            <summary hidden={!split}>Состояние и Serial</summary>
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
          </details>
        </aside>
        <section
          data-editing-pane="editor"
          onFocusCapture={(event) => ownPane('editor', event.target as HTMLElement)}
          onPointerDownCapture={beginCircuitPointer}
          hidden={split && (section !== 'electronics' || !editorVisible)}
          onPointerUpCapture={finishCircuitPointer}
          onPointerCancelCapture={finishCircuitPointer}
          onLostPointerCapture={loseCircuitPointer}
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
            tabIndex={-1}
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
        <div
          ref={separatorRef}
          className="robotics-side-resizer"
          role="separator"
          hidden={compactSplit}
          aria-label={section === 'program' ? 'Ширина редактора' : 'Ширина панели наблюдения'}
          aria-orientation="vertical"
          aria-valuemin={paneMinimum}
          aria-valuemax={paneMaximum}
          aria-valuenow={paneWidth}
          title="Перетаскивайте границу панели. Стрелки меняют ширину, Home/End — пределы."
          tabIndex={0}
          onPointerDown={sidePointerDown}
          onPointerMove={sidePointerMove}
          onPointerUp={sidePointerEnd}
          onPointerCancel={sidePointerEnd}
          onLostPointerCapture={sidePointerEnd}
          onKeyDown={sideKeyDown}
        />
      </div>
    </main>
  );
}
