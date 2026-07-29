import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type Project,
  type ProjectVersion,
  type SchematicDocument,
  type SolveResult,
} from '../api';
import { cloneJson } from './workbench-geometry';
import { migrateElectronicsGeometry } from './workbench-migration';
import type { HistoryState, SaveStatus } from './workbench-model';

export function useWorkbenchProjectState(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocumentState] = useState<SchematicDocument | null>(null);
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
  const editGenerationRef = useRef(0);
  const lifecycleEpochRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const initialiseHistory = useCallback((next: SchematicDocument) => {
    historyRef.current = { entries: [cloneJson(next)], cursor: 0 };
    setHistoryTick((value) => value + 1);
  }, []);

  useEffect(() => {
    const epoch = lifecycleEpochRef.current + 1;
    lifecycleEpochRef.current = epoch;
    let cancelled = false;

    async function load(): Promise<void> {
      setStatus('loading');
      setSimulationRunning(false);
      const response = await api.openProject(projectId);
      if (cancelled || epoch !== lifecycleEpochRef.current) return;
      if (!response.ok) {
        setStatus('error');
        return;
      }
      const geometry = migrateElectronicsGeometry(response.data.draft.document);
      editGenerationRef.current = geometry.migrated ? 1 : 0;
      setProject(response.data.project);
      setProjectTitle(response.data.project.title);
      setDocumentState(geometry.document);
      setResult(response.data.result);
      setVersions(response.data.versions);
      initialiseHistory(geometry.document);
      setSaveStatus(geometry.migrated ? 'dirty' : 'saved');
      if (geometry.migrated) {
        setNotice(
          `Схема переведена на физическую сетку 2,54 мм: ${geometry.migratedComponents} компонентов. ` +
            'Топология, IDs и неизменяемые версии сохранены.',
        );
      }
      setStatus('ready');
    }

    void load();
    return () => {
      cancelled = true;
      lifecycleEpochRef.current += 1;
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [initialiseHistory, projectId]);

  const pushHistory = useCallback((next: SchematicDocument): void => {
    const state = historyRef.current;
    const current = state.entries[state.cursor];
    if (current && JSON.stringify(current) === JSON.stringify(next)) return;
    const entries = [...state.entries.slice(0, state.cursor + 1), cloneJson(next)].slice(-80);
    historyRef.current = { entries, cursor: entries.length - 1 };
    setHistoryTick((value) => value + 1);
  }, []);

  /** Used by pointer movement; each local generation invalidates older saves. */
  const setDocument = useCallback((next: SchematicDocument): void => {
    editGenerationRef.current += 1;
    setDocumentState(next);
    setSaveStatus('dirty');
  }, []);

  const commitDocument = useCallback(
    (next: SchematicDocument, message?: string): void => {
      editGenerationRef.current += 1;
      setDocumentState(next);
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
    editGenerationRef.current += 1;
    setDocumentState(cloneJson(history.entries[history.cursor] as SchematicDocument));
    setSaveStatus('dirty');
    setHistoryTick((value) => value + 1);
    setNotice('Последнее изменение отменено.');
  }

  function redo(): void {
    const history = historyRef.current;
    if (history.cursor >= history.entries.length - 1) return;
    history.cursor += 1;
    editGenerationRef.current += 1;
    setDocumentState(cloneJson(history.entries[history.cursor] as SchematicDocument));
    setSaveStatus('dirty');
    setHistoryTick((value) => value + 1);
    setNotice('Изменение повторено.');
  }

  const persist = useCallback(
    (
      nextDocument: SchematicDocument,
      quiet = false,
    ): Promise<SolveResult | null> => {
      const snapshot = cloneJson(nextDocument);
      const generation = editGenerationRef.current;
      const epoch = lifecycleEpochRef.current;

      const operation = saveQueueRef.current.then(async (): Promise<SolveResult | null> => {
        if (epoch !== lifecycleEpochRef.current) return null;
        setSaveStatus('saving');
        const response = await api.saveDraft(projectId, snapshot);
        if (epoch !== lifecycleEpochRef.current) return null;

        if (!response.ok) {
          if (generation !== editGenerationRef.current) {
            setSaveStatus('dirty');
          } else {
            setSaveStatus('error');
            if (!quiet) setNotice(`Не удалось сохранить: ${response.error.message}`);
          }
          return null;
        }

        if (generation !== editGenerationRef.current) {
          setSaveStatus('dirty');
          if (!quiet) {
            setNotice('Во время сохранения появились новые изменения. Они сохранены следующей операцией.');
          }
          return null;
        }

        setResult(response.data.result);
        setSaveStatus('saved');
        if (!quiet) setNotice('Все изменения сохранены.');
        return response.data.result;
      });

      saveQueueRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    [projectId],
  );

  useEffect(() => {
    if (!document || saveStatus !== 'dirty') return;
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void persist(document, true);
    }, 1800);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [document, persist, saveStatus]);

  async function saveNow(): Promise<void> {
    if (!document || busy) return;
    setBusy(true);
    try {
      await persist(document);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSimulation(): Promise<void> {
    if (!document || busy) return;
    if (simulationRunning) {
      setSimulationRunning(false);
      setNotice('Моделирование остановлено. Редактирование схемы снова доступно.');
      return;
    }
    setBusy(true);
    try {
      const nextResult = await persist(document, true);
      if (nextResult) {
        setSimulationRunning(true);
        setNotice(
          'Моделирование запущено. Структура схемы заблокирована; просмотр, диагностика и измерения доступны.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function checkpoint(): Promise<void> {
    if (!document || busy) return;
    setBusy(true);
    try {
      const saved = await persist(document, true);
      const response = saved ? await api.createCheckpoint(projectId) : null;
      if (response?.ok) {
        setVersions((current) => [response.data.version, ...current]);
        setNotice(`Создана неизменяемая версия №${response.data.version.versionNo}.`);
      } else {
        setNotice('Не удалось создать версию: сначала должна сохраниться текущая схема.');
      }
    } finally {
      setBusy(false);
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
    dirty: 'Есть несохранённые изменения',
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
    checkpoint,
    renameProject,
  };
}
