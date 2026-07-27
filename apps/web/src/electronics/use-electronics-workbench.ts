import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { type ComponentKind, type SchematicComponent } from '../api';
import {
  WORKBENCH_CATALOG,
  catalogEntry,
  renderedSize,
  terminalPosition,
  type ComponentCategory,
  type ComponentVisualState,
} from './component-catalog';
import {
  clientToWorld,
  clamp,
  fitViewport,
  snap,
  viewportViewBox,
  type Point,
  type Viewport,
} from './workbench-geometry';
import { useWorkbenchProjectState } from './use-workbench-project-state';
import {
  addComponentToDocument,
  connectTerminals,
  duplicateComponentInDocument,
  moveComponentInDocument,
  removeSelectionFromDocument,
  rotateSelectionInDocument,
  sceneBounds,
  toggleSelectedWireRoute,
  updateSelectedWireColor,
  updateSelectionValue,
} from './workbench-document';
import {
  DEFAULT_VIEWPORT,
  DRAG_MIME,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type ComponentDrag,
  type PanDrag,
  type Selection,
  type TerminalRef,
} from './workbench-model';

export function useElectronicsWorkbench(projectId: string) {
  const projectState = useWorkbenchProjectState(projectId);
  const {
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
  } = projectState;

  const [selection, setSelection] = useState<Selection>(null);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalRef | null>(null);
  const [wirePreviewEnd, setWirePreviewEnd] = useState<Point | null>(null);
  const [activeWireColor, setActiveWireColor] = useState('#e3212b');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory>('all');
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [panning, setPanning] = useState(false);

  const stageRef = useRef<SVGSVGElement>(null);
  const componentDragRef = useRef<ComponentDrag | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  const spacePressedRef = useRef(false);
  const counterRef = useRef(0);
  function nextId(prefix: string): string {
    counterRef.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${counterRef.current}`;
  }

  function visibleCenter(): Point {
    const box = viewportViewBox(viewport, STAGE_WIDTH, STAGE_HEIGHT);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  function addComponent(kind: Exclude<ComponentKind, 'wire'>, at?: Point): void {
    if (!document) return;
    const added = addComponentToDocument(document, kind, at ?? visibleCenter(), nextId(kind));
    const entry = catalogEntry(kind);
    commitDocument(added.document, `${entry?.label ?? 'Компонент'} добавлен. Соедините выводы проводами.`);
    setSelection({ kind: 'component', id: added.component.id });
  }

  function duplicateSelected(): void {
    if (!document || selection?.kind !== 'component') return;
    const duplicated = duplicateComponentInDocument(document, selection, nextId(selection.id));
    if (!duplicated) return;
    commitDocument(duplicated.document, 'Создана копия элемента.');
    setSelection({ kind: 'component', id: duplicated.component.id });
  }

  function removeSelection(): void {
    if (!document || !selection) return;
    commitDocument(
      removeSelectionFromDocument(document, selection),
      selection.kind === 'wire' ? 'Провод удалён.' : 'Элемент удалён.',
    );
    setSelection(null);
  }

  function rotateSelected(): void {
    if (!document) return;
    const next = rotateSelectionInDocument(document, selection);
    if (next) commitDocument(next, 'Элемент повернут на 90° — провода обновлены.');
  }

  function updateSelectedValue(value: number): void {
    if (!document) return;
    const next = updateSelectionValue(document, selection, value);
    if (next) commitDocument(next);
  }

  function setWireColor(color: string): void {
    setActiveWireColor(color);
    if (!document) return;
    const next = updateSelectedWireColor(document, selection, color);
    if (next) commitDocument(next);
  }

  function toggleWireRoute(): void {
    if (!document) return;
    const next = toggleSelectedWireRoute(document, selection);
    if (next) commitDocument(next);
  }

  function clickTerminal(componentId: string, terminal: 'a' | 'b'): void {
    if (!document) return;
    if (!pendingTerminal) {
      setPendingTerminal({ componentId, terminal });
      setNotice('Выберите второй вывод. Провод будет проложен автоматически.');
      return;
    }
    if (pendingTerminal.componentId === componentId && pendingTerminal.terminal === terminal) {
      setPendingTerminal(null);
      setWirePreviewEnd(null);
      setNotice('Прокладка провода отменена.');
      return;
    }
    const connected = connectTerminals(document, pendingTerminal, { componentId, terminal }, nextId('wire'), activeWireColor);
    if (connected.kind === 'duplicate') {
      setPendingTerminal(null);
      setWirePreviewEnd(null);
      setNotice('Эти выводы уже соединены.');
      return;
    }
    commitDocument(connected.document, 'Провод добавлен.');
    setSelection({ kind: 'wire', id: connected.wire.id });
    setPendingTerminal(null);
    setWirePreviewEnd(null);
  }

  function toWorld(event: PointerEvent | DragEvent | WheelEvent): Point {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    return clientToWorld(event.clientX, event.clientY, stage.getBoundingClientRect(), viewport, STAGE_WIDTH, STAGE_HEIGHT);
  }

  function startComponentDrag(event: PointerEvent<SVGGElement>, component: SchematicComponent): void {
    if (event.button !== 0 || pendingTerminal) return;
    const point = toWorld(event);
    componentDragRef.current = {
      componentId: component.id,
      pointerId: event.pointerId,
      offset: { x: point.x - component.position.x, y: point.y - component.position.y },
      startedAt: component.position,
    };
    stageRef.current?.setPointerCapture(event.pointerId);
    setSelection({ kind: 'component', id: component.id });
    event.stopPropagation();
    event.preventDefault();
  }

  function startPan(event: PointerEvent<SVGSVGElement>): void {
    const shouldPan = event.button === 1 || (event.button === 0 && spacePressedRef.current);
    if (!shouldPan) {
      if (event.target === event.currentTarget || (event.target as Element).classList.contains('workbench-grid-hit')) setSelection(null);
      return;
    }
    panDragRef.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
    };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>): void {
    const world = toWorld(event);
    if (pendingTerminal) setWirePreviewEnd(world);
    const drag = componentDragRef.current;
    if (drag && drag.pointerId === event.pointerId && document) {
      const component = document.components.find((item) => item.id === drag.componentId);
      const entry = component ? catalogEntry(component.kind) : null;
      if (!component || !entry) return;
      const size = renderedSize(entry, component.rotation ?? 0);
      const margin = 20;
      const next = {
        x: snap(clamp(world.x - drag.offset.x, -1000 + margin, 5000 - size.width - margin)),
        y: snap(clamp(world.y - drag.offset.y, -1000 + margin, 4000 - size.height - margin)),
      };
      setDocument(moveComponentInDocument(document, drag.componentId, next));
      setSaveStatus('dirty');
      return;
    }
    const pan = panDragRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const scaleX = (STAGE_WIDTH / pan.startViewport.zoom) / rect.width;
      const scaleY = (STAGE_HEIGHT / pan.startViewport.zoom) / rect.height;
      setViewport({
        ...pan.startViewport,
        x: pan.startViewport.x - (event.clientX - pan.startClient.x) * scaleX,
        y: pan.startViewport.y - (event.clientY - pan.startClient.y) * scaleY,
      });
    }
  }

  function finishPointer(event: PointerEvent<SVGSVGElement>): void {
    const drag = componentDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      componentDragRef.current = null;
      if (document) {
        const moved = document.components.find((item) => item.id === drag.componentId);
        if (moved && (moved.position.x !== drag.startedAt.x || moved.position.y !== drag.startedAt.y)) {
          pushHistory(document);
          setNotice('Положение сохранится автоматически.');
        }
      }
    }
    if (panDragRef.current?.pointerId === event.pointerId) {
      panDragRef.current = null;
      setPanning(false);
    }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture may already be released */ }
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = toWorld(event);
    const zoom = clamp(viewport.zoom * (event.deltaY > 0 ? 0.88 : 1.14), 0.35, 3.2);
    const visibleWidth = STAGE_WIDTH / zoom;
    const visibleHeight = STAGE_HEIGHT / zoom;
    const rx = (event.clientX - rect.left) / rect.width;
    const ry = (event.clientY - rect.top) / rect.height;
    setViewport({ x: before.x - rx * visibleWidth, y: before.y - ry * visibleHeight, zoom });
  }

  function zoomBy(factor: number): void {
    const center = visibleCenter();
    const zoom = clamp(viewport.zoom * factor, 0.35, 3.2);
    setViewport({ x: center.x - STAGE_WIDTH / zoom / 2, y: center.y - STAGE_HEIGHT / zoom / 2, zoom });
  }

  function fitScene(): void {
    if (!document || document.components.length === 0) {
      setViewport(DEFAULT_VIEWPORT);
      return;
    }
    const bounds = sceneBounds(document);
    setViewport(bounds ? fitViewport(bounds, STAGE_WIDTH, STAGE_HEIGHT) : DEFAULT_VIEWPORT);
  }

  function handleDrop(event: DragEvent<SVGSVGElement>): void {
    event.preventDefault();
    const kind = event.dataTransfer.getData(DRAG_MIME) as Exclude<ComponentKind, 'wire'>;
    if (!['source', 'resistor', 'led'].includes(kind)) return;
    addComponent(kind, toWorld(event));
  }

  useEffect(() => {
    function keyDown(event: globalThis.KeyboardEvent): void {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) spacePressedRef.current = true;
      const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (editable) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelection();
      } else if (event.key.toLowerCase() === 'r' && selection?.kind === 'component') {
        event.preventDefault();
        rotateSelected();
      } else if (event.key === 'Escape') {
        setPendingTerminal(null);
        setWirePreviewEnd(null);
        setSelection(null);
      }
    }
    function keyUp(event: globalThis.KeyboardEvent): void { if (event.code === 'Space') spacePressedRef.current = false; }
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
    };
  });

  const filteredCatalog = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    return WORKBENCH_CATALOG.filter((entry) => {
      const categoryMatches = category === 'all' || entry.category === category;
      const queryMatches = !query || [entry.label, entry.description, ...entry.keywords].join(' ').toLowerCase().includes(query);
      return categoryMatches && queryMatches;
    });
  }, [category, libraryQuery]);

  const selectedComponent = selection?.kind === 'component' ? document?.components.find((item) => item.id === selection.id) ?? null : null;
  const selectedWire = selection?.kind === 'wire' ? document?.connections.find((item) => item.id === selection.id) ?? null : null;
  const selectedEntry = selectedComponent ? catalogEntry(selectedComponent.kind) : null;
  const resultByComponent = useMemo(() => {
    const map = new Map<string, { current: number; voltageDrop: number; lit?: boolean }>();
    for (const item of result?.components ?? []) map.set(item.componentId, item);
    return map;
  }, [result]);

  const diagnosticCodesByComponent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const diagnostic of result?.diagnostics ?? []) {
      for (const componentId of diagnostic.componentIds ?? []) {
        const codes = map.get(componentId) ?? new Set<string>();
        codes.add(diagnostic.code);
        map.set(componentId, codes);
      }
    }
    return map;
  }, [result]);

  function componentVisualState(component: SchematicComponent): ComponentVisualState {
    if (component.kind !== 'led' || !simulationRunning) return 'default';
    const codes = diagnosticCodesByComponent.get(component.id);
    if (codes?.has('led_reverse')) return 'reverse';
    if (codes?.has('led_no_resistor') || codes?.has('short_circuit')) return 'burned';
    if (codes?.has('overcurrent')) return 'overcurrent';
    return resultByComponent.get(component.id)?.lit ? 'lit' : 'off';
  }

  const viewBox = viewportViewBox(viewport, STAGE_WIDTH, STAGE_HEIGHT);
  const pendingStart = pendingTerminal && document
    ? (() => {
        const component = document.components.find((item) => item.id === pendingTerminal.componentId);
        return component ? terminalPosition(component.kind, component.position, pendingTerminal.terminal, component.rotation ?? 0) : null;
      })()
    : null;

  return {
    project, document, result, versions, status, saveStatus, saveCopy, notice,
    selection, setSelection, pendingTerminal, wirePreviewEnd, activeWireColor,
    simulationRunning, libraryOpen, setLibraryOpen, libraryQuery, setLibraryQuery,
    category, setCategory, viewport, projectTitle, setProjectTitle, stageRef,
    canUndo, canRedo, undo, redo, duplicateSelected, removeSelection, rotateSelected,
    updateSelectedValue, setWireColor, toggleWireRoute, clickTerminal,
    startComponentDrag, startPan, handlePointerMove, finishPointer, handleWheel,
    zoomBy, fitScene, handleDrop, saveNow, toggleSimulation, checkpoint, renameProject,
    filteredCatalog, selectedComponent, selectedWire, selectedEntry, resultByComponent,
    componentVisualState, viewBox, pendingStart, busy, panning, addComponent,
  };
}

export type ElectronicsWorkbenchController = ReturnType<typeof useElectronicsWorkbench>;
