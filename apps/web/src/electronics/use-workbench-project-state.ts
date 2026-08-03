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
import { calculateSimulationPreflight, canStartSimulation } from './live-simulation';

export type SimulationRuntimeStatus =
  | 'stopped'
  | 'validating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'validation_failed'
  | 'runtime_failed';

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
    schemaVersion: 3,
    components,
    connections,
    viewport: legacy.viewport ?? { x: 0, y: 0, zoom: 1 },
    simulation: legacy.simulation ?? { running: false, maxIterations: 24 },
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
  const [document, setDocument] = useState<SchematicDocument | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [notice, setNotice] = useState<string | null>(null);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<SimulationRuntimeStatus>('stopped');
  const [busy, setBusy] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [historyTick, setHistoryTick] = useState(0);

  const historyRef = useRef<HistoryState>({ entries: [], cursor: -1 });
  const autosaveTimerRef = useRef<number | null>(null);

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
    const nextDocument = normalizeLoadedDocument(response.data.draft.document);
    const migrated = JSON.stringify(nextDocument) !== JSON.stringify(response.data.draft.document);
    setDocument(nextDocument);
    setResult(response.data.result);
    setVersions(response.data.versions);
    setSaveStatus(migrated ? 'dirty' : 'saved');
    setSimulationRunning(nextDocument.simulation.running);
    setSimulationStatus(nextDocument.simulation.running ? 'running' : 'stopped');
    initialiseHistory(nextDocument);
    setStatus('ready');
  }, [initialiseHistory, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      setSaveStatus('dirty');
      if (message) setNotice(message);
    },
    [pushHistory],
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
    setSaveStatus('dirty');
    setHistoryTick((value) => value + 1);
    setNotice('Последнее изменение отменено.');
  }

  function redo(): void {
    const history = historyRef.current;
    if (history.cursor >= history.entries.length - 1) return;
    history.cursor += 1;
    setDocument(cloneJson(history.entries[history.cursor] as SchematicDocument));
    setSaveStatus('dirty');
    setHistoryTick((value) => value + 1);
    setNotice('Изменение повторено.');
  }

  const persist = useCallback(
    async (nextDocument: SchematicDocument, quiet = false): Promise<SolveResult | null> => {
      setSaveStatus('saving');
      const response = await api.saveDraft<SchematicDocument, SolveResult>(projectId, nextDocument);
      if (!response.ok) {
        setSaveStatus('error');
        setNotice(`Ошибка сохранения: ${response.error.message}`);
        return null;
      }
      setResult(response.data.result);
      setSaveStatus('saved');
      if (!quiet) setNotice('Все изменения сохранены.');
      return response.data.result;
    },
    [projectId],
  );

  useEffect(() => {
    if (!document || saveStatus !== 'dirty') return;
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(
      () => {
        void persist(document, true);
      },
      simulationRunning ? 700 : 1800,
    );
    return () => {
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [document, persist, saveStatus, simulationRunning]);

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
      setSaveStatus('dirty');
      setSimulationRunning(false);
      setSimulationStatus('stopped');
      setResult(null);
      setNotice('Моделирование остановлено.');
      return;
    }
    setSimulationStatus('validating');
    const nextDocument = {
      ...document,
      simulation: { ...document.simulation, running: true },
    };
    const preflight = calculateSimulationPreflight(nextDocument);
    setResult(preflight);
    if (!canStartSimulation(preflight)) {
      setSimulationRunning(false);
      setSimulationStatus('validation_failed');
      const diagnostic = preflight.diagnostics.find((item) => item.severity === 'error');
      setNotice(
        diagnostic
          ? `Моделирование не запущено: ${diagnostic.message}`
          : 'Моделирование не запущено: схема не прошла проверку.',
      );
      return;
    }
    setSimulationStatus('starting');
    setDocument(nextDocument);
    pushHistory(nextDocument);
    setSaveStatus('dirty');
    setSimulationRunning(true);
    setSimulationStatus('running');
    setNotice(
      'Моделирование запущено. Изменения пересчитываются сразу, сохранение выполняется отдельно.',
    );
    void persist(nextDocument, true).then((serverResult) => {
      if (serverResult && !canStartSimulation(serverResult)) {
        setSimulationStatus('runtime_failed');
        setNotice('Серверная проверка схемы не совпала с локальной. Моделирование остановлено.');
        setSimulationRunning(false);
        setDocument({
          ...nextDocument,
          simulation: { ...nextDocument.simulation, running: false },
        });
      }
    });
  }

  function resetSimulation(): void {
    if (!document) return;
    const nextDocument = {
      ...document,
      simulation: { ...document.simulation, running: false },
    };
    setDocument(nextDocument);
    pushHistory(nextDocument);
    setSaveStatus('dirty');
    setSimulationRunning(false);
    setSimulationStatus('stopped');
    setResult(null);
    setNotice('Моделирование сброшено. Схема и соединения сохранены.');
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
    setDocument,
    result,
    versions,
    status,
    saveStatus,
    setSaveStatus,
    saveCopy,
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
