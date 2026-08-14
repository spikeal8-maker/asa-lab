import { useCallback, useEffect, useRef, useState } from 'react';
import {
  alignDocumentNodes,
  commitCommand,
  createHistory,
  createThreeDNode,
  groupDocumentNodes,
  parseThreeDDocument,
  redoHistory,
  replaceHistoryPresent,
  selectionBounds,
  setDocumentNodeOperation,
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

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface ThreeDProjectController {
  readonly loading: boolean;
  readonly error: string | null;
  readonly title: string;
  readonly history: HistoryState | null;
  readonly document: ThreeDDocument | null;
  readonly selectedId: string | null;
  readonly selectedIds: readonly string[];
  readonly selectedNode: ThreeDNode | null;
  readonly selectedNodes: readonly ThreeDNode[];
  readonly selectedGroupId: string | null;
  readonly saveState: SaveState;
  readonly notice: string | null;
  readonly versions: readonly ProjectVersion[];
  readonly hasClipboard: boolean;
  readonly setTitle: (title: string) => void;
  readonly renameProject: () => Promise<void>;
  readonly setSelectedId: (nodeId: string | null, additive?: boolean) => void;
  readonly execute: (command: ThreeDCommand) => void;
  readonly addPrimitive: (
    primitive: PrimitiveKind,
    position?: { x: number; z: number },
    additive?: boolean,
    operation?: ShapeOperation,
  ) => void;
  readonly copySelected: () => void;
  readonly pasteCopied: () => void;
  readonly duplicateSelected: () => void;
  readonly removeSelected: () => void;
  readonly setSelectionOperation: (operation: 'solid' | 'hole') => void;
  readonly groupSelected: (operation?: BooleanOperation) => void;
  readonly ungroupSelected: () => void;
  readonly setSelectedGroupOperation: (operation: BooleanOperation) => void;
  readonly alignSelected: (axis: AlignmentAxis, mode: AlignmentMode) => void;
  readonly setRulerOriginFromSelection: () => void;
  readonly commitTransform: (
    nodeId: string,
    transform: ThreeDTransform,
    dimensions?: ThreeDDimensions,
  ) => void;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly ProjectVersion[]>([]);
  const [clipboard, setClipboard] = useState<readonly ThreeDNode[]>([]);
  const lastSavedRef = useRef('');
  const savedTitleRef = useRef('Новый 3D-проект');

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
      setSelectedIds([]);
      setClipboard([]);
      lastSavedRef.current = JSON.stringify(parsed.value);
      setTitle(response.data.project.title);
      savedTitleRef.current = response.data.project.title;
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
    const incoming = groupId
      ? document.nodes.filter((node) => node.groupId === groupId).map((node) => node.id)
      : document.nodes.some((node) => node.id === nodeId)
        ? [nodeId]
        : [];
    if (incoming.length === 0) return;
    setSelectedIds((current) => {
      if (!additive) return incoming;
      const next = new Set(current);
      const remove = incoming.every((id) => next.has(id));
      incoming.forEach((id) => (remove ? next.delete(id) : next.add(id)));
      return [...next];
    });
  }, []);

  const addPrimitive = useCallback(
    (
      primitive: PrimitiveKind,
      position?: { x: number; z: number },
      additive = false,
      operation: ShapeOperation = 'solid',
    ): void => {
      const node = { ...createThreeDNode(primitive, makeId(primitive)), operation };
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

  const pasteCopied = useCallback((): void => {
    const document = historyRef.current?.present;
    if (!document || clipboard.length === 0) return;
    const groupIds = new Map<string, string>();
    const copies = clipboard.map((source): ThreeDNode => {
      const groupId = source.groupId ? (groupIds.get(source.groupId) ?? makeId('group')) : null;
      if (source.groupId && groupId) groupIds.set(source.groupId, groupId);
      return {
        ...structuredClone(source),
        id: makeId(source.primitive),
        name: `${source.name} — копия`,
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
    const copies = current.map((source): ThreeDNode => {
      const groupId = source.groupId ? (groupIds.get(source.groupId) ?? makeId('group')) : null;
      if (source.groupId && groupId) groupIds.set(source.groupId, groupId);
      return {
        ...structuredClone(source),
        id: makeId(source.primitive),
        name: `${source.name} — копия`,
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
      let prepared = document;
      if (
        effectiveOperation === 'difference' &&
        !selected.some((node) => node.operation === 'hole')
      ) {
        const baseId = selected.find((node) => node.operation === 'solid')?.id ?? selected[0]?.id;
        prepared = {
          ...document,
          nodes: document.nodes.map((node) =>
            groupNodeIds.includes(node.id)
              ? { ...node, operation: node.id === baseId ? 'solid' : 'hole' }
              : node,
          ),
        };
      }
      commitDocument(
        groupDocumentNodes(prepared, groupNodeIds, makeId('group'), effectiveOperation),
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
      const [groupId] = [...groupIds];
      const members = document.nodes.filter((node) => node.groupId === groupId);
      const keepExistingDifference =
        operation === 'difference' && members.some((node) => node.operation === 'hole');
      const baseId = members.find((node) => node.operation === 'solid')?.id ?? members[0]?.id;
      commitDocument({
        ...document,
        nodes: document.nodes.map((node) =>
          node.groupId && groupIds.has(node.groupId)
            ? {
                ...node,
                groupOperation: operation,
                operation:
                  operation === 'difference'
                    ? keepExistingDifference
                      ? node.operation
                      : node.id === baseId
                        ? 'solid'
                        : 'hole'
                    : node.operation,
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
      setNotice(`Название не изменено: ${response.error.message}`);
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
    selectedId,
    selectedIds,
    selectedNode,
    selectedNodes,
    selectedGroupId,
    saveState,
    notice,
    versions,
    hasClipboard: clipboard.length > 0,
    setTitle,
    renameProject,
    setSelectedId,
    execute,
    addPrimitive,
    copySelected,
    pasteCopied,
    duplicateSelected,
    removeSelected,
    setSelectionOperation,
    groupSelected,
    ungroupSelected,
    setSelectedGroupOperation,
    alignSelected,
    setRulerOriginFromSelection,
    commitTransform,
    undo,
    redo,
    createCheckpoint,
    importDocument,
    clearNotice: () => setNotice(null),
  };
}
