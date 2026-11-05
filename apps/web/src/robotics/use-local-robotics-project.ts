import { useCallback, useRef, useState, type SetStateAction } from 'react';
import { analyseArduinoSourceSupport } from '@asa-lab/electronics';
import type { SchematicDocument } from '../api';
import { readArduinoProgramState } from '../electronics/arduino-program-state';
import type { ElectronicsWorkbenchProjectHost } from '../electronics/use-electronics-workbench';
import type { SimulationRuntimeStatus } from '../electronics/use-workbench-project-state';
import type { SaveStatus } from '../electronics/workbench-model';
import { cloneJson } from '../electronics/workbench-geometry';
import { retainAnnotationVersion } from '../electronics/workbench-annotations';
import {
  parseRoboticsProject,
  validateRoboticsBindings,
  withRoboticsWorld,
  type RoboticsProject,
} from './robotics-project';
import type { RoboticsWorldDocument } from './world';

export const ROBOTICS_LOCAL_PROJECT_KEY = 'asa-lab:robotics:local-project:v1';
const HISTORY_LIMIT = 80;

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Хранилище браузера недоступно.';
}

function programIdentity(project: RoboticsProject): string {
  return JSON.stringify(
    project.circuit.components
      .filter(
        (component) =>
          component.componentTypeId === 'arduino-uno' || component.variantId === 'arduino-uno',
      )
      .map((component) => [component.id, readArduinoProgramState(component.stateProperties)]),
  );
}

function readLocalProject(initial: RoboticsProject) {
  try {
    const raw = window.localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY);
    if (!raw) return { project: initial, saved: false, notice: null };
    const parsed = parseRoboticsProject(JSON.parse(raw));
    if (!parsed.ok)
      return {
        project: initial,
        saved: false,
        notice: `Сохранение не открыто: ${parsed.message}`,
      };
    return { project: parsed.project, saved: true, notice: null };
  } catch (reason) {
    return {
      project: initial,
      saved: false,
      notice: `Не удалось прочитать локальное сохранение. ${messageOf(reason)}`,
    };
  }
}

