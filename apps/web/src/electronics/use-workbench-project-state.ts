import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type Project,
  type ProjectVersion,
  type SchematicDocument,
  type SolveResult,
} from '../api';
import { cloneJson } from './workbench-geometry';
import { catalogEntry } from './component-catalog';
import { defaultProductionType, productionBreadboard } from './production-manifest-adapter';
import { snapComponentToBreadboard } from './workbench-document';
import type { HistoryState, SaveStatus } from './workbench-model';
import { autosaveIsDue, draftSaveStatus } from './workbench-autosave';
import { prepareLiveSimulationStart } from './live-simulation';
import { electronicsDocumentsEqual, mergeElectronicsDocuments } from './electronics-document-merge';
import {
  clearLocalProjectDraft,
  readLocalProjectDraft,
  writeLocalProjectDraft,
} from '../modules/project-local-draft';

export type SimulationRuntimeStatus =
  'stopped' | 'validating' | 'starting' | 'running' | 'stopping';

function isLocalSchematicDocument(value: unknown): value is SchematicDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['schemaVersion'] === 'number' &&
    Array.isArray(candidate['components']) &&
    Array.isArray(candidate['connections'])
  );
}

function migratedTerminal(
  component: SchematicDocument['components'][number] | undefined,
  terminal: string,
): string {
  if (!component) return terminal;
  const entry = catalogEntry(component);
  if (entry?.terminals[terminal]) return terminal;
  const aliases: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    source: {
      a: entry?.terminals['BAT+'] ? 'BAT+' : 'positive',
      b: entry?.terminals['BAT-'] ? 'BAT-' : 'negative',
    },
    resistor: { a: 'lead-1', b: 'lead-2' },
    led: { a: 'anode', b: 'cathode' },
    button: { a: 'SW-A1', b: 'SW-B1' },
    switch: { a: 'common', b: component.state ? 'throw-right' : 'throw-left' },
    potentiometer: { a: 'terminal-1', b: 'terminal-2', wiper: 'wiper' },
    diode: { a: 'anode', b: 'cathode' },
    lamp: { a: 'L1', b: 'L2' },
  };
  const migrated = aliases[component.kind]?.[terminal] ?? terminal;
  return entry?.terminals[migrated] ? migrated : terminal;
}

export function normalizeLoadedDocument(document: SchematicDocument): SchematicDocument {
  const legacy = document as SchematicDocument & {
    schemaVersion?: number;
    viewport?: SchematicDocument['viewport'];
    simulation?: SchematicDocument['simulation'];
  };
  const components = document.components.map((component) => {
    const componentTypeId = component.componentTypeId ?? defaultProductionType(component.kind);
    const entry = componentTypeId ? catalogEntry(componentTypeId) : null;
    const board = componentTypeId ? productionBreadboard(componentTypeId) : null;
    const productionPinIds = Object.keys(entry?.terminals ?? {});
    const pinIds =
      productionPinIds.length > 0 &&
      (!component.pinIds || component.pinIds.some((pinId) => !entry?.terminals[pinId]))
        ? productionPinIds
        : (component.pinIds ?? productionPinIds);
    const internalConnections =
      component.internalConnections ??
      (board
        ? Object.values(board.groups).flatMap((holes) => {
            const first = holes[0];
            return first ? holes.slice(1).map((hole) => [first, hole] as [string, string]) : [];
          })
        : componentTypeId === 'button-tactile-6mm'
          ? ([
              ['SW-A1', 'SW-A2'],
              ['SW-B1', 'SW-B2'],
            ] as [string, string][])
          : componentTypeId === 'seven-segment-display'
            ? ([['top-3', 'bottom-3']] as [string, string][])
            : []);
    return {
      ...component,
      ...(componentTypeId
        ? { componentTypeId, variantId: component.variantId ?? componentTypeId }
        : {}),
      stateProperties: { ...entry?.defaultStateProperties, ...component.stateProperties },
      pinIds,
      ...(internalConnections.length > 0 ? { internalConnections } : {}),
    };
  });
  const componentById = new Map(components.map((component) => [component.id, component]));
  const connections = document.connections.map((connection) => ({
    ...connection,
    from: {
      ...connection.from,
      terminal: migratedTerminal(
        componentById.get(connection.from.componentId),
        connection.from.terminal,
      ),
    },
    to: {
      ...connection.to,
      terminal: migratedTerminal(
        componentById.get(connection.to.componentId),
        connection.to.terminal,
      ),
    },
  }));
  let normalized: SchematicDocument = {
    ...document,
    schemaVersion: 4,
    components,
    connections,
    viewport: legacy.viewport ?? { x: 0, y: 0, zoom: 1 },
    // A document opens with the simulation stopped, whatever it was doing when it
    // was last saved. Running is something the person is doing, not something the
    // circuit is: reloading the page used to resume a simulation nobody started,
    // with the board locked against editing for a reason that had scrolled off
    // the screen an hour earlier.
    simulation: { ...(legacy.simulation ?? { maxIterations: 24 }), running: false },
  };
  for (const component of normalized.components) {
    if (Object.keys(component.holeBindings ?? {}).length > 0) {
      normalized = snapComponentToBreadboard(normalized, component.id);
    }
  }
  return normalized;
}

