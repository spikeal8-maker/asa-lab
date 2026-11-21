import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { SchematicAnnotation, SchematicDocument } from '../api';
import type { Point } from './workbench-geometry';
import type { Selection } from './workbench-model';
import {
  boundedAnnotation,
  CANVAS_ANNOTATION_LIMITS,
  setDocumentAnnotations,
} from './workbench-annotations';

interface AnnotationPort {
  document: SchematicDocument | null;
  selection: Selection;
  clipboard: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  setClipboard: Dispatch<SetStateAction<Selection>>;
  getCurrentDocument: () => SchematicDocument | null;
  commit: (document: SchematicDocument, message?: string) => void;
  notice: (message: string) => void;
  nextId: (prefix: string) => string;
  center: () => Point;
  scale: () => number;
}

const clone = (annotation: SchematicAnnotation): SchematicAnnotation => ({
  ...annotation,
  position: { ...annotation.position },
  size: { ...annotation.size },
});

/** All persisted state stays in the project's existing document/history. */
export function useCanvasAnnotations(port: AnnotationPort) {
  const items = port.document?.annotations ?? [];
  const selectedIds = port.selection?.kind === 'annotation' ? port.selection.ids : [];
  const selected =
    selectedIds.length === 1 ? (items.find((item) => item.id === selectedIds[0]) ?? null) : null;
  useEffect(() => {
    if (
      port.selection?.kind === 'annotation' &&
      !port.document?.annotations?.some(
        (item) => port.selection?.kind === 'annotation' && port.selection.ids.includes(item.id),
      )
    )
      port.setSelection(null);
  }, [port.document, port.selection, port.setSelection]);
  const select = (id: string, editing = false) =>
    port.setSelection({ kind: 'annotation', id, ids: [id], editing });
  const commitItems = (
    document: SchematicDocument,
    annotations: SchematicAnnotation[],
    message?: string,
  ) => port.commit(setDocumentAnnotations(document, annotations), message);
  function add() {
    const document = port.getCurrentDocument();
    if (!document) return;
    if ((document.annotations?.length ?? 0) >= CANVAS_ANNOTATION_LIMITS.count) {
      port.notice('Достигнут предел текстовых объектов.');
      return;
    }
    const center = port.center(),
      scale = Math.max(0.25, Math.min(4, port.scale()));
    const annotation = boundedAnnotation({
      id: port.nextId('text'),
      text: 'Текст',
      position: { x: center.x - 120 * scale, y: center.y - 48 * scale },
      size: { width: 240 * scale, height: 96 * scale },
      fontSize: Math.round(18 * scale),
    });
    commitItems(
      document,
      [...(document.annotations ?? []), annotation],
      'Текст добавлен на схему.',
    );
    select(annotation.id, true);
  }
  function update(
    id: string,
    changes: Partial<Pick<SchematicAnnotation, 'text' | 'position' | 'size' | 'fontSize'>>,
    expected?: SchematicAnnotation,
  ) {
    const document = port.getCurrentDocument(),
      current = document?.annotations?.find((item) => item.id === id);
    if (!document || !current) return;
    if (expected && JSON.stringify(expected) !== JSON.stringify(current)) {
      port.notice('Текст изменился во время перемещения. Повторите действие.');
      return;
    }
    const next = boundedAnnotation({ ...current, ...changes });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    commitItems(
      document,
      document.annotations!.map((item) => (item.id === id ? next : item)),
    );
  }
  function remove(): boolean {
    if (port.selection?.kind !== 'annotation') return false;
    const document = port.getCurrentDocument();
    if (!document) return true;
    const ids = new Set(port.selection.ids);
    commitItems(
      document,
      (document.annotations ?? []).filter((item) => !ids.has(item.id)),
      'Текст удалён.',
    );
    port.setSelection(null);
    return true;
  }
  function copy(): boolean {
    if (port.selection?.kind !== 'annotation') return false;
    const ids = new Set(port.selection.ids);
    const copied = (port.getCurrentDocument()?.annotations ?? [])
      .filter((item) => ids.has(item.id))
      .map(clone);
    if (copied.length)
      port.setClipboard({
        kind: 'annotation',
        id: copied[0]!.id,
        ids: copied.map((item) => item.id),
        copied,
      });
    port.notice('Текст скопирован.');
    return true;
  }
  function insert(copied: readonly SchematicAnnotation[], changeClipboard: boolean) {
    const document = port.getCurrentDocument();
    if (!document || !copied.length) return;
    if ((document.annotations?.length ?? 0) + copied.length > CANVAS_ANNOTATION_LIMITS.count) {
      port.notice('Достигнут предел текстовых объектов.');
      return;
    }
    const pasted = copied.map((item) =>
      boundedAnnotation({
        ...clone(item),
        id: port.nextId('text'),
        position: { x: item.position.x + 20, y: item.position.y + 20 },
      }),
    );
    commitItems(document, [...(document.annotations ?? []), ...pasted], 'Копия текста вставлена.');
    port.setSelection({
      kind: 'annotation',
      id: pasted[0]!.id,
      ids: pasted.map((item) => item.id),
    });
    if (changeClipboard)
      port.setClipboard({
        kind: 'annotation',
        id: pasted[0]!.id,
        ids: pasted.map((item) => item.id),
        copied: pasted.map(clone),
      });
  }
  function paste(): boolean {
    if (port.clipboard?.kind !== 'annotation') return false;
    insert(port.clipboard.copied ?? [], true);
    return true;
  }
  function duplicate(): boolean {
    if (port.selection?.kind !== 'annotation') return false;
    const ids = new Set(port.selection.ids);
    insert(
      (port.getCurrentDocument()?.annotations ?? []).filter((item) => ids.has(item.id)),
      false,
    );
    return true;
  }
  function nudge(dx: number, dy: number): boolean {
    if (port.selection?.kind !== 'annotation') return false;
    const document = port.getCurrentDocument();
    if (!document) return true;
    const ids = new Set(port.selection.ids);
    commitItems(
      document,
      (document.annotations ?? []).map((item) =>
        ids.has(item.id)
          ? boundedAnnotation({
              ...item,
              position: { x: item.position.x + dx, y: item.position.y + dy },
            })
          : item,
      ),
    );
    return true;
  }
  return {
    editing: port.selection?.kind === 'annotation' && port.selection.editing === true,
    items,
    selectedIds,
    selected,
    add,
    select,
    update,
    remove,
    copy,
    paste,
    duplicate,
    nudge,
    clear: () => port.setSelection(null),
  };
}

export type CanvasAnnotationsController = ReturnType<typeof useCanvasAnnotations>;
