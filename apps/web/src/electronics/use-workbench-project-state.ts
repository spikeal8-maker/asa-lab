import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type Project,
  type ProjectVersion,
  type SchematicDocument,
  type SolveResult,
} from '../api';
import { cloneJson } from './workbench-geometry';
import type { HistoryState, SaveStatus } from './workbench-model';

function normalizeLoadedDocument(document: SchematicDocument): SchematicDocument {
  const legacy = document as SchematicDocument & {
    schemaVersion?: number;
    viewport?: SchematicDocument['viewport'];
    simulation?: SchematicDocument['simulation'];
  };
  return {
    ...document,
    schemaVersion: 2,
    viewport: legacy.viewport ?? { x: 0, y: 0, zoom: 1 },
    simulation: legacy.simulation ?? { running: false, maxIterations: 24 },
  };
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
    setDocument(nextDocument);
    setResult(response.data.result);
    setVersions(response.data.versions);
    setSaveStatus('saved');
    setSimulationRunning(nextDocument.simulation.running);
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
        if (!quiet) setNotice(`Не удалось сохранить: ${response.error.message}`);
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
      const nextDocument = {
        ...document,
        simulation: { ...document.simulation, running: false },
      };
      setDocument(nextDocument);
      pushHistory(nextDocument);
      setSaveStatus('dirty');
      setSimulationRunning(false);
      setNotice('Моделирование остановлено.');
      return;
    }
    setBusy(true);
    const nextDocument = {
      ...document,
      simulation: { ...document.simulation, running: true },
    };
    setDocument(nextDocument);
    pushHistory(nextDocument);
    const nextResult = await persist(nextDocument, true);
    setBusy(false);
    if (nextResult) {
      setSimulationRunning(true);
      setNotice('Моделирование запущено. Изменения схемы пересчитываются автоматически.');
    }
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
