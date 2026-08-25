import { useCallback, useEffect, useRef, useState } from 'react';
import {
  alignDocumentNodes,
  bundleDocumentNodes,
  commitCommand,
  cruiseDocumentNodesToTarget,
  createHistory,
  createThreeDNode,
  dropDocumentNodesToWorkplane,
  groupDocumentNodes,
  mirrorDocumentNodes,
  parseThreeDDocument,
  redoHistory,
  replaceHistoryPresent,
  selectionBounds,
  setDocumentNodeOperation,
  unbundleDocumentNodes,
  ungroupDocumentNodes,
  undoHistory,
  type AlignmentAxis,
  type AlignmentMode,
  type BooleanOperation,
  type HistoryState,
  type PrimitiveKind,
  type ShapeOperation,
  type ThreeDCommand,
  type ThreeDDimensions,
  type ThreeDDocument,
  type ThreeDNode,
  type ThreeDTransform,
} from '@asa-lab/three-d';
import { api, type ProjectVersion } from '../api';
import { clearLocalThreeDDraft, readLocalThreeDDraft, writeLocalThreeDDraft } from './local-draft';
import type { DirectManipulationCommit } from './viewport/DirectManipulator';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface ThreeDProjectController {
  readonly loading: boolean;
  readonly error: string | null;
  readonly title: string;
  readonly history: HistoryState | null;
  readonly document: ThreeDDocument | null;
  readonly serverRevision: number | null;
  readonly selectedId: string | null;
  readonly selectedIds: readonly string[];
  readonly selectedNode: ThreeDNode | null;
  readonly selectedNodes: readonly ThreeDNode[];
  readonly selectedGroupId: string | null;
  readonly selectedBundleId: string | null;
  readonly saveState: SaveState;
  readonly saveError: string | null;
  readonly requiresSignIn: boolean;
  readonly notice: string | null;
  readonly versions: readonly ProjectVersion[];
  readonly hasClipboard: boolean;
  readonly hasHiddenNodes: boolean;
  readonly setTitle: (title: string) => void;
  readonly renameProject: () => Promise<void>;
  readonly setSelectedId: (nodeId: string | null, additive?: boolean) => void;
  readonly selectAll: () => void;
  readonly execute: (command: ThreeDCommand) => void;
  readonly addPrimitive: (
    primitive: PrimitiveKind,
    position?: { x: number; y?: number; z: number },
    additive?: boolean,
    operation?: ShapeOperation,
  ) => void;
  readonly copySelected: () => void;
  readonly cutSelected: () => void;
  readonly pasteCopied: () => void;
  readonly duplicateSelected: () => void;
  readonly removeSelected: () => void;
  readonly setSelectionOperation: (operation: 'solid' | 'hole') => void;
  readonly hideSelected: () => void;
  readonly showAll: () => void;
  readonly toggleSelectionLock: () => void;
  readonly bundleSelected: () => void;
  readonly unbundleSelected: () => void;
  readonly groupSelected: (operation?: BooleanOperation) => void;
  readonly ungroupSelected: () => void;
  readonly setSelectedGroupOperation: (operation: BooleanOperation) => void;
  readonly alignSelected: (axis: AlignmentAxis, mode: AlignmentMode) => void;
  readonly mirrorSelected: (axis: AlignmentAxis) => void;
  readonly dropSelectedToWorkplane: (workplaneY: number) => void;
  readonly cruiseSelectedTo: (targetId: string) => boolean;
  readonly toggleRuler: (workplaneY?: number) => void;
  readonly setRulerOriginFromSelection: () => void;
  readonly commitTransform: (
    nodeId: string,
    transform: ThreeDTransform,
    dimensions?: ThreeDDimensions,
  ) => void;
  readonly commitTransforms: (commits: readonly DirectManipulationCommit[]) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly createCheckpoint: () => Promise<void>;
  readonly retrySave: () => void;
  readonly signInAgain: () => void;
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

function friendlySaveFailure(status: number): {
  readonly message: string;
  readonly signIn: boolean;
} {
  if (status === 401) {
    return {
      message: 'Сессия завершена. Изменения сохранены в этом браузере.',
      signIn: true,
    };
  }
  if (status === 0) {
    return {
      message: 'Нет соединения с сервером. Изменения сохранены в этом браузере.',
      signIn: false,
    };
  }
  return {
    message: 'Сервер пока не принял изменения. Они сохранены в этом браузере.',
    signIn: false,
  };
}

function rotateVector(
  vector: { readonly x: number; readonly y: number; readonly z: number },
  rotation: { readonly x: number; readonly y: number; readonly z: number },
): { readonly x: number; readonly y: number; readonly z: number } {
  const xAngle = (rotation.x * Math.PI) / 180;
  const yAngle = (rotation.y * Math.PI) / 180;
  const zAngle = (rotation.z * Math.PI) / 180;
  const afterX = {
    x: vector.x,
    y: vector.y * Math.cos(xAngle) - vector.z * Math.sin(xAngle),
    z: vector.y * Math.sin(xAngle) + vector.z * Math.cos(xAngle),
  };
  const afterY = {
    x: afterX.x * Math.cos(yAngle) + afterX.z * Math.sin(yAngle),
    y: afterX.y,
    z: -afterX.x * Math.sin(yAngle) + afterX.z * Math.cos(yAngle),
  };
  return {
    x: afterY.x * Math.cos(zAngle) - afterY.y * Math.sin(zAngle),
    y: afterY.x * Math.sin(zAngle) + afterY.y * Math.cos(zAngle),
    z: afterY.z,
  };
}

export function useThreeDProject(projectId: string): ThreeDProjectController {
  const [history, setHistory] = useState<HistoryState | null>(null);
  const historyRef = useRef<HistoryState | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Новый 3D-проект');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const saveStateRef = useRef<SaveState>('saved');
  saveStateRef.current = saveState;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly ProjectVersion[]>([]);
  const [clipboard, setClipboard] = useState<readonly ThreeDNode[]>([]);
  const lastSavedRef = useRef('');
  const serverRevisionRef = useRef<number | null>(null);
  const savedTitleRef = useRef('Новый 3D-проект');
  const autosaveQueueRef = useRef<Promise<void>>(Promise.resolve());

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
        setError(
          response.status === 401
            ? 'Сессия завершена. Обновите страницу и войдите снова.'
            : response.error.message || 'Не удалось открыть 3D-проект.',
        );
        setLoading(false);
        return;
      }
      const parsed = parseThreeDDocument(response.data.draft.document);
      if (!parsed.ok) {
        setError(parsed.message);
        setLoading(false);
        return;
      }
      const serverSignature = JSON.stringify(parsed.value);
      serverRevisionRef.current = response.data.draft.revision;
      const localDraft = readLocalThreeDDraft(window.localStorage, projectId);
      const localParsed =
        localDraft?.serverSignature === serverSignature
          ? parseThreeDDocument(localDraft.document)
          : null;
      const restoredDocument = localParsed?.ok ? localParsed.value : parsed.value;
      const restored = JSON.stringify(restoredDocument) !== serverSignature;
      const next = createHistory(restoredDocument);
      historyRef.current = next;
      setHistory(next);
      setSelectedIds([]);
      setClipboard([]);
      lastSavedRef.current = serverSignature;
      setTitle(response.data.project.title);
      savedTitleRef.current = response.data.project.title;
      setVersions(response.data.versions);
      setSaveState(restored ? 'dirty' : 'saved');
      setSaveError(null);
      setRequiresSignIn(false);
      if (restored) {
        setNotice('Восстановлены несохранённые изменения из этого браузера.');
      } else {
        clearLocalThreeDDraft(window.localStorage, projectId);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const enqueueAutosave = useCallback(
    (document: ThreeDDocument, signature: string): void => {
      autosaveQueueRef.current = autosaveQueueRef.current.then(async () => {
        const current = historyRef.current?.present;
        if (!current || JSON.stringify(current) !== signature) return;
        setSaveState('saving');
        const baseRevision = serverRevisionRef.current;
        if (baseRevision === null) {
          setSaveState('error');
          setSaveError('Не удалось определить сохранённую версию проекта.');
          return;
        }
        const response = await api.saveDraft<ThreeDDocument>(projectId, document, baseRevision);
        if (!response.ok) {
          const failure = friendlySaveFailure(response.status);
          setSaveState('error');
          setSaveError(failure.message);
          setRequiresSignIn(failure.signIn);
          setNotice(null);
          return;
        }
        lastSavedRef.current = signature;
        serverRevisionRef.current = response.data.draft.revision;
        setSaveError(null);
        setRequiresSignIn(false);
        const currentDocument = historyRef.current?.present;
        const currentSignature = currentDocument ? JSON.stringify(currentDocument) : signature;
        if (currentSignature === signature) {
          clearLocalThreeDDraft(window.localStorage, projectId);
        } else if (currentDocument) {
          writeLocalThreeDDraft(window.localStorage, projectId, currentDocument, signature);
          // The creator may undo back to a document that looked saved while
          // this request was in flight. The response just changed the server
          // baseline, so explicitly enqueue that current document again.
          setSaveRetry((current) => current + 1);
        }
        setSaveState(currentSignature === signature ? 'saved' : 'dirty');
      });
    },
    [projectId],
  );

  useEffect(() => {
    const document = history?.present;
    if (!document || loading) return;
    const signature = JSON.stringify(document);
    if (signature === lastSavedRef.current) {
      setSaveState('saved');
      setSaveError(null);
      setRequiresSignIn(false);
      clearLocalThreeDDraft(window.localStorage, projectId);
      return;
    }
    writeLocalThreeDDraft(window.localStorage, projectId, document, lastSavedRef.current);
    setSaveState('dirty');
    setSaveError(null);
    setRequiresSignIn(false);
    const timer = window.setTimeout(() => {
      enqueueAutosave(document, signature);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [enqueueAutosave, history?.present, loading, projectId, saveRetry]);

  useEffect(() => {
    const flush = (): void => {
      const current = historyRef.current?.present;
      if (current && saveStateRef.current === 'dirty') {
        enqueueAutosave(current, JSON.stringify(current));
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [enqueueAutosave]);

  const execute = useCallback(
    (command: ThreeDCommand): void => {
      const current = historyRef.current;
      if (!current) return;
      replaceHistory(commitCommand(current, command));
    },
    [replaceHistory],
  );

  const commitDocument = useCallback(
    (document: ThreeDDocument): void => {
      const current = historyRef.current;
      if (!current || document === current.present) return;
      replaceHistory(replaceHistoryPresent(current, document));
    },
    [replaceHistory],
  );

  const setSelectedId = useCallback((nodeId: string | null, additive = false): void => {
    if (!nodeId) {
      setSelectedIds([]);
      return;
    }
    const document = historyRef.current?.present;
    if (!document) return;
    const groupId = nodeId.startsWith('group:')
      ? nodeId.slice('group:'.length)
      : document.nodes.find((node) => node.id === nodeId)?.groupId;
    const directIncoming = groupId
      ? document.nodes.filter((node) => node.groupId === groupId).map((node) => node.id)
      : document.nodes.some((node) => node.id === nodeId)
        ? [nodeId]
        : [];
    const bundleIds = new Set(
      document.nodes
        .filter((node) => directIncoming.includes(node.id) && node.bundleId)
        .map((node) => node.bundleId as string),
    );
    const incoming =
      bundleIds.size === 1
        ? document.nodes
            .filter((node) => node.bundleId && bundleIds.has(node.bundleId))
            .map((node) => node.id)
        : directIncoming;
    if (incoming.length === 0) return;
    setSelectedIds((current) => {
      if (!additive) return incoming;
      const next = new Set(current);
      const remove = incoming.every((id) => next.has(id));
      incoming.forEach((id) => (remove ? next.delete(id) : next.add(id)));
      return [...next];
    });
  }, []);

  const selectAll = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document) return;
    setSelectedIds(document.nodes.filter((node) => node.visible).map((node) => node.id));
  }, []);

  const addPrimitive = useCallback(
    (
      primitive: PrimitiveKind,
      position?: { x: number; y?: number; z: number },
      additive = false,
      operation: ShapeOperation = 'solid',
    ): void => {
      const node = { ...createThreeDNode(primitive, makeId(primitive)), operation };
      const positioned = position
        ? {
            ...node,
            transform: {
              ...node.transform,
              position: {
                x: position.x,
                y: (position.y ?? 0) + node.dimensions.height / 2,
                z: position.z,
              },
            },
          }
        : node;
      execute({ type: 'add', node: positioned });
      setSelectedIds((current) =>
        additive ? [...new Set([...current, positioned.id])] : [positioned.id],
      );
      setNotice(
        operation === 'hole'
          ? `Отверстие «${positioned.name}» добавлено на рабочую плоскость.`
          : `Форма «${positioned.name}» добавлена на рабочую плоскость.`,
      );
    },
    [execute],
  );

  const selectedId = selectedIds.at(-1) ?? null;
  const selectedNodes =
    history?.present.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
  const selectedNode = selectedNodes.length === 1 ? (selectedNodes[0] ?? null) : null;
  const selectedGroupId =
    selectedNodes.length > 1 &&
    selectedNodes[0]?.groupId &&
    selectedNodes.every((node) => node.groupId === selectedNodes[0]?.groupId)
      ? selectedNodes[0].groupId
      : null;
  const selectedBundleId =
    selectedNodes.length > 1 &&
    selectedNodes[0]?.bundleId &&
    selectedNodes.every((node) => node.bundleId === selectedNodes[0]?.bundleId)
      ? selectedNodes[0].bundleId
      : null;

  const copySelected = useCallback((): void => {
    const current =
      historyRef.current?.present.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
    if (current.length === 0) return;
    setClipboard(structuredClone(current));
    setNotice(
      current.length === 1
        ? `Объект «${current[0]?.name}» скопирован.`
        : `Скопировано объектов: ${current.length}.`,
    );
  }, [selectedIds]);

  const cutSelected = useCallback((): void => {
    const current =
      historyRef.current?.present.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
    if (current.length === 0) return;
    setClipboard(structuredClone(current));
    execute({ type: 'remove', nodeIds: selectedIds });
    setSelectedIds([]);
    setNotice(`Вырезано объектов: ${current.length}.`);
  }, [execute, selectedIds]);

  const pasteCopied = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document || clipboard.length === 0) return;
    const groupIds = new Map<string, string>();
    const bundleIds = new Map<string, string>();
    const copies = clipboard.map((source): ThreeDNode => {
      const groupId = source.groupId ? (groupIds.get(source.groupId) ?? makeId('group')) : null;
      if (source.groupId && groupId) groupIds.set(source.groupId, groupId);
      const bundleId = source.bundleId
        ? (bundleIds.get(source.bundleId) ?? makeId('bundle'))
        : null;
      if (source.bundleId && bundleId) bundleIds.set(source.bundleId, bundleId);
      return {
        ...structuredClone(source),
        id: makeId(source.primitive),
        name: `${source.name} — копия`,
        bundleId,
        groupId,
        transform: {
          ...structuredClone(source.transform),
          position: {
            ...source.transform.position,
            x: source.transform.position.x + 5,
            z: source.transform.position.z + 5,
          },
        },
      };
    });
    commitDocument({ ...document, nodes: [...document.nodes, ...copies] });
    setSelectedIds(copies.map((node) => node.id));
    setNotice(`Вставлено объектов: ${copies.length}.`);
  }, [clipboard, commitDocument]);

  const duplicateSelected = useCallback((): void => {
    const document = historyRef.current?.present;
    const current = document?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [];
    if (!document || current.length === 0) return;
    const groupIds = new Map<string, string>();
    const bundleIds = new Map<string, string>();
    const copies = current.map((source): ThreeDNode => {
      const groupId = source.groupId ? (groupIds.get(source.groupId) ?? makeId('group')) : null;
      if (source.groupId && groupId) groupIds.set(source.groupId, groupId);
      const bundleId = source.bundleId
        ? (bundleIds.get(source.bundleId) ?? makeId('bundle'))
        : null;
      if (source.bundleId && bundleId) bundleIds.set(source.bundleId, bundleId);
      return {
        ...structuredClone(source),
        id: makeId(source.primitive),
        name: `${source.name} — копия`,
        bundleId,
        groupId,
        transform: {
          ...source.transform,
          position: {
            ...source.transform.position,
            x: source.transform.position.x + 5,
            z: source.transform.position.z + 5,
          },
        },
      };
    });
    commitDocument({ ...document, nodes: [...document.nodes, ...copies] });
    setSelectedIds(copies.map((node) => node.id));
  }, [commitDocument, selectedIds]);

  const removeSelected = useCallback((): void => {
    if (selectedIds.length === 0) return;
    execute({ type: 'remove', nodeIds: selectedIds });
    setSelectedIds([]);
  }, [execute, selectedIds]);

  const hideSelected = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    const next = {
      ...document,
      nodes: document.nodes.map((node) =>
        selected.has(node.id) && node.visible ? { ...node, visible: false } : node,
      ),
    };
    commitDocument(next);
    setSelectedIds([]);
    setNotice('Выбранные объекты скрыты. Показать их можно через меню видимости.');
  }, [commitDocument, selectedIds]);

  const showAll = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document || !document.nodes.some((node) => !node.visible)) return;
    commitDocument({
      ...document,
      nodes: document.nodes.map((node) => (node.visible ? node : { ...node, visible: true })),
    });
    setNotice('Все скрытые объекты снова показаны.');
  }, [commitDocument]);

  const toggleSelectionLock = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    const shouldLock = document.nodes.some((node) => selected.has(node.id) && !node.locked);
    commitDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        selected.has(node.id) ? { ...node, locked: shouldLock } : node,
      ),
    });
    setNotice(
      shouldLock ? 'Выбранные объекты заблокированы.' : 'Выбранные объекты разблокированы.',
    );
  }, [commitDocument, selectedIds]);

  const bundleSelected = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document) return;
    const next = bundleDocumentNodes(document, selectedIds, makeId('bundle'));
    if (next === document) return;
    commitDocument(next);
    setNotice('Объекты собраны в быструю группу без изменения геометрии и цветов.');
  }, [commitDocument, selectedIds]);

  const unbundleSelected = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document) return;
    const next = unbundleDocumentNodes(document, selectedIds);
    if (next === document) return;
    commitDocument(next);
    setNotice('Быстрая группа разобрана.');
  }, [commitDocument, selectedIds]);

  const setSelectionOperation = useCallback(
    (operation: 'solid' | 'hole'): void => {
      const document = historyRef.current?.present;
      if (!document || selectedIds.length === 0) return;
      commitDocument(setDocumentNodeOperation(document, selectedIds, operation));
      setNotice(
        operation === 'hole'
          ? 'Выбранные формы стали отверстиями.'
          : 'Выбранные формы стали телами.',
      );
    },
    [commitDocument, selectedIds],
  );

  const groupSelected = useCallback(
    (operation: BooleanOperation = 'union'): void => {
      const document = historyRef.current?.present;
      if (!document) return;
      const selected = document.nodes.filter(
        (node) => selectedIds.includes(node.id) && !node.locked,
      );
      if (selected.length < 2) return;
      const groupNodeIds = selected.map((node) => node.id);
      const effectiveOperation =
        operation === 'union' && selected.some((node) => node.operation === 'hole')
          ? 'difference'
          : operation;
      commitDocument(
        groupDocumentNodes(document, groupNodeIds, makeId('group'), effectiveOperation),
      );
      setSelectedIds(groupNodeIds);
      setNotice('Формы объединены в редактируемую булеву группу.');
    },
    [commitDocument, selectedIds],
  );

  const ungroupSelected = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document || selectedIds.length === 0) return;
    commitDocument(ungroupDocumentNodes(document, selectedIds));
    setNotice('Группа разобрана, исходные формы снова доступны отдельно.');
  }, [commitDocument, selectedIds]);

  const setSelectedGroupOperation = useCallback(
    (operation: BooleanOperation): void => {
      const document = historyRef.current?.present;
      if (!document) return;
      const groupIds = new Set(
        document.nodes
          .filter((node) => selectedIds.includes(node.id) && node.groupId)
          .map((node) => node.groupId),
      );
      if (groupIds.size !== 1) return;
      commitDocument({
        ...document,
        nodes: document.nodes.map((node) =>
          node.groupId && groupIds.has(node.groupId)
            ? {
                ...node,
                groupOperation: operation,
              }
            : node,
        ),
      });
    },
    [commitDocument, selectedIds],
  );

  const alignSelected = useCallback(
    (axis: AlignmentAxis, mode: AlignmentMode): void => {
      const document = historyRef.current?.present;
      if (!document) return;
      commitDocument(alignDocumentNodes(document, selectedIds, axis, mode));
    },
    [commitDocument, selectedIds],
  );

  const mirrorSelected = useCallback(
    (axis: AlignmentAxis): void => {
      const document = historyRef.current?.present;
      if (!document) return;
      const next = mirrorDocumentNodes(document, selectedIds, axis);
      if (next === document) return;
      commitDocument(next);
      setNotice(`Выделение отражено по оси ${axis.toUpperCase()}.`);
    },
    [commitDocument, selectedIds],
  );

  const dropSelectedToWorkplane = useCallback(
    (workplaneY: number): void => {
      const document = historyRef.current?.present;
      if (!document) return;
      const next = dropDocumentNodesToWorkplane(document, selectedIds, workplaneY);
      if (next === document) return;
      commitDocument(next);
      setNotice('Выбранные объекты опущены на активную рабочую плоскость.');
    },
    [commitDocument, selectedIds],
  );

  const cruiseSelectedTo = useCallback(
    (targetId: string): boolean => {
      const document = historyRef.current?.present;
      if (!document || selectedIds.length === 0) return false;
      const targetIds = targetId.startsWith('group:')
        ? document.nodes
            .filter((node) => node.groupId === targetId.slice('group:'.length))
            .map((node) => node.id)
        : [targetId];
      const next = cruiseDocumentNodesToTarget(document, selectedIds, targetIds);
      if (next === document) return false;
      commitDocument(next);
      setNotice('Cruise разместил выделение на верхней поверхности целевого объекта.');
      return true;
    },
    [commitDocument, selectedIds],
  );

  const toggleRuler = useCallback(
    (workplaneY = 0): void => {
      const document = historyRef.current?.present;
      if (!document) return;
      const bounds = selectionBounds(
        document.nodes.filter((node) => selectedIds.includes(node.id)),
      );
      execute({
        type: 'replace-ruler',
        value: {
          ...document.ruler,
          visible: !document.ruler.visible,
          origin: document.ruler.visible
            ? document.ruler.origin
            : (bounds?.min ?? { x: 0, y: workplaneY, z: 0 }),
        },
      });
    },
    [execute, selectedIds],
  );

  const setRulerOriginFromSelection = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document) return;
    const bounds = selectionBounds(document.nodes.filter((node) => selectedIds.includes(node.id)));
    const origin = bounds?.min ?? { x: 0, y: 0, z: 0 };
    execute({ type: 'replace-ruler', value: { ...document.ruler, visible: true, origin } });
  }, [execute, selectedIds]);

  const commitTransform = useCallback(
    (nodeId: string, transform: ThreeDTransform, dimensions?: ThreeDDimensions): void => {
      if (nodeId.startsWith('group:')) {
        const document = historyRef.current?.present;
        if (!document) return;
        const groupId = nodeId.slice('group:'.length);
        const members = document.nodes.filter((node) => node.groupId === groupId && !node.locked);
        const bounds = selectionBounds(members);
        if (!bounds) return;
        const targetDimensions = dimensions ?? {
          width: bounds.size.x,
          depth: bounds.size.z,
          height: bounds.size.y,
        };
        const scale = {
          x: targetDimensions.width / Math.max(bounds.size.x, 0.001),
          y: targetDimensions.height / Math.max(bounds.size.y, 0.001),
          z: targetDimensions.depth / Math.max(bounds.size.z, 0.001),
        };
        const updated = members.map((member): ThreeDNode => {
          const relative = {
            x: (member.transform.position.x - bounds.center.x) * scale.x,
            y: (member.transform.position.y - bounds.center.y) * scale.y,
            z: (member.transform.position.z - bounds.center.z) * scale.z,
          };
          const rotated = rotateVector(relative, transform.rotation);
          return {
            ...member,
            dimensions: {
              width: member.dimensions.width * scale.x,
              depth: member.dimensions.depth * scale.z,
              height: member.dimensions.height * scale.y,
            },
            transform: {
              ...member.transform,
              position: {
                x: transform.position.x + rotated.x,
                y: transform.position.y + rotated.y,
                z: transform.position.z + rotated.z,
              },
              rotation: {
                x: member.transform.rotation.x + transform.rotation.x,
                y: member.transform.rotation.y + transform.rotation.y,
                z: member.transform.rotation.z + transform.rotation.z,
              },
              scale: { x: 1, y: 1, z: 1 },
            },
          };
        });
        execute({ type: 'replace-nodes', nodes: updated });
        return;
      }
      if (!dimensions) {
        execute({ type: 'replace-transform', nodeId, value: transform });
        return;
      }
      const current = historyRef.current?.present.nodes.find((node) => node.id === nodeId);
      if (!current) return;
      execute({
        type: 'replace-node',
        node: {
          ...current,
          dimensions: { ...dimensions },
          transform: {
            position: { ...transform.position },
            rotation: { ...transform.rotation },
            scale: { ...transform.scale },
          },
        },
      });
    },
    [execute],
  );

  const commitTransforms = useCallback(
    (commits: readonly DirectManipulationCommit[]): void => {
      const document = historyRef.current?.present;
      if (!document || commits.length === 0) return;
      const changes = new Map(commits.map((commit) => [commit.nodeId, commit]));
      const nodes = document.nodes.flatMap((node) => {
        const commit = changes.get(node.id);
        if (!commit || node.locked) return [];
        return [
          {
            ...node,
            dimensions: commit.dimensions ? { ...commit.dimensions } : node.dimensions,
            transform: {
              position: { ...commit.transform.position },
              rotation: { ...commit.transform.rotation },
              scale: { ...commit.transform.scale },
            },
          },
        ];
      });
      if (nodes.length > 0) execute({ type: 'replace-nodes', nodes });
    },
    [execute],
  );

  const undo = useCallback((): void => {
    const current = historyRef.current;
    if (!current) return;
    const next = undoHistory(current);
    replaceHistory(next);
    if (selectedIds.some((nodeId) => !next.present.nodes.some((node) => node.id === nodeId))) {
      setSelectedIds([]);
    }
  }, [replaceHistory, selectedIds]);

  const redo = useCallback((): void => {
    const current = historyRef.current;
    if (current) replaceHistory(redoHistory(current));
  }, [replaceHistory]);

  const createCheckpoint = useCallback(async (): Promise<void> => {
    const document = historyRef.current?.present;
    if (!document) return;
    setSaveState('saving');
    const baseRevision = serverRevisionRef.current;
    if (baseRevision === null) {
      setSaveState('error');
      setSaveError('Не удалось определить сохранённую версию проекта.');
      return;
    }
    const save = await api.saveDraft<ThreeDDocument>(projectId, document, baseRevision);
    if (!save.ok) {
      const failure = friendlySaveFailure(save.status);
      setSaveState('error');
      setSaveError(failure.message);
      setRequiresSignIn(failure.signIn);
      setNotice(null);
      return;
    }
    lastSavedRef.current = JSON.stringify(document);
    serverRevisionRef.current = save.data.draft.revision;
    clearLocalThreeDDraft(window.localStorage, projectId);
    setSaveError(null);
    setRequiresSignIn(false);
    const response = await api.createCheckpoint(projectId, 'Версия из ASA 3D');
    if (!response.ok) {
      const failure = friendlySaveFailure(response.status);
      setSaveState('error');
      setSaveError(failure.message);
      setRequiresSignIn(failure.signIn);
      setNotice(null);
      return;
    }
    setVersions((current) => [response.data.version, ...current]);
    setSaveState('saved');
    setNotice(`Создана неизменяемая версия №${response.data.version.versionNo}.`);
  }, [projectId]);

  const retrySave = useCallback((): void => {
    setSaveError(null);
    setRequiresSignIn(false);
    setSaveRetry((current) => current + 1);
  }, []);

  const signInAgain = useCallback((): void => {
    const document = historyRef.current?.present;
    if (document) {
      writeLocalThreeDDraft(window.localStorage, projectId, document, lastSavedRef.current);
    }
    window.location.hash = '#/sign-in';
    window.location.reload();
  }, [projectId]);

  const renameProject = useCallback(async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(savedTitleRef.current);
      return;
    }
    if (trimmed === savedTitleRef.current) {
      setTitle(trimmed);
      return;
    }
    const response = await api.renameProject(projectId, trimmed);
    if (!response.ok) {
      setTitle(savedTitleRef.current);
      if (response.status === 401) {
        const failure = friendlySaveFailure(response.status);
        setSaveState('error');
        setSaveError(failure.message);
        setRequiresSignIn(true);
        setNotice(null);
      } else {
        setNotice('Название пока не изменено. Попробуйте ещё раз.');
      }
      return;
    }
    savedTitleRef.current = response.data.project.title;
    setTitle(response.data.project.title);
    setNotice('Название проекта изменено.');
  }, [projectId, title]);

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
      setSelectedIds([]);
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
    serverRevision: serverRevisionRef.current,
    selectedId,
    selectedIds,
    selectedNode,
    selectedNodes,
    selectedGroupId,
    selectedBundleId,
    saveState,
    saveError,
    requiresSignIn,
    notice,
    versions,
    hasClipboard: clipboard.length > 0,
    hasHiddenNodes: Boolean(history?.present.nodes.some((node) => !node.visible)),
    setTitle,
    renameProject,
    setSelectedId,
    selectAll,
    execute,
    addPrimitive,
    copySelected,
    cutSelected,
    pasteCopied,
    duplicateSelected,
    removeSelected,
    setSelectionOperation,
    hideSelected,
    showAll,
    toggleSelectionLock,
    bundleSelected,
    unbundleSelected,
    groupSelected,
    ungroupSelected,
    setSelectedGroupOperation,
    alignSelected,
    mirrorSelected,
    dropSelectedToWorkplane,
    cruiseSelectedTo,
    toggleRuler,
    setRulerOriginFromSelection,
    commitTransform,
    commitTransforms,
    undo,
    redo,
    createCheckpoint,
    retrySave,
    signInAgain,
    importDocument,
    clearNotice: () => setNotice(null),
  };
}
