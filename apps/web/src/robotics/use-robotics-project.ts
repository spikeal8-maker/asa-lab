import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { analyseArduinoSourceSupport } from '@asa-lab/electronics';
import {
  api,
  type Project,
  type ProjectDraft,
  type ProjectVersion,
  type SchematicDocument,
} from '../api';
import type { EditorPersistenceIssue } from '../components/editor-chrome/EditorPersistenceIndicator';
import { WorkbenchAutosaveScheduler } from '../electronics/workbench-autosave';
import { readArduinoProgramState } from '../electronics/arduino-program-state';
import { cloneJson } from '../electronics/workbench-geometry';
import { retainAnnotationVersion } from '../electronics/workbench-annotations';
import type { ElectronicsWorkbenchProjectHost } from '../electronics/use-electronics-workbench';
import type { SimulationRuntimeStatus } from '../electronics/use-workbench-project-state';
import type { SaveStatus } from '../electronics/workbench-model';
import {
  clearLocalProjectDraft,
  readLocalProjectDraft,
  writeLocalProjectDraft,
} from '../modules/project-local-draft';
import { onSessionLoggedOut } from '../session-fetch';
import {
  parseRoboticsProject,
  validateRoboticsBindings,
  withRoboticsWorld,
  upgradeRoboticsProjectToV3,
  type RoboticsProject,
} from './robotics-project';
import type { RoboticsWorldDocument } from './world';

const HISTORY_LIMIT = 80;
// PostgreSQL JSONB may return object keys in a different order. Only comparisons
// use canonical keys; the attempted API payload stays byte-for-byte retryable.
const bytes = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : entry,
  );
const messageOf = (reason: unknown): string =>
  reason instanceof Error ? reason.message : 'Не удалось выполнить действие.';

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

/** One authoring document and history for the field, assembly, circuit and code.
 * Persistence adapters share this state; neither adapter owns an electrical runtime. */