/** A local document host for the shared workbench; it owns no electrical runtime. */
export function useLocalRoboticsProject(
  initialProject: RoboticsProject,
  beforeHistoryChange?: () => void,
) {
  const [opening] = useState(() => readLocalProject(cloneJson(initialProject)));
  const [robotProject, setRobotProject] = useState(opening.project);
  const sourceRef = useRef(robotProject);
  const historyRef = useRef({ entries: [robotProject], cursor: 0 });
  const savedBytesRef = useRef<string | null>(opening.saved ? JSON.stringify(robotProject) : null);
  const [hasSavedProject, setHasSavedProject] = useState(opening.saved);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(opening.saved ? 'saved' : 'dirty');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveFailedRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(opening.notice);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const runningRef = useRef(false);
  const [simulationStatus, setSimulationStatus] = useState<SimulationRuntimeStatus>('stopped');
  const [openRevision, setOpenRevision] = useState(0);
  const [programRevision, setProgramRevision] = useState(0);
  const programRevisionRef = useRef(programRevision);
  const beforeHistoryChangeRef = useRef(beforeHistoryChange);
  beforeHistoryChangeRef.current = beforeHistoryChange;

  const getProgramRevision = useCallback(() => programRevisionRef.current, []);
  const replaceProgram = useCallback((apply: () => void): void => {
    const previous = programIdentity(sourceRef.current);
    apply();
    if (programIdentity(sourceRef.current) === previous) return;
    // History, Open and explicit examples all invalidate the live editor at
    // this source boundary. The ref also rejects stale publications before
    // React has had a chance to mount the restored workspace.
    programRevisionRef.current += 1;
    setProgramRevision(programRevisionRef.current);
  }, []);

  const publish = useCallback((next: RoboticsProject, record = true): void => {
    if (JSON.stringify(next) === JSON.stringify(sourceRef.current)) return;
    // Arduino may commit several edits in one browser event. The next edit must
    // observe the just-committed source, before React has rendered it.
    sourceRef.current = next;
    if (record) {
      const history = historyRef.current;
      const entries = [...history.entries.slice(0, history.cursor + 1), cloneJson(next)].slice(
        -HISTORY_LIMIT,
      );
      historyRef.current = { entries, cursor: entries.length - 1 };
    }
    setRobotProject(next);
    setSaveStatus(
      saveFailedRef.current
        ? 'error'
        : JSON.stringify(next) === savedBytesRef.current
          ? 'saved'
          : 'dirty',
    );
  }, []);

  const getCurrentProject = useCallback(() => sourceRef.current, []);
  const hasUnsavedChanges = useCallback(
    () => JSON.stringify(sourceRef.current) !== savedBytesRef.current,
    [],
  );
  const getCurrentDocument = useCallback(() => sourceRef.current.circuit, []);
  const commitDocument = useCallback(
    (next: SchematicDocument, message?: string): void => {
      const circuit = next.simulation.running
        ? { ...next, simulation: { ...next.simulation, running: false } }
        : next;
      publish({ ...sourceRef.current, circuit });
      if (message) setNotice(message);
    },
    [publish],
  );

  const setWorld = useCallback(
    (world: RoboticsWorldDocument): boolean => {
      if (runningRef.current) {
        setNotice('Остановите моделирование, чтобы изменить поле.');
        return false;
      }
      try {
        publish(withRoboticsWorld(sourceRef.current, world));
        return true;
      } catch (reason) {
        setNotice(messageOf(reason));
        return false;
      }
    },
    [publish],
  );

  const moveHistory = useCallback(
    (
      direction: -1 | 1,
      allow?: (current: SchematicDocument, target: SchematicDocument) => boolean,
    ): boolean => {
      beforeHistoryChangeRef.current?.();
      const history = historyRef.current;
      const target = history.entries[history.cursor + direction];
      const current = sourceRef.current;
      if (!target || (allow && !allow(current.circuit, target.circuit))) return false;
      if (
        runningRef.current &&
        (!allow || JSON.stringify(current.world) !== JSON.stringify(target.world))
      )
        return false;
      history.cursor += direction;
      replaceProgram(() =>
        publish(
          {
            ...cloneJson(target),
            circuit: retainAnnotationVersion(current.circuit, cloneJson(target.circuit)),
          },
          false,
        ),
      );
      setNotice(direction < 0 ? 'Изменение отменено.' : 'Изменение повторено.');
      return true;
    },
    [publish, replaceProgram],
  );
  const undo = useCallback(
    (allow?: (current: SchematicDocument, target: SchematicDocument) => boolean) =>
      moveHistory(-1, allow),
    [moveHistory],
  );
  const redo = useCallback(
    (allow?: (current: SchematicDocument, target: SchematicDocument) => boolean) =>
      moveHistory(1, allow),
    [moveHistory],
  );

  const saveNow = useCallback(async (): Promise<void> => {
    try {
      const bytes = JSON.stringify(sourceRef.current);
      window.localStorage.setItem(ROBOTICS_LOCAL_PROJECT_KEY, bytes);
      if (window.localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY) !== bytes)
        throw new Error('Браузер не подтвердил сохранение.');
      savedBytesRef.current = bytes;
      saveFailedRef.current = false;
      setHasSavedProject(true);
      setSaveError(null);
      setSaveStatus('saved');
      setNotice('Проект сохранён в этом браузере на этом устройстве.');
    } catch (reason) {
      const message = `Не удалось сохранить проект. ${messageOf(reason)}`;
      saveFailedRef.current = true;
      setSaveStatus('error');
      setSaveError(message);
      setNotice(message);
    }
  }, []);

  const openSavedProject = useCallback((): boolean => {
    if (runningRef.current) {
      setNotice('Остановите моделирование перед открытием проекта.');
      return false;
    }
    try {
      const raw = window.localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY);
      if (!raw) {
        setHasSavedProject(false);
        setNotice('В этом браузере пока нет сохранённого проекта.');
        return false;
      }
      const parsed = parseRoboticsProject(JSON.parse(raw));
      if (!parsed.ok) {
        setNotice(`Сохранение не открыто: ${parsed.message}`);
        return false;
      }
      const project = parsed.project;
      replaceProgram(() => {
        sourceRef.current = project;
        setRobotProject(project);
      });
      historyRef.current = { entries: [project], cursor: 0 };
      savedBytesRef.current = JSON.stringify(project);
      saveFailedRef.current = false;
      setHasSavedProject(true);
      setSaveStatus('saved');
      setSaveError(null);
      setOpenRevision((value) => value + 1);
      setNotice('Открыт проект, сохранённый на этом устройстве.');
      return true;
    } catch (reason) {
      setNotice(`Не удалось открыть сохранение. ${messageOf(reason)}`);
      return false;
    }
  }, [replaceProgram]);

  const confirmSimulationStarted = useCallback((): void => {
    setSimulationStatus((current) => (current === 'starting' ? 'running' : current));
  }, []);
  const toggleSimulation = useCallback(async (): Promise<void> => {
    if (runningRef.current) {
      runningRef.current = false;
      setSimulationRunning(false);
      setSimulationStatus('stopped');
      setNotice(null);
      return;
    }
    const error = validateRoboticsBindings(sourceRef.current);
    if (error) {
      setNotice(error);
      return;
    }
    for (const board of sourceRef.current.circuit.components) {
      if (board.componentTypeId !== 'arduino-uno' && board.variantId !== 'arduino-uno') continue;
      const program = readArduinoProgramState(board.stateProperties);
      const unsupported = analyseArduinoSourceSupport(program.source).find(
        (diagnostic) => diagnostic.status === 'unsupported',
      );
      if (unsupported) {
        setNotice(`Arduino: строка ${unsupported.line}. ${unsupported.message}`);
        return;
      }
    }
    runningRef.current = true;
    setSimulationStatus('starting');
    setSimulationRunning(true);
    setNotice(null);
  }, []);
  const resetSimulation = useCallback((): void => {
    runningRef.current = false;
    setSimulationRunning(false);
    setSimulationStatus('stopped');
    setNotice(null);
  }, []);
  const setProjectTitle = useCallback(
    (update: SetStateAction<string>): void => {
      const current = sourceRef.current;
      const title = typeof update === 'function' ? update(current.title) : update;
      publish({ ...current, title });
    },
    [publish],
  );
  const renameProject = useCallback(async (): Promise<void> => {
    const current = sourceRef.current;
    publish({ ...current, title: current.title.trim() || 'Мой робот' });
  }, [publish]);
  const exportEmergencyCopy = useCallback((): void => {
    setNotice('Скачивание проекта недоступно. Используйте «Сохранить» на этом устройстве.');
  }, []);

  const host: ElectronicsWorkbenchProjectHost = {
    project: null,
    document: robotProject.circuit,
    serverRevision: null,
    getCurrentDocument,
    result: null,
    versions: [],
    status: 'ready',
    saveStatus,
    saveError,
    saveIssue: null,
    localCopySaved: saveStatus === 'saved',
    exportEmergencyCopy,
    saveBeforeLeave: saveNow,
    notice,
    setNotice,
    simulationRunning,
    simulationStatus,
    confirmSimulationStarted,
    busy: false,
    projectTitle: robotProject.title,
    setProjectTitle,
    canUndo: historyRef.current.cursor > 0,
    canRedo: historyRef.current.cursor < historyRef.current.entries.length - 1,
    undo,
    redo,
    commitDocument,
    saveNow,
    toggleSimulation,
    resetSimulation,
    checkpoint: saveNow,
    renameProject,
  };

  return {
    host,
    robotProject,
    getCurrentProject,
    hasUnsavedChanges,
    setWorld,
    hasSavedProject,
    openSavedProject,
    openRevision,
    programRevision,
    getProgramRevision,
    replaceProgram,
  };
}
