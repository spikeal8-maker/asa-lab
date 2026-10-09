import { useCallback, useEffect, useRef, useState } from 'react';
import { useReportProjectSaveEvidence } from '../modules/project-save-evidence';
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
import type { HistoryState } from './workbench-model';
import {
  WorkbenchAutosaveScheduler,
  draftSaveStatus,
  transientSaveRetryDelay,
} from './workbench-autosave';

import {
  electronicsDocumentPayloadsEqual,
  electronicsDocumentsEqual,
  mergeElectronicsDocuments,
} from './electronics-document-merge';
import type { EditorPersistenceIssue } from '../components/editor-chrome/EditorPersistenceIndicator';
import {
  clearLocalProjectDraft,
  readLocalProjectDraft,
  writeLocalProjectDraft,
} from '../modules/project-local-draft';

export type SimulationRuntimeStatus =
  'stopped' | 'validating' | 'starting' | 'running' | 'stopping';

interface PersistenceScope {
  readonly projectId: string;
  readonly userId: string;
  readonly identityKind: 'account' | 'seat';
  active: boolean;
  detachedRequested: boolean;
  blocked: boolean;
  confirmed: { revision: number; document: SchematicDocument } | null;
}

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

export function useWorkbenchProjectState(projectId: string, userId: string, seatLearner = false) {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocumentState] = useState<SchematicDocument | null>(null);
  const [savedDocument, setSavedDocument] = useState<SchematicDocument | null>(null);
  const [savingDocument, setSavingDocument] = useState<SchematicDocument | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  // Internal save state. The header deliberately renders only a short,
  // user-facing fact and never exposes revision/CAS protocol language.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveIssue, setSaveIssue] = useState<EditorPersistenceIssue | null>(null);
  const [localDocument, setLocalDocument] = useState<SchematicDocument | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<SimulationRuntimeStatus>('stopped');
  const simulationStatusRef = useRef<SimulationRuntimeStatus>('stopped');
  simulationStatusRef.current = simulationStatus;
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
  const pendingSavesRef = useRef(0);
  const autosaveSchedulerRef = useRef<WorkbenchAutosaveScheduler<SchematicDocument> | null>(null);
  // A queued save can still be in flight when the hook is pointed at another
  // project. Its response describes the previous project and must not be
  // written into the new one's state.
  const serverRevisionRef = useRef<number | null>(null);
  const identityKind = seatLearner ? 'seat' : 'account';
  const scopeRef = useRef<PersistenceScope>({
    projectId,
    userId,
    identityKind,
    active: true,
    detachedRequested: false,
    blocked: false,
    confirmed: null,
  });
  if (
    scopeRef.current.projectId !== projectId ||
    scopeRef.current.userId !== userId ||
    scopeRef.current.identityKind !== identityKind
  ) {
    scopeRef.current.active = false;
    scopeRef.current = {
      projectId,
      userId,
      identityKind,
      active: true,
      detachedRequested: false,
      blocked: false,
      confirmed: null,
    };
    documentRef.current = null;
    savedDocumentRef.current = null;
    savingDocumentRef.current = null;
    serverDocumentRef.current = null;
    serverRevisionRef.current = null;
    saveQueueRef.current = Promise.resolve();
    pendingSavesRef.current = 0;
  }
  const scope = scopeRef.current;
  const loadedScopeRef = useRef<typeof scope | null>(null);
  const loadGenerationRef = useRef(0);
  const retryAtRef = useRef<number | null>(null);
  const failureCountRef = useRef(0);
  const saveIssueRef = useRef<EditorPersistenceIssue | null>(null);
  const inScope = useCallback(() => scope.active && scopeRef.current === scope, [scope]);
  const storeLocal = useCallback(
    (next: SchematicDocument): void => {
      if (!inScope()) return;
      const baseRevision = serverRevisionRef.current;
      const stored =
        baseRevision !== null &&
        writeLocalProjectDraft(() => window.localStorage, {
          projectId,
          userId,
          identityKind,
          moduleKey: 'electronics',
          baseRevision,
          ...(serverDocumentRef.current ? { baseDocument: serverDocumentRef.current } : {}),
          document: next,
        });
      setLocalDocument(stored ? next : null);
    },
    [inScope, projectId, userId, identityKind],
  );

  const saveStatus = draftSaveStatus({
    document,
    savedDocument,
    savingDocument,
    failed: saveFailed,
  });
  const saveFailedRef = useRef(saveFailed);
  saveFailedRef.current = saveFailed;

  // Every document write goes through here so the ref and the dirty state move
  // together: no call site can change the document and forget to mark it unsaved.
  const setDocument = useCallback(
    (next: SchematicDocument): void => {
      if (!inScope()) return;
      documentRef.current = next;
      storeLocal(next);
      // A new document does not fix a failed transport, expired session or CAS conflict.
      autosaveSchedulerRef.current?.update();
      setDocumentState(next);
    },
    [inScope, storeLocal],
  );

  const getCurrentDocument = useCallback((): SchematicDocument | null => documentRef.current, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (!inScope() || (event.key !== null && !event.key.startsWith('asa-project-local-draft:')))
        return;
      const current = documentRef.current;
      const local = readLocalProjectDraft(
        () => window.localStorage,
        projectId,
        'electronics',
        userId,
        identityKind,
      );
      try {
        setLocalDocument(
          current && local && JSON.stringify(local.document) === JSON.stringify(current)
            ? current
            : null,
        );
      } catch {
        setLocalDocument(null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [inScope, projectId, userId, identityKind]);

  const initialiseHistory = useCallback((next: SchematicDocument) => {
    historyRef.current = { entries: [cloneJson(next)], cursor: 0 };
    setHistoryTick((value) => value + 1);
  }, []);

  const load = useCallback(async () => {
    if (!inScope()) return;
    const generation = ++loadGenerationRef.current;
    saveFailedRef.current = false;
    retryAtRef.current = null;
    failureCountRef.current = 0;
    saveIssueRef.current = null;
    setLocalDocument(null);
    setBusy(false);
    setStatus('loading');
    const session = seatLearner ? await api.classroomStudentMe() : await api.me();
    if (!inScope() || generation !== loadGenerationRef.current) return;
    const identity =
      session.ok && session.data.authenticated
        ? 'student' in session.data
          ? session.data.student.seatId
          : session.data.user.id
        : null;
    if (identity !== userId) {
      loadedScopeRef.current = scope;
      setStatus('error');
      return;
    }
    const response = await api.openProject<SchematicDocument, SolveResult>(projectId);
    if (!inScope() || generation !== loadGenerationRef.current) return;
    if (!response.ok) {
      loadedScopeRef.current = scope;
      setStatus('error');
      return;
    }
    setProject(response.data.project);
    setProjectTitle(response.data.project.title);
    const serverDocument = normalizeLoadedDocument(response.data.draft.document);
    const migrated = !electronicsDocumentPayloadsEqual(
      serverDocument,
      response.data.draft.document,
    );
    const local = readLocalProjectDraft(
      () => window.localStorage,
      projectId,
      'electronics',
      userId,
      identityKind,
    );
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
    scope.confirmed = { revision: response.data.draft.revision, document: serverDocument };
    if (restored && local && local.baseRevision !== response.data.draft.revision) {
      const merged = localBaseDocument
        ? mergeElectronicsDocuments(localBaseDocument, nextDocument, serverDocument)
        : null;
      if (merged?.ok) {
        nextDocument = merged.document;
        mergedLocalDraft = true;
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
    loadedScopeRef.current = scope;
    if (restored || migrated) storeLocal(nextDocument);
    setSaveFailed(false);
    setSaveError(null);
    setSaveIssue(null);
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
    if (knownSavedDocument === nextDocument) {
      clearLocalProjectDraft(() => window.localStorage, projectId, userId, identityKind);
      setLocalDocument(null);
    }
    if (revisionConflict) {
      scope.blocked = true;
      setSaveFailed(true);
      saveFailedRef.current = true;
      saveIssueRef.current = 'conflict';
      setSaveError('Не удалось сохранить последние изменения на сервере.');
      setSaveIssue('conflict');
      setNotice(null);
    } else if (mergedLocalDraft) {
      setNotice('Независимые изменения схемы автоматически совмещены.');
    } else if (restored) {
      setNotice('Восстановлены несохранённые изменения из этого браузера.');
    }
    setStatus('ready');
  }, [initialiseHistory, projectId, userId, identityKind, seatLearner, inScope, scope, storeLocal]);

  useEffect(() => {
    scope.active = true;
    void load();
  }, [load, scope]);

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
          !inScope() ||
          !response.ok ||
          response.data.draft.revision <= (serverRevisionRef.current ?? -1) ||
          documentRef.current !== savedDocumentRef.current
        ) {
          return;
        }
        const remoteDocument = normalizeLoadedDocument(response.data.draft.document);
        serverRevisionRef.current = response.data.draft.revision;
        serverDocumentRef.current = remoteDocument;
        scope.confirmed = { revision: response.data.draft.revision, document: remoteDocument };
        documentRef.current = remoteDocument;
        savedDocumentRef.current = remoteDocument;
        setProject(response.data.project);
        setProjectTitle(response.data.project.title);
        setDocumentState(remoteDocument);
        setSavedDocument(remoteDocument);
        setResult(response.data.result);
        setVersions(response.data.versions);
        clearLocalProjectDraft(() => window.localStorage, projectId, userId, identityKind);
        setLocalDocument(null);
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
  }, [
    initialiseHistory,
    projectId,
    userId,
    identityKind,
    inScope,
    scope,
    simulationRunning,
    status,
  ]);

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

  const failSave = useCallback(
    (issue: EditorPersistenceIssue, transient: boolean): void => {
      scope.blocked = !transient;
      if (!inScope()) return;
      if (documentRef.current) storeLocal(documentRef.current);
      saveFailedRef.current = true;
      saveIssueRef.current = issue;
      retryAtRef.current = transient
        ? Date.now() + transientSaveRetryDelay(++failureCountRef.current)
        : null;
      setSaveFailed(true);
      setSaveError('Не удалось сохранить последние изменения на сервере.');
      setSaveIssue(issue);
      setNotice(null);
      autosaveSchedulerRef.current?.update();
    },
    [inScope, scope, storeLocal],
  );

  const sendDraft = useCallback(
    async (
      nextDocument: SchematicDocument,
      quiet: boolean,
      unloading = false,
      detached = false,
    ): Promise<SolveResult | null> => {
      const sentForProject = projectId;
      const canSend = () => inScope() || (detached && scopeRef.current === scope);
      if (!canSend()) return null;
      // Genuine unmount uses only its own confirmed revision and captured document.
      const baseRevision = detached
        ? (scope.confirmed?.revision ?? null)
        : serverRevisionRef.current;
      if (baseRevision === null) {
        failSave('server', false);
        return null;
      }
      if (inScope()) {
        savingDocumentRef.current = nextDocument;
        setSavingDocument(nextDocument);
      }
      try {
        // Server-issued session identity, not an assumed cookie after another tab logs in.
        // Keepalive is best effort; it must not bypass the same identity check.
        {
          const session = seatLearner ? await api.classroomStudentMe() : await api.me();
          if (!canSend()) return null;
          if (!session.ok) {
            failSave(
              session.status === 401 || session.status === 403 ? 'auth' : 'offline',
              session.status === 0 || session.status === 408 || session.status >= 500,
            );
            return null;
          }
          const identity = session.data.authenticated
            ? 'student' in session.data
              ? session.data.student.seatId
              : session.data.user.id
            : null;
          if (identity !== userId) {
            failSave('auth', false);
            return null;
          }
        }
        if (!canSend()) return null;
        const response = unloading
          ? await api.saveDraft<SchematicDocument, SolveResult>(
              sentForProject,
              nextDocument,
              baseRevision,
              { unloading: true },
            )
          : await api.saveDraft<SchematicDocument, SolveResult>(
              sentForProject,
              nextDocument,
              baseRevision,
            );
        // The editor moved to another project while this was in flight. The
        // response describes the previous one and says nothing about what is on
        // screen now.
        if (response.ok) {
          scope.confirmed = { revision: response.data.draft.revision, document: nextDocument };
          scope.blocked = false;
        } else {
          scope.blocked = !(
            response.status === 0 ||
            response.status === 408 ||
            response.status >= 500
          );
        }
        if (!inScope()) return null;
        if (!response.ok) {
          if (response.error.code === 'project_revision_conflict') {
            const latest = await api.openProject<SchematicDocument, SolveResult>(sentForProject);
            const baseDocument = serverDocumentRef.current;
            if (latest.ok && baseDocument && inScope()) {
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
                scope.confirmed = {
                  revision: latest.data.draft.revision,
                  document: remoteDocument,
                };
                scope.blocked = false;
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
                saveIssueRef.current = null;
                retryAtRef.current = null;
                failureCountRef.current = 0;
                setSaveFailed(false);
                setSaveError(null);
                setSaveIssue(null);
                initialiseHistory(mergedDocument);
                if (electronicsDocumentsEqual(mergedDocument, remoteDocument)) {
                  clearLocalProjectDraft(
                    () => window.localStorage,
                    sentForProject,
                    userId,
                    identityKind,
                  );
                  setLocalDocument(null);
                } else {
                  storeLocal(mergedDocument);
                }
                setNotice('Параллельные независимые изменения автоматически совмещены.');
                return null;
              }
            }
            failSave('conflict', false);
            return null;
          }
          failSave(
            response.status === 0
              ? 'offline'
              : response.status === 401 || response.status === 403
                ? 'auth'
                : 'server',
            response.status === 0 || response.status === 408 || response.status >= 500,
          );
          reportClientDiagnostic('autosave_failed', 'electronics');
          setNotice(null);
          return null;
        }
        saveFailedRef.current = false;
        saveIssueRef.current = null;
        retryAtRef.current = null;
        failureCountRef.current = 0;
        setSaveFailed(false);
        setSaveError(null);
        setSaveIssue(null);
        serverRevisionRef.current = response.data.draft.revision;
        serverDocumentRef.current = nextDocument;
        setResult(response.data.result);
        // The server now holds exactly this document, and nothing more. If the
        // user edited while the request was in flight, that edit is still unsaved
        // and both the indicator and autosave have to keep treating it as such.
        savedDocumentRef.current = nextDocument;
        setSavedDocument(nextDocument);
        if (documentRef.current === nextDocument) {
          clearLocalProjectDraft(() => window.localStorage, sentForProject, userId, identityKind);
          setLocalDocument(null);
        } else if (documentRef.current) {
          storeLocal(documentRef.current);
        }
        if (!quiet && documentRef.current === nextDocument) setNotice('Все изменения сохранены.');
        return response.data.result;
      } catch {
        reportClientDiagnostic('autosave_failed', 'electronics');
        failSave('offline', true);
        return null;
      } finally {
        // Runs even if saveDraft throws instead of returning { ok: false }.
        // Leaving savingDocument set would pin the indicator on 'saving' and stop
        // autosave from ever firing again. Cleared only if this save is still the
        // one in flight, so a newer request is not disturbed.
        if (inScope() && savingDocumentRef.current === nextDocument) {
          savingDocumentRef.current = null;
          setSavingDocument(null);
          autosaveSchedulerRef.current?.update();
        }
      }
    },
    [
      initialiseHistory,
      projectId,
      userId,
      identityKind,
      seatLearner,
      inScope,
      failSave,
      storeLocal,
      scope,
    ],
  );

  const persist = useCallback(
    (
      nextDocument: SchematicDocument,
      quiet = false,
      unloading = false,
      detached = false,
    ): Promise<SolveResult | null> => {
      autosaveSchedulerRef.current?.markSaveRequested(nextDocument);
      const send = (): Promise<SolveResult | null> => {
        if (detached) {
          if (
            scopeRef.current !== scope ||
            scope.blocked ||
            scope.confirmed?.document === nextDocument
          )
            return Promise.resolve(null);
          return sendDraft(nextDocument, quiet, unloading, true);
        }
        if (!inScope()) return Promise.resolve(null);
        // A preceding 409 may have replaced the live document with a merge.
        // Sending this older snapshot with the newly loaded revision would erase
        // the remote edit. The same check also drops superseded queued edits.
        if (documentRef.current !== nextDocument) return Promise.resolve(null);
        // Paired visibilitychange/pagehide events can queue the same safety
        // write before savingDocumentRef moves. A failed or completed first
        // request must not cause another automatic write of that snapshot.
        if (
          quiet &&
          (savedDocumentRef.current === nextDocument ||
            (saveFailedRef.current &&
              (retryAtRef.current === null || Date.now() < retryAtRef.current)))
        ) {
          return Promise.resolve(null);
        }
        return sendDraft(nextDocument, quiet, unloading);
      };
      // Start identity verification during the safety event. After a real browser
      // shutdown either that check or the keepalive PUT may not finish; per-edit
      // confirmed local storage is the recovery path, never a server-save claim.
      const idle = pendingSavesRef.current === 0;
      pendingSavesRef.current += 1;
      const queued = unloading && idle ? send() : saveQueueRef.current.then(send);
      saveQueueRef.current = queued.then(
        () => {
          if (inScope()) pendingSavesRef.current -= 1;
        },
        () => {
          if (inScope()) pendingSavesRef.current -= 1;
        },
      );
      return queued;
    },
    [sendDraft, inScope, scope],
  );

  useEffect(() => {
    if (status !== 'ready') return;
    const scheduler = new WorkbenchAutosaveScheduler<SchematicDocument>(
      () => ({
        document: documentRef.current,
        savedDocument: savedDocumentRef.current,
        savingDocument: savingDocumentRef.current,
        failed: saveFailedRef.current,
        retryAt: retryAtRef.current,
        paused: simulationStatusRef.current === 'starting',
      }),
      (current) => void persist(current, true),
    );
    autosaveSchedulerRef.current = scheduler;
    scheduler.update();
    return () => {
      scheduler.dispose();
      if (autosaveSchedulerRef.current === scheduler) autosaveSchedulerRef.current = null;
    };
  }, [persist, status]);

  useEffect(() => {
    autosaveSchedulerRef.current?.update();
  }, [document, savedDocument, savingDocument, saveFailed, simulationStatus]);

  useEffect(() => {
    const flush = (detached = false): void => {
      // A project switch must not send the new project's document through the
      // old route's save closure during effect cleanup.
      if (!inScope()) return;
      if (simulationStatusRef.current === 'starting') return;
      const current = documentRef.current;
      // Read the refs here: pagehide can follow an edit before React commits a
      // new render, so the previous render's indicator may still say "saved".
      if (
        !saveFailedRef.current &&
        current &&
        current !== savedDocumentRef.current &&
        (detached || current !== savingDocumentRef.current)
      ) {
        if (detached && scope.detachedRequested) return;
        if (detached) scope.detachedRequested = true;
        void persist(current, true, true, detached);
      }
    };
    const onVisibility = (): void => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    globalThis.document.addEventListener('visibilitychange', onVisibility);
    const onPageHide = (): void => flush();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      // SPA navigation does not fire pagehide. Leaving the editor still gets
      // the same immediate safety write while the browser remains alive.
      flush(true);
      scope.active = false;
      globalThis.document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [persist, inScope, scope]);

  const confirmSimulationStarted = useCallback((): void => {
    setSimulationStatus((current) => (current === 'starting' ? 'running' : current));
  }, []);

  async function saveNow(): Promise<void> {
    const current = documentRef.current;
    if (!current || busy) return;
    setBusy(true);
    await persist(current);
    if (inScope()) setBusy(false);
  }

  const saveBeforeLeave = async (): Promise<void> => {
    const current = documentRef.current;
    if (!current || !inScope() || simulationStatusRef.current === 'starting') return;
    if (current !== savedDocumentRef.current && !saveFailedRef.current)
      await persist(current, true, true);
  };

  async function toggleSimulation(): Promise<void> {
    if (!document || busy) return;
    if (simulationRunning) {
      setSimulationStatus('stopping');
      setSimulationRunning(false);
      setSimulationStatus('stopped');
      setResult(null);
      setNotice(null);
      return;
    }
    simulationStatusRef.current = 'starting';
    setSimulationStatus('starting');
    setResult(null);
    setSimulationRunning(true);
    // Circuits starts immediately and keeps the stage quiet. Electrical
    // problems belong to the affected part, not to a global toast.
    setNotice(null);
    // Starting a simulation is runtime activity, not a project edit. The same
    // pure solver runs locally, but no draft revision, undo entry or autosave is
    // created merely because the learner pressed Start.
  }

  function resetSimulation(): void {
    if (!document) return;
    setSimulationRunning(false);
    setSimulationStatus('stopped');
    setResult(null);
    setNotice(null);
  }

  async function checkpoint(): Promise<void> {
    if (!document || busy || !inScope()) return;
    setBusy(true);
    const saved = await persist(document, true);
    if (!inScope()) return;
    const response = saved ? await api.createCheckpoint(projectId) : null;
    if (!inScope()) return;
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

  useReportProjectSaveEvidence(
    serverRevisionRef.current,
    saveStatus === 'saved' && status === 'ready',
  );
  return {
    project,
    document: loadedScopeRef.current === scope ? document : null,
    serverRevision: serverRevisionRef.current,
    setDocument,
    getCurrentDocument,
    result,
    versions,
    status: loadedScopeRef.current === scope ? status : 'loading',
    saveStatus,
    saveError,
    saveIssue,
    localCopySaved:
      document !== null && localDocument === document && loadedScopeRef.current === scope,
    exportEmergencyCopy: () => {
      const current = getCurrentDocument();
      if (!current || !inScope()) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }),
      );
      const link = globalThis.document.createElement('a');
      link.href = url;
      link.download = 'asa-electronics-emergency.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    notice,
    setNotice,
    simulationRunning,
    simulationStatus,
    confirmSimulationStarted,
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
    saveBeforeLeave,
    toggleSimulation,
    resetSimulation,
    checkpoint,
    renameProject,
  };
}
import { reportClientDiagnostic } from '../client-diagnostics';