export function useRoboticsSource(
  initialProject: RoboticsProject,
  options: {
    beforeHistoryChange?: (() => void) | undefined;
    onChange?: ((project: RoboticsProject) => void) | undefined;
  } = {},
) {
  const [robotProject, setRobotProject] = useState(() => cloneJson(initialProject));
  const sourceRef = useRef(robotProject);
  const historyRef = useRef({ entries: [robotProject], cursor: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const runningRef = useRef(false);
  const [simulationStatus, setSimulationStatus] = useState<SimulationRuntimeStatus>('stopped');
  const [openRevision, setOpenRevision] = useState(0);
  const [programRevision, setProgramRevision] = useState(0);
  const programRevisionRef = useRef(programRevision);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const programFlush = useRef<(() => void) | null>(null);
  const registerProgramFlush = useCallback((flush: () => void): (() => void) => {
    programFlush.current = flush;
    return () => {
      if (programFlush.current === flush) programFlush.current = null;
    };
  }, []);
  const flushProgram = useCallback((): void => {
    programFlush.current?.();
  }, []);
  const getProgramRevision = useCallback(() => programRevisionRef.current, []);
  const replaceProgram = useCallback((apply: () => void): void => {
    const previous = programIdentity(sourceRef.current);
    apply();
    if (programIdentity(sourceRef.current) === previous) return;
    // Invalidate old Blockly callbacks synchronously, before React mounts the
    // restored workspace. A field-only history change preserves the live editor.
    programRevisionRef.current += 1;
    setProgramRevision(programRevisionRef.current);
  }, []);
  const publish = useCallback((next: RoboticsProject, record = true): void => {
    if (bytes(next) === bytes(sourceRef.current)) return;
    sourceRef.current = next;
    if (record) {
      const history = historyRef.current;
      const entries = [...history.entries.slice(0, history.cursor + 1), cloneJson(next)].slice(
        -HISTORY_LIMIT,
      );
      historyRef.current = { entries, cursor: entries.length - 1 };
    }
    optionsRef.current.onChange?.(next);
    setRobotProject(next);
  }, []);
  const getCurrentProject = useCallback(() => sourceRef.current, []);
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
  const enableExtendedField = useCallback((): boolean => {
    if (runningRef.current) {
      setNotice('Остановите моделирование, чтобы обновить поле.');
      return false;
    }
    if (sourceRef.current.schemaVersion === 3) return true;
    flushProgram();
    try {
      const history = historyRef.current;
      const entries = history.entries.map(upgradeRoboticsProjectToV3);
      const next = upgradeRoboticsProjectToV3(sourceRef.current);
      historyRef.current = { entries, cursor: history.cursor };
      publish(next, false);
      setNotice('Расширенное поле включено. Выбран учебный режим; динамика доступна в настройках.');
      return true;
    } catch (reason) {
      setNotice(messageOf(reason));
      return false;
    }
  }, [flushProgram, publish]);
  const moveHistory = useCallback(
    (
      direction: -1 | 1,
      allow?: (current: SchematicDocument, target: SchematicDocument) => boolean,
    ): boolean => {
      optionsRef.current.beforeHistoryChange?.();
      flushProgram();
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
    [flushProgram, publish, replaceProgram],
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
  const replaceDocument = useCallback(
    (project: RoboticsProject): void => {
      replaceProgram(() => {
        sourceRef.current = cloneJson(project);
        setRobotProject(sourceRef.current);
      });
      historyRef.current = { entries: [sourceRef.current], cursor: 0 };
      setOpenRevision((value) => value + 1);
    },
    [replaceProgram],
  );
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
    flushProgram();
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
  }, [flushProgram]);
  const resetSimulation = useCallback((): void => {
    runningRef.current = false;
    setSimulationRunning(false);
    setSimulationStatus('stopped');
    setNotice(null);
  }, []);
  return {
    robotProject,
    getCurrentProject,
    getCurrentDocument,
    setWorld,
    enableExtendedField,
    publish,
    replaceDocument,
    registerProgramFlush,
    flushProgram,
    openRevision,
    programRevision,
    getProgramRevision,
    replaceProgram,
    workbench: {
      document: robotProject.circuit,
      getCurrentDocument,
      notice,
      setNotice,
      simulationRunning,
      simulationStatus,
      confirmSimulationStarted,
      canUndo: historyRef.current.cursor > 0,
      canRedo: historyRef.current.cursor < historyRef.current.entries.length - 1,
      undo,
      redo,
      commitDocument,
      toggleSimulation,
      resetSimulation,
    },
  };
}

export interface RoboticsProjectController {
  readonly host: ElectronicsWorkbenchProjectHost;
  readonly robotProject: RoboticsProject;
  readonly getCurrentProject: () => RoboticsProject;
  readonly hasUnsavedChanges: () => boolean;
  readonly setWorld: (world: RoboticsWorldDocument) => boolean;
  readonly enableExtendedField: () => boolean;
  readonly hasSavedProject: boolean;
  readonly openSavedProject: () => boolean;
  readonly openRevision: number;
  readonly programRevision: number;
  readonly getProgramRevision: () => number;
  readonly replaceProgram: (apply: () => void) => void;
  readonly registerProgramFlush: (flush: () => void) => () => void;
  readonly flushProgram: () => void;
}

export interface OpenRoboticsProject {
  readonly project: Project;
  readonly draft: ProjectDraft<RoboticsProject>;
  readonly versions: ProjectVersion[];
}
type OpenState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: OpenRoboticsProject };

/** A stale Open never mounts source for a different project or principal. */
export function useOpenRoboticsProject(
  projectId: string,
  userId: string,
  seatLearner = false,
): OpenState {
  const scope = useMemo(
    () => ({ projectId, userId, seatLearner }),
    [projectId, userId, seatLearner],
  );
  const [state, setState] = useState<{ scope: typeof scope; value: OpenState }>({
    scope,
    value: { kind: 'loading' },
  });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ scope, value: { kind: 'loading' } });
    void api
      .openProject(projectId, controller.signal)
      .then((result) => {
        if (!active || controller.signal.aborted) return;
        if (!result.ok) {
          setState({
            scope,
            value: { kind: 'error', message: result.error.message || 'Не удалось открыть проект.' },
          });
          return;
        }
        const parsed = parseRoboticsProject(result.data.draft.document);
        if (
          result.data.project.id !== projectId ||
          result.data.project.moduleKey !== 'robotics' ||
          !parsed.ok
        ) {
          setState({
            scope,
            value: {
              kind: 'error',
              message: !parsed.ok ? parsed.message : 'Этот проект использует другую среду.',
            },
          });
          return;
        }
        setState({
          scope,
          value: {
            kind: 'ready',
            value: { ...result.data, draft: { ...result.data.draft, document: parsed.project } },
          },
        });
      })
      .catch((reason: unknown) => {
        if (active && !controller.signal.aborted)
          setState({ scope, value: { kind: 'error', message: messageOf(reason) } });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [scope, projectId]);
  return state.scope === scope ? state.value : { kind: 'loading' };
}