export function useWorkbenchProjectState(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocumentState] = useState<SchematicDocument | null>(null);
  const [savedDocument, setSavedDocument] = useState<SchematicDocument | null>(null);
  const [savingDocument, setSavingDocument] = useState<SchematicDocument | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  // Why the last save failed. The reason used to travel in a notice that cleared
  // itself after two seconds, leaving the word "Ошибка сохранения" and nothing
  // to act on — the one piece of information that mattered was the first to go.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<SimulationRuntimeStatus>('stopped');
  const [busy, setBusy] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [historyTick, setHistoryTick] = useState(0);

  const historyRef = useRef<HistoryState>({ entries: [], cursor: -1 });
  // Read when a save resolves: React state still holds the document as it was
  // when the request started.
  const documentRef = useRef<SchematicDocument | null>(null);
  const savedDocumentRef = useRef<SchematicDocument | null>(null);
  const savingDocumentRef = useRef<SchematicDocument | null>(null);
  // Exact server document at serverRevisionRef. Unlike savedDocument, this is
  // never a locally merged view and can therefore serve as the base of a safe
  // three-way merge after a 409 response.
  const serverDocumentRef = useRef<SchematicDocument | null>(null);
  // Saves run one at a time and in call order, so the stored draft cannot end up
  // holding an older document than the one the editor last sent.
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // A queued save can still be in flight when the hook is pointed at another
  // project. Its response describes the previous project and must not be
  // written into the new one's state.
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const serverRevisionRef = useRef<number | null>(null);

  const saveStatus = draftSaveStatus({
    document,
    savedDocument,
    savingDocument,
    failed: saveFailed,
  });
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;
  const saveFailedRef = useRef(saveFailed);
  saveFailedRef.current = saveFailed;

  // Every document write goes through here so the ref and the dirty state move
  // together: no call site can change the document and forget to mark it unsaved.
  const setDocument = useCallback(
    (next: SchematicDocument): void => {
      documentRef.current = next;
      const baseRevision = serverRevisionRef.current;
      if (baseRevision !== null) {
        writeLocalProjectDraft(window.localStorage, {
          projectId,
          moduleKey: 'electronics',
          baseRevision,
          ...(serverDocumentRef.current ? { baseDocument: serverDocumentRef.current } : {}),
          document: next,
        });
      }
      saveFailedRef.current = false;
      setSaveFailed(false);
      setSaveError(null);
      setDocumentState(next);
    },
    [projectId],
  );

  const initialiseHistory = useCallback((next: SchematicDocument) => {
    historyRef.current = { entries: [cloneJson(next)], cursor: 0 };
    setHistoryTick((value) => value + 1);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    const response = await api.openProject<SchematicDocument, SolveResult>(projectId);
    if (!response.ok) {
      setStatus('error');
      return;
    }
    setProject(response.data.project);
    setProjectTitle(response.data.project.title);
    const serverDocument = normalizeLoadedDocument(response.data.draft.document);
    const migrated =
      JSON.stringify(serverDocument) !== JSON.stringify(response.data.draft.document);
    const local = readLocalProjectDraft(window.localStorage, projectId, 'electronics');
    const localDocument =
      local && isLocalSchematicDocument(local.document)
        ? normalizeLoadedDocument(local.document)
        : null;
    const localBaseDocument =
      local?.baseDocument && isLocalSchematicDocument(local.baseDocument)
        ? normalizeLoadedDocument(local.baseDocument)
        : null;
    const localMatchesServer =
      localDocument !== null && electronicsDocumentsEqual(localDocument, serverDocument);
    const restored = localDocument !== null && !localMatchesServer;
    let revisionConflict = false;
    let mergedLocalDraft = false;
    let nextDocument = restored ? (localDocument as SchematicDocument) : serverDocument;
    serverDocumentRef.current = serverDocument;
    serverRevisionRef.current = response.data.draft.revision;
    if (restored && local && local.baseRevision !== response.data.draft.revision) {
      const merged = localBaseDocument
        ? mergeElectronicsDocuments(localBaseDocument, nextDocument, serverDocument)
        : null;
      if (merged?.ok) {
        nextDocument = merged.document;
        mergedLocalDraft = true;
        writeLocalProjectDraft(window.localStorage, {
          projectId,
          moduleKey: 'electronics',
          baseRevision: response.data.draft.revision,
          baseDocument: serverDocument,
          document: nextDocument,
        });
      } else {
        revisionConflict = true;
        // Keep the original base revision so the next edit cannot silently
        // overwrite the newer server document. A later save will retry the
        // same safe merge or return the actionable conflict again.
        serverRevisionRef.current = local.baseRevision;
        serverDocumentRef.current = localBaseDocument;
      }
    }
    documentRef.current = nextDocument;
    setSaveFailed(false);
    setSaveError(null);
    setDocumentState(nextDocument);
    setResult(response.data.result);
    setVersions(response.data.versions);
    // A migrated document is not what the server holds, so it stays unsaved
    // until autosave writes the migration back.
    const knownSavedDocument = restored ? serverDocument : migrated ? null : nextDocument;
    savedDocumentRef.current = knownSavedDocument;
    setSavedDocument(knownSavedDocument);
    savingDocumentRef.current = null;
    setSavingDocument(null);
    setSimulationRunning(nextDocument.simulation.running);
    setSimulationStatus(nextDocument.simulation.running ? 'running' : 'stopped');
    initialiseHistory(nextDocument);
    if (!restored || localMatchesServer) clearLocalProjectDraft(window.localStorage, projectId);
    if (revisionConflict) {
      setSaveFailed(true);
      setSaveError(
        'Серверная версия изменилась, а тот же элемент схемы имеет несовместимые локальные правки. Локальный черновик сохранён и ничего не перезаписано.',
      );
      setNotice('Нужен выбор версии для одного одновременно изменённого элемента.');
    } else if (mergedLocalDraft) {
      setNotice('Независимые изменения схемы автоматически совмещены.');
    } else if (restored) {
      setNotice('Восстановлены несохранённые изменения из этого браузера.');
    }
    setStatus('ready');
  }, [initialiseHistory, projectId, setDocument]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== 'ready' || simulationRunning) return;
    let active = true;
    let requestInFlight = false;
    const synchronize = async (): Promise<void> => {
      if (
        requestInFlight ||
        saveFailedRef.current ||
        savingDocumentRef.current !== null ||
        documentRef.current === null ||
        documentRef.current !== savedDocumentRef.current
      ) {
        return;
      }
      requestInFlight = true;
      try {
        const response = await api.openProject<SchematicDocument, SolveResult>(projectId);
        if (
          !active ||
          !response.ok ||
          response.data.draft.revision <= (serverRevisionRef.current ?? -1) ||
          documentRef.current !== savedDocumentRef.current
        ) {
          return;
        }
        const remoteDocument = normalizeLoadedDocument(response.data.draft.document);
        serverRevisionRef.current = response.data.draft.revision;
        serverDocumentRef.current = remoteDocument;
        documentRef.current = remoteDocument;
        savedDocumentRef.current = remoteDocument;
        setProject(response.data.project);
        setProjectTitle(response.data.project.title);
        setDocumentState(remoteDocument);
        setSavedDocument(remoteDocument);
        setResult(response.data.result);
        setVersions(response.data.versions);
        clearLocalProjectDraft(window.localStorage, projectId);
        initialiseHistory(remoteDocument);
        setNotice('Получены изменения общей схемы.');
      } finally {
        requestInFlight = false;
      }
    };
    const interval = window.setInterval(() => void synchronize(), 3_000);
    const onFocus = (): void => void synchronize();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [initialiseHistory, projectId, simulationRunning, status]);

  const pushHistory = useCallback((next: SchematicDocument): void => {
    const state = historyRef.current;
    const current = state.entries[state.cursor];
    if (current && JSON.stringify(current) === JSON.stringify(next)) return;
    const entries = [...state.entries.slice(0, state.cursor + 1), cloneJson(next)].slice(-80);
    historyRef.current = { entries, cursor: entries.length - 1 };
    setHistoryTick((value) => value + 1);
  }, []);

  const commitDocument = useCallback(
    (next: SchematicDocument, message?: string): void => {
      setDocument(next);
      pushHistory(next);
      if (message) setNotice(message);
    },
    [pushHistory, setDocument],
  );

  const canUndo = historyRef.current.cursor > 0;
  const canRedo =
    historyRef.current.cursor >= 0 &&
    historyRef.current.cursor < historyRef.current.entries.length - 1;
  void historyTick;

  function undo(): void {
    const history = historyRef.current;
    if (history.cursor <= 0) return;
    history.cursor -= 1;
    setDocument(cloneJson(history.entries[history.cursor] as SchematicDocument));
    setHistoryTick((value) => value + 1);
    setNotice('Последнее изменение отменено.');
  }

  function redo(): void {
    const history = historyRef.current;
    if (history.cursor >= history.entries.length - 1) return;
    history.cursor += 1;
    setDocument(cloneJson(history.entries[history.cursor] as SchematicDocument));
    setHistoryTick((value) => value + 1);
    setNotice('Изменение повторено.');
  }

  const sendDraft = useCallback(
    async (nextDocument: SchematicDocument, quiet: boolean): Promise<SolveResult | null> => {
      const sentForProject = projectId;
      const baseRevision = serverRevisionRef.current;
      if (baseRevision === null) {
        setSaveFailed(true);
        setSaveError('Не удалось определить сохранённую версию проекта.');
        return null;
      }
      savingDocumentRef.current = nextDocument;
      setSavingDocument(nextDocument);
      try {
        const response = await api.saveDraft<SchematicDocument, SolveResult>(
          sentForProject,
          nextDocument,
          baseRevision,
        );
        // The editor moved to another project while this was in flight. The
        // response describes the previous one and says nothing about what is on
        // screen now.
        if (projectIdRef.current !== sentForProject) return null;
        if (!response.ok) {
          if (response.error.code === 'project_revision_conflict') {
            const latest = await api.openProject<SchematicDocument, SolveResult>(sentForProject);
            const baseDocument = serverDocumentRef.current;
            if (latest.ok && baseDocument && projectIdRef.current === sentForProject) {
              const remoteDocument = normalizeLoadedDocument(latest.data.draft.document);
              const sentMerge = mergeElectronicsDocuments(
                baseDocument,
                nextDocument,
                remoteDocument,
              );
              const currentDocument = documentRef.current ?? nextDocument;
              const liveMerge = sentMerge.ok
                ? mergeElectronicsDocuments(nextDocument, currentDocument, sentMerge.document)
                : sentMerge;
              if (liveMerge.ok) {
                const mergedDocument = liveMerge.document;
                serverRevisionRef.current = latest.data.draft.revision;
                serverDocumentRef.current = remoteDocument;
                savedDocumentRef.current = remoteDocument;
                setSavedDocument(remoteDocument);
                documentRef.current = mergedDocument;
                setDocumentState(mergedDocument);
                setResult(
                  electronicsDocumentsEqual(mergedDocument, remoteDocument)
                    ? latest.data.result
                    : null,
                );
                setVersions(latest.data.versions);
                saveFailedRef.current = false;
                setSaveFailed(false);
                setSaveError(null);
                initialiseHistory(mergedDocument);
                if (electronicsDocumentsEqual(mergedDocument, remoteDocument)) {
                  clearLocalProjectDraft(window.localStorage, sentForProject);
                } else {
                  writeLocalProjectDraft(window.localStorage, {
                    projectId: sentForProject,
                    moduleKey: 'electronics',
                    baseRevision: latest.data.draft.revision,
                    baseDocument: remoteDocument,
                    document: mergedDocument,
                  });
                }
                setNotice('Параллельные независимые изменения автоматически совмещены.');
                return null;
              }
            }
            saveFailedRef.current = true;
            setSaveFailed(true);
            setSaveError(
              'Один и тот же элемент схемы изменён параллельно по-разному. Локальный черновик сохранён; серверная версия не перезаписана.',
            );
            setNotice('Конфликт одного элемента сохранён без потери данных.');
            return null;
          }
          saveFailedRef.current = true;
          setSaveFailed(true);
          setSaveError(response.error.message);
          setNotice(`Ошибка сохранения: ${response.error.message}`);
          return null;
        }
        setSaveError(null);
        serverRevisionRef.current = response.data.draft.revision;
        serverDocumentRef.current = nextDocument;
        setResult(response.data.result);
        // The server now holds exactly this document, and nothing more. If the
        // user edited while the request was in flight, that edit is still unsaved
        // and both the indicator and autosave have to keep treating it as such.
        savedDocumentRef.current = nextDocument;
        setSavedDocument(nextDocument);
        if (documentRef.current === nextDocument) {
          clearLocalProjectDraft(window.localStorage, sentForProject);
        } else if (documentRef.current) {
          writeLocalProjectDraft(window.localStorage, {
            projectId: sentForProject,
            moduleKey: 'electronics',
            baseRevision: response.data.draft.revision,
            baseDocument: nextDocument,
            document: documentRef.current,
          });
        }
        if (!quiet && documentRef.current === nextDocument) setNotice('Все изменения сохранены.');
        return response.data.result;
      } finally {
        // Runs even if saveDraft throws instead of returning { ok: false }.
        // Leaving savingDocument set would pin the indicator on 'saving' and stop
        // autosave from ever firing again. Cleared only if this save is still the
        // one in flight, so a newer request is not disturbed.
        setSavingDocument((current) => {
          if (current === nextDocument) {
            savingDocumentRef.current = null;
            return null;
          }
          return current;
        });
      }
    },
    [initialiseHistory, projectId],
  );

  const persist = useCallback(
    (nextDocument: SchematicDocument, quiet = false): Promise<SolveResult | null> => {
      const queued = saveQueueRef.current.then(() => sendDraft(nextDocument, quiet));
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [sendDraft],
  );

  useEffect(() => {
    if (!document) return;
    if (!autosaveIsDue({ document, savedDocument, savingDocument, failed: saveFailed })) return;
    const timer = window.setTimeout(
      () => {
        void persist(document, true);
      },
      simulationRunning ? 700 : 1800,
    );
    return () => window.clearTimeout(timer);
  }, [document, persist, saveFailed, savedDocument, savingDocument, simulationRunning]);

  useEffect(() => {
    const flush = (): void => {
      const current = documentRef.current;
      if (current && saveStatusRef.current === 'dirty') void persist(current, true);
    };
    const onVisibility = (): void => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    globalThis.document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [persist]);

  async function saveNow(): Promise<void> {
    if (!document || busy) return;
    setBusy(true);
    await persist(document);
    setBusy(false);
  }

  async function toggleSimulation(): Promise<void> {
    if (!document || busy) return;
    if (simulationRunning) {
      setSimulationStatus('stopping');
      const nextDocument = {
        ...document,
        simulation: { ...document.simulation, running: false },
      };
      setDocument(nextDocument);
      pushHistory(nextDocument);
      setSimulationRunning(false);
      setSimulationStatus('stopped');
      setResult(null);
      setNotice(null);
      return;
    }
    setSimulationStatus('validating');
    const start = prepareLiveSimulationStart(document);
    setResult(start.result);
    setSimulationStatus('starting');
    setDocument(start.document);
    pushHistory(start.document);
    setSimulationRunning(true);
    setSimulationStatus('running');
    // Circuits starts immediately and keeps the stage quiet. Electrical
    // problems belong to the affected part, not to a global toast.
    setNotice(null);
    // Persistence validates the same document independently, but an honest
    // invalid/unsupported/nonconvergent result is diagnostic evidence, not a
    // reason to switch the visible simulation mode back off. The browser keeps
    // recalculating the fail-closed result while the learner investigates it.
    void persist(start.document, true);
  }

  function resetSimulation(): void {
    if (!document) return;
    const nextDocument = {
      ...document,
      simulation: { ...document.simulation, running: false },
    };
    setDocument(nextDocument);
    pushHistory(nextDocument);
    setSimulationRunning(false);
    setSimulationStatus('stopped');
    setResult(null);
    setNotice(null);
  }

  async function checkpoint(): Promise<void> {
    if (!document || busy) return;
    setBusy(true);
    const saved = await persist(document, true);
    const response = saved ? await api.createCheckpoint(projectId) : null;
    setBusy(false);
    if (response?.ok) {
      setVersions((current) => [response.data.version, ...current]);
      setNotice(`Создана неизменяемая версия №${response.data.version.versionNo}.`);
    } else {
      setNotice('Не удалось создать версию.');
    }
  }

  async function renameProject(): Promise<void> {
    const trimmed = projectTitle.trim();
    if (!project || !trimmed || trimmed === project.title) {
      setProjectTitle(project?.title ?? projectTitle);
      return;
    }
    const response = await api.renameProject(project.id, trimmed);
    if (response.ok) {
      setProject(response.data.project);
      setProjectTitle(response.data.project.title);
      setNotice('Название проекта изменено.');
    } else {
      setProjectTitle(project.title);
      setNotice('Не удалось изменить название проекта.');
    }
  }

  const saveCopy: Record<SaveStatus, string> = {
    saved: 'Все изменения сохранены',
    dirty: 'Сохраняем изменения…',
    saving: 'Сохранение…',
    error: 'Ошибка сохранения',
  };

  return {
    project,
    document,
    serverRevision: serverRevisionRef.current,
    setDocument,
    result,
    versions,
    status,
    saveStatus,
    saveCopy,
    saveError,
    notice,
    setNotice,
    simulationRunning,
    simulationStatus,
    busy,
    projectTitle,
    setProjectTitle,
    canUndo,
    canRedo,
    undo,
    redo,
    pushHistory,
    commitDocument,
    saveNow,
    toggleSimulation,
    resetSimulation,
    checkpoint,
    renameProject,
  };
}
