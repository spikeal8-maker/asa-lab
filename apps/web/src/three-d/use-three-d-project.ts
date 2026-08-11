import { useCallback, useEffect, useRef, useState } from 'react';
import {
  commitCommand,
  createHistory,
  createThreeDNode,
  parseThreeDDocument,
  redoHistory,
  undoHistory,
  type HistoryState,
  type PrimitiveKind,
  type ThreeDCommand,
  type ThreeDDocument,
  type ThreeDNode,
  type ThreeDTransform,
} from '@asa-lab/three-d';
import { api, type ProjectVersion } from '../api';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface ThreeDProjectController {
  readonly loading: boolean;
  readonly error: string | null;
  readonly title: string;
  readonly history: HistoryState | null;
  readonly document: ThreeDDocument | null;
  readonly selectedId: string | null;
  readonly selectedNode: ThreeDNode | null;
  readonly saveState: SaveState;
  readonly notice: string | null;
  readonly versions: readonly ProjectVersion[];
  readonly setSelectedId: (nodeId: string | null) => void;
  readonly execute: (command: ThreeDCommand) => void;
  readonly addPrimitive: (primitive: PrimitiveKind, position?: { x: number; z: number }) => void;
  readonly duplicateSelected: () => void;
  readonly removeSelected: () => void;
  readonly commitTransform: (nodeId: string, transform: ThreeDTransform) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly createCheckpoint: () => Promise<void>;
  readonly importDocument: (value: unknown) => boolean;
  readonly clearNotice: () => void;
}

let localIdSequence = 0;

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  localIdSequence += 1;
  const entropy = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${localIdSequence.toString(36)}-${entropy}`;
}

export function useThreeDProject(projectId: string): ThreeDProjectController {
  const [history, setHistory] = useState<HistoryState | null>(null);
  const historyRef = useRef<HistoryState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Новый 3D-проект');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [notice, setNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly ProjectVersion[]>([]);
  const lastSavedRef = useRef('');

  const replaceHistory = useCallback((next: HistoryState): void => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api.openProject<ThreeDDocument>(projectId).then((response) => {
      if (!active) return;
      if (!response.ok) {
        setError(response.error.message || 'Не удалось открыть 3D-проект.');
        setLoading(false);
        return;
      }
      const parsed = parseThreeDDocument(response.data.draft.document);
      if (!parsed.ok) {
        setError(parsed.message);
        setLoading(false);
        return;
      }
      const next = createHistory(parsed.value);
      historyRef.current = next;
      setHistory(next);
      setSelectedId(null);
      lastSavedRef.current = JSON.stringify(parsed.value);
      setTitle(response.data.project.title);
      setVersions(response.data.versions);
      setSaveState('saved');
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    const document = history?.present;
    if (!document || loading) return;
    const signature = JSON.stringify(document);
    if (signature === lastSavedRef.current) {
      setSaveState('saved');
      return;
    }
    setSaveState('dirty');
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void api.saveDraft<ThreeDDocument>(projectId, document).then((response) => {
        if (!response.ok) {
          setSaveState('error');
          setNotice(`Автосохранение не выполнено: ${response.error.message}`);
          return;
        }
        lastSavedRef.current = signature;
        const currentSignature = historyRef.current
          ? JSON.stringify(historyRef.current.present)
          : signature;
        setSaveState(currentSignature === signature ? 'saved' : 'dirty');
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [history?.present, loading, projectId]);

  const execute = useCallback(
    (command: ThreeDCommand): void => {
      const current = historyRef.current;
      if (!current) return;
      replaceHistory(commitCommand(current, command));
    },
    [replaceHistory],
  );

  const addPrimitive = useCallback(
    (primitive: PrimitiveKind, position?: { x: number; z: number }): void => {
      const node = createThreeDNode(primitive, makeId(primitive));
      const positioned = position
        ? {
            ...node,
            transform: {
              ...node.transform,
              position: { x: position.x, y: node.dimensions.height / 2, z: position.z },
            },
          }
        : node;
      execute({ type: 'add', node: positioned });
      setSelectedId(positioned.id);
      setNotice(`${positioned.name} добавлен на рабочую плоскость.`);
    },
    [execute],
  );

  const selectedNode = history?.present.nodes.find((node) => node.id === selectedId) ?? null;

  const duplicateSelected = useCallback((): void => {
    const current = historyRef.current?.present.nodes.find((node) => node.id === selectedId);
    if (!current) return;
    const copy: ThreeDNode = {
      ...current,
      id: makeId(current.primitive),
      name: `${current.name} — копия`,
      transform: {
        ...current.transform,
        position: {
          ...current.transform.position,
          x: current.transform.position.x + 5,
          z: current.transform.position.z + 5,
        },
      },
    };
    execute({ type: 'add', node: copy });
    setSelectedId(copy.id);
  }, [execute, selectedId]);

  const removeSelected = useCallback((): void => {
    if (!selectedId) return;
    execute({ type: 'remove', nodeIds: [selectedId] });
    setSelectedId(null);
  }, [execute, selectedId]);

  const commitTransform = useCallback(
    (nodeId: string, transform: ThreeDTransform): void =>
      execute({ type: 'replace-transform', nodeId, value: transform }),
    [execute],
  );

  const undo = useCallback((): void => {
    const current = historyRef.current;
    if (!current) return;
    const next = undoHistory(current);
    replaceHistory(next);
    if (selectedId && !next.present.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [replaceHistory, selectedId]);

  const redo = useCallback((): void => {
    const current = historyRef.current;
    if (current) replaceHistory(redoHistory(current));
  }, [replaceHistory]);

  const createCheckpoint = useCallback(async (): Promise<void> => {
    const document = historyRef.current?.present;
    if (!document) return;
    setSaveState('saving');
    const save = await api.saveDraft<ThreeDDocument>(projectId, document);
    if (!save.ok) {
      setSaveState('error');
      setNotice(`Не удалось сохранить проект: ${save.error.message}`);
      return;
    }
    lastSavedRef.current = JSON.stringify(document);
    const response = await api.createCheckpoint(projectId, 'Версия из ASA 3D');
    if (!response.ok) {
      setSaveState('error');
      setNotice(`Не удалось создать версию: ${response.error.message}`);
      return;
    }
    setVersions((current) => [response.data.version, ...current]);
    setSaveState('saved');
    setNotice(`Создана неизменяемая версия №${response.data.version.versionNo}.`);
  }, [projectId]);

  const importDocument = useCallback(
    (value: unknown): boolean => {
      const parsed = parseThreeDDocument(value);
      if (!parsed.ok) {
        setNotice(`Файл не импортирован: ${parsed.message}`);
        return false;
      }
      const current = historyRef.current;
      if (!current) return false;
      replaceHistory({
        past: [...current.past.slice(-99), current.present],
        present: parsed.value,
        future: [],
      });
      setSelectedId(null);
      setNotice(`Импортировано объектов: ${parsed.value.nodes.length}.`);
      return true;
    },
    [replaceHistory],
  );

  return {
    loading,
    error,
    title,
    history,
    document: history?.present ?? null,
    selectedId,
    selectedNode,
    saveState,
    notice,
    versions,
    setSelectedId,
    execute,
    addPrimitive,
    duplicateSelected,
    removeSelected,
    commitTransform,
    undo,
    redo,
    createCheckpoint,
    importDocument,
    clearNotice: () => setNotice(null),
  };
}