interface PendingSave {
  readonly document: RoboticsProject;
  readonly baseRevision: number;
}

/** Existing Project Core persistence, including its deterministic mutation ID.
 * A failed acknowledgement retains the exact attempted document/base revision;
 * retrying it is idempotent even when newer edits already exist in the editor. */
export function useRoboticsProject(
  opened: OpenRoboticsProject,
  userId: string,
  seatLearner = false,
) {
  const projectId = opened.project.id;
  const identityKind = seatLearner ? 'seat' : 'account';
  const storage = useCallback(
    () => (seatLearner ? window.sessionStorage : window.localStorage),
    [seatLearner],
  );
  const [opening] = useState(() => {
    const draft = readLocalProjectDraft(storage, projectId, 'robotics', userId, identityKind);
    const parsed = draft ? parseRoboticsProject(draft.document) : null;
    const restored = parsed?.ok === true && bytes(parsed.project) !== bytes(opened.draft.document);
    return {
      source: restored ? parsed.project : opened.draft.document,
      restored,
      conflict: restored && draft?.baseRevision !== opened.draft.revision,
      invalid: draft !== null && parsed?.ok === false,
      recoveryRevision: restored && draft ? draft.baseRevision : opened.draft.revision,
    };
  });
  const scope = useRef({
    active: true,
    revision: opened.draft.revision,
    recoveryRevision: opening.recoveryRevision,
    serverDocument: opened.draft.document,
    savedBytes: bytes(opened.draft.document),
    pending: null as PendingSave | null,
    promise: null as Promise<boolean> | null,
    conflict: opening.conflict,
    error: opening.conflict
      ? 'Сервер содержит другую версию. Восстановленная работа сохранена в этом браузере; автоматическая отправка остановлена.'
      : (null as string | null),
    issue: opening.conflict ? 'conflict' : (null as EditorPersistenceIssue | null),
  }).current;
  const [project, setProject] = useState(opened.project);
  const projectRef = useRef(project);
  const titleDraftKey = `asa-lab:robotics:pending-title:${identityKind}:${userId}:${projectId}`;
  const [projectTitle, setTitleState] = useState(() => {
    try {
      const raw = storage().getItem(titleDraftKey);
      if (raw) {
        const draft = JSON.parse(raw) as { baseTitle?: unknown; title?: unknown };
        if (draft.baseTitle === project.title && typeof draft.title === 'string')
          return draft.title;
      }
    } catch {
      // Browsers may disable storage. Keep the editor available in memory.
    }
    return project.title;
  });
  const titleRef = useRef(projectTitle);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const renamePending = useRef<Promise<boolean> | null>(null);
  const [revision, setRevision] = useState(scope.revision);
  const [saveError, setSaveError] = useState<string | null>(scope.error);
  const [saveIssue, setSaveIssue] = useState<EditorPersistenceIssue | null>(scope.issue);
  const [localCopySaved, setLocalCopySaved] = useState(opening.restored);
  const persistRecovery = useCallback(
    (document: RoboticsProject): boolean => {
      const saved = writeLocalProjectDraft(storage, {
        projectId,
        userId,
        identityKind,
        moduleKey: 'robotics',
        baseRevision: scope.conflict ? scope.recoveryRevision : scope.revision,
        document,
        ...(!scope.conflict ? { baseDocument: scope.serverDocument } : {}),
      });
      if (scope.active) setLocalCopySaved(saved);
      return saved;
    },
    [storage, projectId, userId, identityKind, scope],
  );
  const source = useRoboticsSource(opening.source, { onChange: persistRecovery });
  const autosaveSchedulerRef = useRef<WorkbenchAutosaveScheduler<string> | null>(null);
  const autoPersistRef = useRef<() => void>(() => {});
  const getCurrentProject = source.getCurrentProject;
  const flushProgram = source.flushProgram;
  const setNotice = source.workbench.setNotice;

  const reportError = useCallback(
    (message: string, issue: EditorPersistenceIssue): void => {
      scope.error = message;
      scope.issue = issue;
      if (!scope.active) return;
      setSaveError(message);
      setSaveIssue(issue);
      setNotice(message);
    },
    [scope, setNotice],
  );
  const clearError = useCallback((): void => {
    scope.error = null;
    scope.issue = null;
    if (scope.active) {
      setSaveError(null);
      setSaveIssue(null);
    }
  }, [scope]);
  const hasUnsavedChanges = useCallback(
    () =>
      bytes(getCurrentProject()) !== scope.savedBytes ||
      titleRef.current !== projectRef.current.title,
    [getCurrentProject, scope],
  );
  const getSavedRevision = useCallback(
    () =>
      scope.active &&
      !scope.pending &&
      !scope.error &&
      bytes(getCurrentProject()) === scope.savedBytes
        ? scope.revision
        : null,
    [getCurrentProject, scope],
  );

  const persist = useCallback(
    (unloading = false, automatic = false): Promise<boolean> => {
      flushProgram();
      if (!scope.active) return Promise.resolve(false);
      if (bytes(getCurrentProject()) !== scope.savedBytes) persistRecovery(getCurrentProject());
      if (scope.conflict) return Promise.resolve(false);
      if (scope.promise) {
        // A manual Save must still include newer edits made during an automatic request.
        return automatic
          ? scope.promise
          : scope.promise.then((saved) => (saved ? persist(unloading, false) : false));
      }
      if (!scope.pending && bytes(getCurrentProject()) === scope.savedBytes)
        return Promise.resolve(true);
      setSaving(true);
      clearError();
      const run = async (): Promise<boolean> => {
        while (scope.active) {
          const attempt = scope.pending ?? {
            document: cloneJson(getCurrentProject()),
            baseRevision: scope.revision,
          };
          scope.pending = attempt;
          let response: Awaited<ReturnType<typeof api.saveDraft<RoboticsProject>>>;
          try {
            response = await api.saveDraft(projectId, attempt.document, attempt.baseRevision, {
              unloading,
            });
          } catch (reason) {
            if (scope.active)
              reportError(
                `Сохранение не подтверждено. ${messageOf(reason)} Повторите отправку.`,
                'offline',
              );
            return false;
          }
          if (!scope.active) return false;
          if (!response.ok) {
            const status = response.status;
            // These responses confirm that this payload was rejected. A learner
            // can correct it and send the current source. Ambiguous delivery and
            // conflicts retain their original attempt and base revision.
            if ([400, 413, 422].includes(status)) scope.pending = null;
            const issue: EditorPersistenceIssue =
              status === 409
                ? 'conflict'
                : status === 401 || status === 403
                  ? 'auth'
                  : status === 0
                    ? 'offline'
                    : 'server';
            scope.conflict = issue === 'conflict';
            if (scope.conflict) scope.recoveryRevision = attempt.baseRevision;
            reportError(
              issue === 'conflict'
                ? 'Сервер содержит другую версию. Ваши изменения остаются в редакторе; автоматическая отправка остановлена.'
                : response.error.message || 'Сохранение не подтверждено. Повторите отправку.',
              issue,
            );
            persistRecovery(getCurrentProject());
            return false;
          }
          const parsed = parseRoboticsProject(response.data.draft.document);
          const submitted = parseRoboticsProject(attempt.document);
          if (
            !parsed.ok ||
            !submitted.ok ||
            bytes(parsed.project) !== bytes(submitted.project) ||
            response.data.draft.projectId !== projectId ||
            !Number.isSafeInteger(response.data.draft.revision) ||
            response.data.draft.revision <= attempt.baseRevision
          ) {
            reportError(
              'Сервер не подтвердил корректную версию проекта. Повторите сохранение.',
              'server',
            );
            return false;
          }
          // An acknowledgement is evidence for these exact submitted bytes only.
          // It never replaces source, Undo history or a newer program workspace.
          scope.revision = response.data.draft.revision;
          scope.recoveryRevision = scope.revision;
          scope.serverDocument = parsed.project;
          scope.savedBytes = bytes(attempt.document);
          scope.pending = null;
          setRevision(scope.revision);
          clearError();
          if (bytes(getCurrentProject()) === scope.savedBytes) {
            const recovery = readLocalProjectDraft(
              storage,
              projectId,
              'robotics',
              userId,
              identityKind,
            );
            if (recovery && bytes(recovery.document) === scope.savedBytes)
              clearLocalProjectDraft(storage, projectId, userId, identityKind);
            setLocalCopySaved(false);
            return true;
          }
          persistRecovery(getCurrentProject());
          // A timed save sends one snapshot only. New edits wait for the next minute;
          // explicit Save still drains its current source before returning success.
          if (automatic) return true;
        }
        return false;
      };
      const pending = run().finally(() => {
        if (scope.promise === pending) scope.promise = null;
        if (scope.active) setSaving(false);
      });
      scope.promise = pending;
      return pending;
    },
    [
      scope,
      projectId,
      userId,
      identityKind,
      storage,
      flushProgram,
      getCurrentProject,
      persistRecovery,
      reportError,
      clearError,
    ],
  );

  const setProjectTitle = useCallback(
    (update: SetStateAction<string>): void => {
      const next = typeof update === 'function' ? update(titleRef.current) : update;
      titleRef.current = next;
      setTitleState(next);
      try {
        if (next === projectRef.current.title) storage().removeItem(titleDraftKey);
        else
          storage().setItem(
            titleDraftKey,
            JSON.stringify({ baseTitle: projectRef.current.title, title: next }),
          );
      } catch {
        // The in-memory draft remains editable if storage is unavailable.
      }
    },
    [storage, titleDraftKey],
  );
  const rename = useCallback((): Promise<boolean> => {
    if (!scope.active) return Promise.resolve(false);
    if (renamePending.current) return renamePending.current;
    const run = async (): Promise<boolean> => {
      while (scope.active && titleRef.current !== projectRef.current.title) {
        const title = titleRef.current.trim();
        if (!title || title.length > 255) {
          reportError('Введите название от 1 до 255 символов.', 'server');
          return false;
        }
        const response = await api.renameProject(projectId, title);
        if (!scope.active) return false;
        if (!response.ok) {
          reportError(
            response.error.message || 'Не удалось сохранить название проекта.',
            response.status === 401 ? 'auth' : 'server',
          );
          return false;
        }
        projectRef.current = response.data.project;
        setProject(projectRef.current);
        // Preserve the newest in-browser title if it changed during this request.
        setProjectTitle(
          titleRef.current.trim() === title ? projectRef.current.title : titleRef.current,
        );
      }
      return scope.active;
    };
    setRenaming(true);
    const pending = run()
      .catch((reason: unknown) => {
        reportError(messageOf(reason), 'offline');
        return false;
      })
      .finally(() => {
        if (renamePending.current === pending) renamePending.current = null;
        if (scope.active) setRenaming(false);
      });
    renamePending.current = pending;
    return pending;
  }, [scope, projectId, reportError, setProjectTitle]);
  const saveAll = useCallback(async (): Promise<boolean> => {
    const sourceSaved = await persist();
    if (!sourceSaved) return false;
    const titleSaved = await rename();
    if (titleSaved && !scope.pending && !hasUnsavedChanges()) {
      clearError();
      setNotice(null);
      return true;
    }
    return false;
  }, [persist, rename, scope, hasUnsavedChanges, clearError, setNotice]);
  const saveNow = useCallback(async (): Promise<void> => {
    await saveAll();
  }, [saveAll]);
  const renameProject = useCallback(async (): Promise<void> => {
    if (await rename()) {
      if (!scope.pending && !scope.conflict) clearError();
    }
  }, [rename, scope, clearError]);
  const [versions, setVersions] = useState(opened.versions);
  const refreshMetadata = useCallback(async (): Promise<void> => {
    const response = await api.openProject(projectId);
    if (!scope.active) return;
    if (!response.ok) {
      reportError(response.error.message || 'Не удалось обновить свойства проекта.', 'server');
      return;
    }
    if (response.data.project.id !== projectId || response.data.project.moduleKey !== 'robotics')
      return;
    const editingName = titleRef.current !== projectRef.current.title;
    projectRef.current = response.data.project;
    setProject(projectRef.current);
    if (!editingName) setProjectTitle(projectRef.current.title);
    setVersions(response.data.versions);
    // A metadata refresh must never install another tab's document or revision.
  }, [projectId, scope, reportError, setProjectTitle]);
  const checkpoint = useCallback(async (): Promise<void> => {
    if (!(await saveAll())) return;
    const response = await api.createCheckpoint(projectId);
    if (!scope.active) return;
    if (response.ok) {
      setVersions((current) => [response.data.version, ...current]);
      setNotice('Версия проекта сохранена.');
    } else reportError(response.error.message || 'Не удалось создать версию.', 'server');
  }, [saveAll, scope, projectId, setNotice, reportError]);

  useEffect(() => {
    if (opening.conflict) setNotice(scope.error);
    else if (opening.restored)
      setNotice('Восстановлены последние изменения этого аккаунта из браузера.');
    else if (opening.invalid)
      setNotice('Локальная копия повреждена. Открыта сохранённая серверная версия.');
  }, [opening, scope, setNotice]);
  // The same one-minute, first-dirty-edit scheduler used by Electronics.
  // Constant simulation frames and continued edits never restart the deadline.
  autoPersistRef.current = () => {
    void (async () => {
      if (!(await persist(false, true))) return;
      if (titleRef.current !== projectRef.current.title) await rename();
    })();
  };
  useEffect(() => {
    const scheduler = new WorkbenchAutosaveScheduler<string>(
      () => {
        const current = `${bytes(getCurrentProject())}\u0000${titleRef.current}`;
        const saved = `${scope.savedBytes}\u0000${projectRef.current.title}`;
        return {
          document: current,
          savedDocument: saved,
          savingDocument: scope.promise || renamePending.current ? current : null,
          failed: Boolean(scope.error) || scope.conflict,
          paused: false,
        };
      },
      () => autoPersistRef.current(),
    );
    autosaveSchedulerRef.current = scheduler;
    scheduler.update();
    return () => {
      scheduler.dispose();
      if (autosaveSchedulerRef.current === scheduler) autosaveSchedulerRef.current = null;
    };
  }, [scope, getCurrentProject]);
  useEffect(() => {
    autosaveSchedulerRef.current?.update();
  }, [source.robotProject, projectTitle, scope, revision, saving, renaming, saveError]);
  useEffect(() => {
    scope.active = true;
    const recover = (): void => {
      flushProgram();
      if (bytes(getCurrentProject()) !== scope.savedBytes) persistRecovery(getCurrentProject());
    };
    const hide = (): void => {
      // A browser tab becoming hidden is not permission to bypass the minute.
      // The last edit is already cached locally, so no network write is needed.
      recover();
    };
    const visibility = (): void => {
      if (document.visibilityState === 'hidden') hide();
    };
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      recover();
      if (hasUnsavedChanges() || scope.pending) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const online = (): void => {
      if (scope.issue !== 'offline') return;
      // Reconnect re-arms the normal minute, never an immediate retry burst.
      clearError();
      autosaveSchedulerRef.current?.update();
    };
    const loggedOut = onSessionLoggedOut(() => {
      recover();
      scope.active = false;
    });
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      if (scope.active) hide();
      scope.active = false;
      loggedOut();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [scope, flushProgram, getCurrentProject, persistRecovery, hasUnsavedChanges, clearError]);

  const saveStatus: SaveStatus = saveError
    ? 'error'
    : saving || renaming
      ? 'saving'
      : hasUnsavedChanges()
        ? 'dirty'
        : 'saved';
  const host: ElectronicsWorkbenchProjectHost = {
    ...source.workbench,
    project,
    serverRevision: revision,
    result: null,
    versions,
    status: 'ready',
    saveStatus,
    saveError,
    saveIssue,
    localCopySaved,
    exportEmergencyCopy: () =>
      setNotice(
        'Скачивание проекта недоступно. Сохраните работу в аккаунте или оставьте вкладку открытой до восстановления связи.',
      ),
    saveBeforeLeave: saveNow,
    busy: saving || renaming,
    projectTitle,
    setProjectTitle,
    renameProject,
    saveNow,
    checkpoint,
  };
  return {
    ...source,
    host,
    hasUnsavedChanges,
    getSavedRevision,
    saveAll,
    refreshMetadata,
    getProject: () => projectRef.current,
    cancelTitleEdit: () => setProjectTitle(projectRef.current.title),
    hasSavedProject: true,
    openSavedProject: () => false,
  } satisfies RoboticsProjectController & Record<string, unknown>;
}
