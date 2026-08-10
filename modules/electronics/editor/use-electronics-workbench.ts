import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import type { ComponentResult, Diagnostic, SchematicComponent, Terminal } from '../index.js';
import {
  catalogEntry,
  componentPointPosition,
  familyById,
  familyForVariant,
  familyMatchesCategory,
  familySearchText,
  renderedSize,
  selectedFamilyVariant,
  workbenchCatalog,
  type ComponentCategory,
  type ComponentVisualState,
} from './component-catalog';
import {
  clientToWorld,
  clamp,
  completeOrthogonalRoute,
  fitViewport,
  freeWirePoint,
  lockOrthogonalBend,
  lockOrthogonalPoint,
  viewportViewBox,
  type Point,
  type Viewport,
} from './workbench-geometry';
import { useWorkbenchProjectState } from './use-workbench-project-state';
import {
  addComponentToDocument,
  componentsBoundToBreadboard,
  connectTerminals,
  duplicateComponentInDocument,
  insertWireVertex,
  moveComponentInDocument,
  moveComponentsInDocument,
  moveWireVertex,
  mirrorSelectionInDocument,
  reconnectWireEndpoint,
  removeWireVertex,
  removeSelectedWireBends,
  removeSelectionFromDocument,
  rotateSelectionInDocument,
  sceneBounds,
  snapComponentToBreadboard,
  terminalPositionInDocument,
  toggleSelectedWireRoute,
  updateSelectedWireColor,
  updateSelectionName,
  updateSelectionState,
  updateSelectionProperties,
  updateSelectionValue,
  updateSelectionVariant,
  updateWiperPosition,
} from './workbench-document';
import {
  DEFAULT_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type ActuatorPress,
  type CatalogPlacement,
  type ComponentDrag,
  type EndpointDrag,
  type MarqueeDrag,
  type PanDrag,
  type PotentiometerDrag,
  type Selection,
  type TerminalRef,
  type VertexDrag,
} from './workbench-model';
import { calculateLiveSimulation } from './live-simulation';

function terminalRefKey(componentId: string, terminal: Terminal): string {
  return `${componentId}:${terminal}`;
}

export function useElectronicsWorkbench(projectId: string) {
  const projectState = useWorkbenchProjectState(projectId);
  const {
    project,
    document,
    setDocument,
    result: persistedResult,
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
  } = projectState;

  const result = useMemo(
    () => calculateLiveSimulation(document, persistedResult, simulationRunning),
    [document, persistedResult, simulationRunning],
  );

  const [selection, setSelection] = useState<Selection>(null);
  const [clipboardSelection, setClipboardSelection] = useState<Selection>(null);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalRef | null>(null);
  const [wireDraftVertices, setWireDraftVertices] = useState<readonly Point[]>([]);
  const [wirePreviewEnd, setWirePreviewEnd] = useState<Point | null>(null);
  const [activeWireColor, setActiveWireColor] = useState('#149447');
  const [orthogonalWireMode, setOrthogonalWireMode] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory>('basic');
  const [libraryView, setLibraryView] = useState<'grid' | 'list'>('grid');
  const [libraryVariants, setLibraryVariants] = useState<Readonly<Record<string, string>>>({});
  const [libraryVariantPopover, setLibraryVariantPopover] = useState<string | null>(null);
  const [catalogPlacement, setCatalogPlacement] = useState<CatalogPlacement | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [panning, setPanning] = useState(false);
  // A breadboard draws one invisible group per hole — several hundred of them —
  // and every one recomputes its world position when the board moves. They are
  // hover targets, so while something is being dragged they have nothing to do,
  // and not drawing them is the difference between the board following the
  // pointer and crawling after it.
  const [draggingComponents, setDraggingComponents] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeDrag | null>(null);
  const [reconnectEndpoint, setReconnectEndpoint] = useState<'from' | 'to' | null>(null);

  const stageRef = useRef<SVGSVGElement>(null);
  const catalogPlacementRef = useRef<CatalogPlacement | null>(null);
  const componentDragRef = useRef<ComponentDrag | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  // Where the view actually is while a pan is in flight, since React state is
  // deliberately not being updated for each frame of it.
  const panViewportRef = useRef<Viewport | null>(null);
  const vertexDragRef = useRef<VertexDrag | null>(null);
  const endpointDragRef = useRef<EndpointDrag | null>(null);
  const actuatorPressRef = useRef<ActuatorPress | null>(null);
  const potentiometerDragRef = useRef<PotentiometerDrag | null>(null);
  const spacePressedRef = useRef(false);
  const counterRef = useRef(0);
  const viewportProjectRef = useRef<string | null>(null);
  function nextId(prefix: string): string {
    counterRef.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${counterRef.current}`;
  }

  function visibleCenter(): Point {
    const box = viewportViewBox(viewport, STAGE_WIDTH, STAGE_HEIGHT);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  function setCatalogPlacementState(next: CatalogPlacement | null): void {
    catalogPlacementRef.current = next;
    setCatalogPlacement(next);
  }

  function catalogPositionAtClient(
    componentTypeId: string,
    clientX: number,
    clientY: number,
  ): Point | null {
    const stage = stageRef.current;
    const entry = catalogEntry(componentTypeId);
    if (!stage || !entry) return null;
    const rect = stage.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const pointer = clientToWorld(clientX, clientY, rect, viewport, STAGE_WIDTH, STAGE_HEIGHT);
    return pointer;
  }

  function applyViewport(next: Viewport): void {
    setViewport(next);
    if (document) {
      setDocument({ ...document, viewport: next });
    }
  }

  /** Move the view during a drag without re-rendering the scene.
   *
   * Panning fires on every pointer move. Writing the viewport into the document
   * there rebuilt the whole document object per frame; putting it in React state
   * still re-rendered the entire stage — every component, wire and terminal —
   * for a change that only moves the window over them. Nothing inside the canvas
   * changes while panning, so the viewBox is written straight to the element and
   * the browser simply redraws what it already has.
   *
   * React learns the final position once, when the drag ends. Anything derived
   * from the viewport — the minimap, tooltip placement — is a frame behind during
   * the drag and correct the moment it stops.
   */
  function moveViewport(next: Viewport): void {
    panViewportRef.current = next;
    const stage = stageRef.current;
    if (!stage) {
      setViewport(next);
      return;
    }
    const box = viewportViewBox(next, STAGE_WIDTH, STAGE_HEIGHT);
    stage.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  }

  function commitViewport(next: Viewport): void {
    if (!document) return;
    const current = document.viewport;
    if (current && current.x === next.x && current.y === next.y && current.zoom === next.zoom) {
      return;
    }
    setDocument({ ...document, viewport: next });
  }

  useEffect(() => {
    if (project && document && viewportProjectRef.current !== project.id) {
      viewportProjectRef.current = project.id;
      const stored = document.viewport ?? DEFAULT_VIEWPORT;
      // A document saved while the editor allowed a wider range would otherwise
      // reopen at a zoom the server will not accept back, and every save from
      // then on would fail for a reason the drawing does not explain.
      setViewport({ ...stored, zoom: clamp(stored.zoom, MIN_ZOOM, MAX_ZOOM) });
    }
  }, [document, project]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [notice, setNotice]);

  function addComponent(componentTypeId: string, at?: Point): void {
    if (!document) return;
    const family = familyForVariant(componentTypeId);
    if (!family?.enabled) return;
    const placedCount = document.components.filter((component) => component.kind !== 'wire').length;
    const box = viewportViewBox(viewport, STAGE_WIDTH, STAGE_HEIGHT);
    const column = placedCount % 3;
    const row = Math.floor(placedCount / 3);
    const catalogPosition = {
      x: box.x + box.width * (0.17 + column * 0.22),
      y: box.y + 150 + row * 235,
    };
    const entry = catalogEntry(componentTypeId);
    if (!entry) return;
    const added = addComponentToDocument(
      document,
      componentTypeId,
      at ?? catalogPosition,
      nextId(entry.kind),
    );
    const placedDocument = at
      ? snapComponentToBreadboard(added.document, added.component.id)
      : added.document;
    const placedComponent = placedDocument.components.find(
      (component) => component.id === added.component.id,
    );
    const mounted = Object.keys(placedComponent?.holeBindings ?? {}).length > 0;
    commitDocument(
      placedDocument,
      mounted
        ? `${entry.label} установлен в отверстия макетки.`
        : `${entry.label} добавлен. Соедините выводы проводами.`,
    );
    setSelection({ kind: 'component', id: added.component.id, ids: [added.component.id] });
  }

  function libraryVariant(familyId: string): string | null {
    const family = familyById(familyId);
    if (!family) return null;
    return selectedFamilyVariant(family, libraryVariants[familyId]).variantId;
  }

  function setLibraryVariant(familyId: string, variantId: string): void {
    const family = familyById(familyId);
    if (
      !family?.enabled ||
      !family.variants.some((variant) => variant.variantId === variantId && variant.enabled)
    ) {
      return;
    }
    setLibraryVariants((current) => ({ ...current, [familyId]: variantId }));
  }

  function toggleLibraryVariantPopover(familyId: string): void {
    const family = familyById(familyId);
    if (!family?.enabled || family.variants.length < 2) return;
    setLibraryVariantPopover((current) => (current === familyId ? null : familyId));
  }

  function addFamily(familyId: string, at?: Point): void {
    const family = familyById(familyId);
    if (!family?.enabled) return;
    addComponent(selectedFamilyVariant(family, libraryVariants[familyId]).componentTypeId, at);
  }

  function beginFamilyPlacement(
    familyId: string,
    pointer?: { readonly pointerId: number; readonly clientX: number; readonly clientY: number },
  ): void {
    const family = familyById(familyId);
    if (!family?.enabled) return;
    const variant = selectedFamilyVariant(family, libraryVariants[familyId]);
    const next: CatalogPlacement = {
      componentTypeId: variant.componentTypeId,
      point: pointer
        ? catalogPositionAtClient(variant.componentTypeId, pointer.clientX, pointer.clientY)
        : null,
      clientPoint: pointer ? { x: pointer.clientX, y: pointer.clientY } : null,
      pointerId: pointer?.pointerId ?? null,
      mode: pointer ? 'pointer' : 'keyboard',
    };
    setCatalogPlacementState(next);
    setLibraryVariantPopover(null);
    setSelection(null);
    setPendingTerminal(null);
    setWirePreviewEnd(null);
    setNotice(
      pointer
        ? `${family.familyLabel}: удерживайте кнопку, перенесите и отпустите на рабочем поле.`
        : `${family.familyLabel} прикреплён к указателю. Выберите место на рабочем поле.`,
    );
  }

  function moveFamilyPlacement(pointerId: number, clientX: number, clientY: number): void {
    const current = catalogPlacementRef.current;
    if (current?.mode !== 'pointer' || current.pointerId !== pointerId) return;
    setCatalogPlacementState({
      ...current,
      point: catalogPositionAtClient(current.componentTypeId, clientX, clientY),
      clientPoint: { x: clientX, y: clientY },
    });
  }

  function finishFamilyPlacement(pointerId: number, clientX: number, clientY: number): void {
    const current = catalogPlacementRef.current;
    if (current?.mode !== 'pointer' || current.pointerId !== pointerId) return;
    const point = catalogPositionAtClient(current.componentTypeId, clientX, clientY);
    setCatalogPlacementState(null);
    if (!point) {
      setNotice('Размещение отменено: отпустите компонент над рабочим полем.');
      return;
    }
    addComponent(current.componentTypeId, point);
  }

  function cancelFamilyPlacement(pointerId?: number): void {
    const current = catalogPlacementRef.current;
    if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return;
    setCatalogPlacementState(null);
    setNotice('Размещение отменено.');
  }

  function placeCatalogComponent(event: PointerEvent<SVGSVGElement>): void {
    if (!catalogPlacement || catalogPlacement.mode !== 'keyboard' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const { componentTypeId } = catalogPlacement;
    setCatalogPlacementState(null);
    const point = catalogPositionAtClient(componentTypeId, event.clientX, event.clientY);
    if (point) addComponent(componentTypeId, point);
  }

  function duplicateSelected(): void {
    if (!document || selection?.kind !== 'component') return;
    const duplicated = duplicateComponentInDocument(document, selection, nextId(selection.id));
    if (!duplicated) return;
    commitDocument(duplicated.document, 'Создана копия элемента.');
    const duplicatedIds = duplicated.components.map((component) => component.id);
    setSelection({
      kind: 'component',
      id: duplicated.component.id,
      ids: duplicatedIds,
    });
  }

  function copySelected(): void {
    if (selection?.kind !== 'component') return;
    setClipboardSelection({ ...selection, ids: [...selection.ids] });
    setNotice(selection.ids.length > 1 ? 'Компоненты скопированы.' : 'Компонент скопирован.');
  }

  function pasteCopied(): void {
    if (!document || clipboardSelection?.kind !== 'component') return;
    const duplicated = duplicateComponentInDocument(
      document,
      clipboardSelection,
      nextId(clipboardSelection.id),
    );
    if (!duplicated) {
      setClipboardSelection(null);
      return;
    }
    commitDocument(duplicated.document, 'Копия вставлена.');
    const duplicatedIds = duplicated.components.map((component) => component.id);
    setSelection({ kind: 'component', id: duplicated.component.id, ids: duplicatedIds });
    setClipboardSelection({
      kind: 'component',
      id: duplicated.component.id,
      ids: duplicatedIds,
    });
  }

  function removeSelection(): void {
    if (!document || !selection) return;
    if (selection.kind === 'wire' && selection.vertexIndex !== undefined) {
      removeWireVertexAt(selection.id, selection.vertexIndex);
      return;
    }
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

  function mirrorSelected(axis: 'horizontal' | 'vertical'): void {
    if (!document) return;
    const next = mirrorSelectionInDocument(document, selection, axis);
    if (next)
      commitDocument(next, axis === 'horizontal' ? 'Элемент отражён.' : 'Элемент перевёрнут.');
  }

  function updateSelectedValue(value: number): void {
    if (!document) return;
    const next = updateSelectionValue(document, selection, value);
    if (next) commitDocument(next);
  }

  function updateSelectedName(name: string): void {
    if (!document) return;
    const next = updateSelectionName(document, selection, name);
    if (next) commitDocument(next);
  }

  function setSelectedState(state: boolean): void {
    if (!document) return;
    if (!simulationRunning) {
      setNotice('Запустите моделирование, чтобы управлять кнопкой или переключателем.');
      return;
    }
    const next = updateSelectionState(document, selection, state);
    if (next) commitDocument(next, state ? 'Контакт замкнут.' : 'Контакт разомкнут.');
  }

  function setComponentState(componentId: string, state: boolean, message?: string): void {
    if (!document || !simulationRunning) return;
    const component = document.components.find((item) => item.id === componentId);
    if (!component || (component.kind !== 'switch' && component.kind !== 'button')) return;
    const target = { kind: 'component' as const, id: componentId, ids: [componentId] };
    const next = updateSelectionState(document, target, state);
    if (next) {
      setSelection(target);
      commitDocument(next, message);
    }
  }

  function toggleComponentState(componentId: string): void {
    if (!document || !simulationRunning) {
      setNotice('Запустите моделирование, чтобы управлять компонентом.');
      return;
    }
    const component = document.components.find((item) => item.id === componentId);
    if (!component || (component.kind !== 'switch' && component.kind !== 'button')) return;
    setComponentState(
      componentId,
      !component.state,
      component.state ? 'Контакт разомкнут.' : 'Контакт замкнут.',
    );
  }

  function setSelectedWiper(position: number): void {
    if (!document) return;
    if (!simulationRunning) {
      setNotice('Положение ручки изменяется во время моделирования.');
      return;
    }
    const next = updateWiperPosition(document, selection, position);
    if (next) commitDocument(next, `Положение движка: ${Math.round(position * 100)}%.`);
  }

  function setSelectedProperties(
    properties: Readonly<Record<string, string | number | boolean | readonly string[]>>,
    message?: string,
  ): void {
    if (!document) return;
    const next = updateSelectionProperties(document, selection, properties);
    if (next) commitDocument(next, message);
  }

  function setSelectedVariant(variantId: string): void {
    if (!document || selection?.kind !== 'component') return;
    const family = familyForVariant(
      selectedComponent?.variantId ?? selectedComponent?.componentTypeId,
    );
    if (
      !family?.enabled ||
      !family.variants.some((variant) => variant.variantId === variantId && variant.enabled)
    ) {
      return;
    }
    const next = updateSelectionVariant(document, selection, variantId);
    if (next)
      commitDocument(
        next,
        `Выбран вариант ${selectedFamilyVariant(family, variantId).variantLabel}.`,
      );
  }

  function setWireColor(color: string): void {
    setActiveWireColor(color);
    if (!document) return;
    const next = updateSelectedWireColor(document, selection, color);
    if (next) commitDocument(next);
  }

  function toggleWireRoute(): void {
    const nextMode = !orthogonalWireMode;
    setOrthogonalWireMode(nextMode);
    if (nextMode && document && selection?.kind === 'wire') {
      const next = toggleSelectedWireRoute(document, selection);
      if (next) commitDocument(next, 'Провод проложен автоматически под прямыми углами.');
      return;
    }
    setNotice(
      nextMode ? 'Фиксация провода под 90° включена.' : 'Свободная прокладка провода включена.',
    );
  }

  function removeWireBends(): void {
    if (!document) return;
    const next = removeSelectedWireBends(document, selection);
    if (next) commitDocument(next, 'Изгибы провода удалены.');
  }

  function beginReconnect(endpoint: 'from' | 'to'): void {
    if (selection?.kind !== 'wire') return;
    setReconnectEndpoint(endpoint);
    setWirePreviewEnd(null);
    setNotice('Выберите новый вывод для переподключения провода.');
  }

  function clickTerminal(componentId: string, terminal: Terminal): void {
    if (!document) return;
    // Wiring is rebuilding, not operating.
    if (simulationRunning) {
      setNotice('Идёт моделирование: остановите его, чтобы менять соединения.');
      return;
    }
    if (reconnectEndpoint && selection?.kind === 'wire') {
      const next = reconnectWireEndpoint(document, selection.id, reconnectEndpoint, {
        componentId,
        terminal,
      });
      if (next) commitDocument(next, 'Конец провода переподключён.');
      setReconnectEndpoint(null);
      setWirePreviewEnd(null);
      return;
    }
    if (!pendingTerminal) {
      setPendingTerminal({ componentId, terminal });
      setWireDraftVertices([]);
      const sourceComponent = document.components.find((item) => item.id === componentId);
      setWirePreviewEnd(
        sourceComponent ? terminalPositionInDocument(document, sourceComponent, terminal) : null,
      );
      setNotice(
        'Ведите провод к цели. Щелчок добавляет точку, Shift фиксирует участок под 90°, Esc отменяет.',
      );
      return;
    }
    if (pendingTerminal.componentId === componentId && pendingTerminal.terminal === terminal) {
      setPendingTerminal(null);
      setWireDraftVertices([]);
      setWirePreviewEnd(null);
      setNotice('Прокладка провода отменена.');
      return;
    }
    const targetComponent = document.components.find((item) => item.id === componentId);
    const targetPoint = targetComponent
      ? terminalPositionInDocument(document, targetComponent, terminal)
      : null;
    const finalVertices =
      orthogonalWireMode && pendingStart && targetPoint
        ? completeOrthogonalRoute(pendingStart, targetPoint, wireDraftVertices)
        : wireDraftVertices;
    const connected = connectTerminals(
      document,
      pendingTerminal,
      { componentId, terminal },
      nextId('wire'),
      activeWireColor,
      finalVertices,
    );
    if (connected.kind === 'duplicate') {
      setPendingTerminal(null);
      setWireDraftVertices([]);
      setWirePreviewEnd(null);
      setNotice('Эти выводы уже соединены.');
      return;
    }
    commitDocument(connected.document, 'Провод добавлен.');
    setSelection({ kind: 'wire', id: connected.wire.id });
    setPendingTerminal(null);
    setWireDraftVertices([]);
    setWirePreviewEnd(null);
  }

  function selectComponent(componentId: string, additive = false): void {
    setSelection((current) => {
      if (!additive || current?.kind !== 'component') {
        return { kind: 'component', id: componentId, ids: [componentId] };
      }
      const ids = current.ids.includes(componentId)
        ? current.ids.filter((id) => id !== componentId)
        : [...current.ids, componentId];
      if (ids.length === 0) return null;
      return {
        kind: 'component',
        id: ids.includes(current.id) ? current.id : (ids[0] as string),
        ids,
      };
    });
  }

  function toWorld(event: PointerEvent | MouseEvent | DragEvent | WheelEvent): Point {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    return clientToWorld(
      event.clientX,
      event.clientY,
      stage.getBoundingClientRect(),
      viewport,
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
  }

  function wireVertexDragPoint(
    wireId: string,
    vertexIndex: number,
    point: Point,
    lockRightAngle: boolean,
  ): Point {
    const freePoint = freeWirePoint(point);
    if (!document) return freePoint;
    const wire = document.connections.find((item) => item.id === wireId);
    if (!wire?.vertices?.[vertexIndex]) return freePoint;
    const fromComponent = document.components.find((item) => item.id === wire.from.componentId);
    const toComponent = document.components.find((item) => item.id === wire.to.componentId);
    const previous =
      wire.vertices[vertexIndex - 1] ??
      (fromComponent
        ? terminalPositionInDocument(document, fromComponent, wire.from.terminal)
        : null);
    const next =
      wire.vertices[vertexIndex + 1] ??
      (toComponent ? terminalPositionInDocument(document, toComponent, wire.to.terminal) : null);
    if (!previous || !next) return freePoint;
    // Alignment happens where it was asked for. Holding Shift, or turning on the
    // 90° mode, squares the bend against its neighbours; otherwise the vertex
    // goes exactly where the pointer is.
    //
    // There used to be a magnet here regardless — two of them, in fact, pulling
    // against each other, so near a bend the point flipped between axes as the
    // pointer moved. Making it one magnet was not enough: the choice of which
    // neighbour to align to changed mid-drag, and the point jumped again. A wire
    // laid deliberately alongside another wire could not be placed at all.
    if (lockRightAngle) return lockOrthogonalBend(previous, next, point);
    return freePoint;
  }

  function startComponentDrag(
    event: PointerEvent<SVGGElement>,
    component: SchematicComponent,
  ): void {
    if (event.button !== 0 || pendingTerminal) return;
    if (event.shiftKey) {
      event.stopPropagation();
      return;
    }
    if (simulationRunning && component.kind === 'button') {
      actuatorPressRef.current = {
        componentId: component.id,
        pointerId: event.pointerId,
        kind: 'button',
      };
      stageRef.current?.setPointerCapture(event.pointerId);
      setSelection({ kind: 'component', id: component.id, ids: [component.id] });
      setComponentState(component.id, true, 'Кнопка нажата.');
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (simulationRunning && component.kind === 'switch') {
      setSelection({ kind: 'component', id: component.id, ids: [component.id] });
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    // A running simulation is a circuit under power: it can be operated, not
    // rebuilt. Actuators above still work, a potentiometer still turns, and
    // values stay editable in the inspector — but nothing moves, because moving a
    // part would change the circuit the running result describes.
    if (simulationRunning) {
      setSelection({ kind: 'component', id: component.id, ids: [component.id] });
      setNotice('Идёт моделирование: остановите его, чтобы переставлять компоненты.');
      event.stopPropagation();
      return;
    }
    const point = toWorld(event);
    const selectedComponentIds =
      selection?.kind === 'component' && selection.ids.includes(component.id)
        ? selection.ids
        : [component.id];
    const componentIds = [
      ...new Set([
        ...selectedComponentIds,
        ...selectedComponentIds.flatMap((id) => {
          const selected = document?.components.find((item) => item.id === id);
          return selected?.kind === 'breadboard' && document
            ? componentsBoundToBreadboard(document, id)
            : [];
        }),
      ]),
    ];
    const startedPositions = Object.fromEntries(
      document?.components
        .filter((item) => componentIds.includes(item.id))
        .map((item) => [item.id, item.position]) ?? [],
    );
    componentDragRef.current = {
      componentId: component.id,
      componentIds,
      pointerId: event.pointerId,
      offset: { x: point.x - component.position.x, y: point.y - component.position.y },
      startedAt: component.position,
      startedPositions,
    };
    setDraggingComponents(true);
    stageRef.current?.setPointerCapture(event.pointerId);
    if (selection?.kind !== 'component' || !selection.ids.includes(component.id)) {
      setSelection({ kind: 'component', id: component.id, ids: [component.id] });
    }
    event.stopPropagation();
  }

  function wiperPositionFromPointer(component: SchematicComponent, point: Point): number | null {
    const entry = catalogEntry(component);
    if (!entry) return null;
    const center = componentPointPosition(
      component,
      component.position,
      {
        xMm: entry.physicalSizeMm.width / 2,
        yMm: entry.physicalSizeMm.height * 0.45,
      },
      component.rotation ?? 0,
    );
    if (!center) return null;
    let knobAngle = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90;
    while (knobAngle > 180) knobAngle -= 360;
    while (knobAngle < -180) knobAngle += 360;
    return clamp((clamp(knobAngle, -135, 135) + 135) / 270, 0, 1);
  }

  function updatePotentiometerFromPointer(componentId: string, point: Point): void {
    if (!document || !simulationRunning) return;
    const component = document.components.find((item) => item.id === componentId);
    if (!component || component.kind !== 'potentiometer') return;
    const position = wiperPositionFromPointer(component, point);
    if (position === null) return;
    const target = { kind: 'component' as const, id: componentId, ids: [componentId] };
    const next = updateWiperPosition(document, target, position);
    if (!next) return;
    setDocument(next);
  }

  function startPotentiometerControl(
    event: PointerEvent<SVGCircleElement>,
    component: SchematicComponent,
  ): void {
    if (event.button !== 0 || !simulationRunning) return;
    potentiometerDragRef.current = { componentId: component.id, pointerId: event.pointerId };
    stageRef.current?.setPointerCapture(event.pointerId);
    setSelection({ kind: 'component', id: component.id, ids: [component.id] });
    updatePotentiometerFromPointer(component.id, toWorld(event));
    event.stopPropagation();
    event.preventDefault();
  }

  function startPan(event: PointerEvent<SVGSVGElement>): void {
    const onEmptyCanvas = (event.target as Element).classList.contains('workbench-grid-hit');
    if (event.button === 0 && pendingTerminal && onEmptyCanvas) {
      const rawPoint = toWorld(event);
      setWireDraftVertices((current) => {
        if (current.length >= 48 || !pendingStart) return current;
        const anchor = current[current.length - 1] ?? pendingStart;
        const point =
          orthogonalWireMode || event.shiftKey ? lockOrthogonalPoint(anchor, rawPoint) : rawPoint;
        setWirePreviewEnd(point);
        return [...current, point];
      });
      setNotice(
        orthogonalWireMode || event.shiftKey
          ? 'Точка добавлена с фиксацией 90°. Продолжайте провод или выберите контакт.'
          : 'Точка изгиба добавлена. Shift или режим 90° фиксирует следующий участок.',
      );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const shouldPan =
      event.button === 1 ||
      (event.button === 0 && (spacePressedRef.current || (onEmptyCanvas && !event.shiftKey)));
    if (!shouldPan) {
      if (event.button === 0 && onEmptyCanvas && event.shiftKey) {
        const start = toWorld(event);
        const next = {
          pointerId: event.pointerId,
          start,
          current: start,
          additive: true,
        };
        setMarquee(next);
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    panDragRef.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
    };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (onEmptyCanvas && !event.shiftKey) setSelection(null);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>): void {
    const world = toWorld(event);
    const endpointDrag = endpointDragRef.current;
    if (endpointDrag?.pointerId === event.pointerId) {
      setWirePreviewEnd(world);
      return;
    }
    const potentiometerDrag = potentiometerDragRef.current;
    if (potentiometerDrag?.pointerId === event.pointerId) {
      updatePotentiometerFromPointer(potentiometerDrag.componentId, world);
      return;
    }
    if (catalogPlacement?.mode === 'keyboard') {
      const point = catalogPositionAtClient(
        catalogPlacement.componentTypeId,
        event.clientX,
        event.clientY,
      );
      setCatalogPlacementState({
        ...catalogPlacement,
        point,
        clientPoint: { x: event.clientX, y: event.clientY },
      });
      return;
    }
    const vertexDrag = vertexDragRef.current;
    if (vertexDrag?.pointerId === event.pointerId && document) {
      setDocument(
        moveWireVertex(
          document,
          vertexDrag.wireId,
          vertexDrag.vertexIndex,
          wireVertexDragPoint(vertexDrag.wireId, vertexDrag.vertexIndex, world, event.shiftKey),
        ),
      );
      return;
    }
    if (marquee?.pointerId === event.pointerId) {
      setMarquee({ ...marquee, current: world });
      return;
    }
    if (pendingTerminal && pendingStart) {
      const anchor = wireDraftVertices[wireDraftVertices.length - 1] ?? pendingStart;
      setWirePreviewEnd(
        orthogonalWireMode || event.shiftKey ? lockOrthogonalPoint(anchor, world) : world,
      );
    } else if (reconnectEndpoint) {
      setWirePreviewEnd(world);
    }
    const drag = componentDragRef.current;
    if (drag && drag.pointerId === event.pointerId && document) {
      const component = document.components.find((item) => item.id === drag.componentId);
      const entry = component ? catalogEntry(component) : null;
      if (!component || !entry) return;
      const size = renderedSize(entry, component.rotation ?? 0);
      const margin = 20;
      const next = {
        // Free placement. A component lands where it was dropped; the only thing
        // allowed to move it afterwards is the breadboard, which pulls its pins
        // into the holes below. A background grid that captured everything made
        // the canvas feel sticky and put parts where nobody put them.
        x: Math.round(clamp(world.x - drag.offset.x, -1000 + margin, 5000 - size.width - margin)),
        y: Math.round(clamp(world.y - drag.offset.y, -1000 + margin, 4000 - size.height - margin)),
      };
      const delta = { x: next.x - drag.startedAt.x, y: next.y - drag.startedAt.y };
      const positions = Object.fromEntries(
        drag.componentIds.map((id) => {
          const start = drag.startedPositions[id] ?? drag.startedAt;
          return [id, { x: start.x + delta.x, y: start.y + delta.y }];
        }),
      );
      const movedDocument =
        drag.componentIds.length === 1
          ? moveComponentInDocument(document, drag.componentId, next)
          : moveComponentsInDocument(document, positions);
      setDocument(
        drag.componentIds.length === 1 && component.kind !== 'breadboard'
          ? snapComponentToBreadboard(movedDocument, drag.componentId)
          : movedDocument,
      );
      return;
    }
    const pan = panDragRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const scaleX = STAGE_WIDTH / pan.startViewport.zoom / rect.width;
      const scaleY = STAGE_HEIGHT / pan.startViewport.zoom / rect.height;
      moveViewport({
        ...pan.startViewport,
        x: pan.startViewport.x - (event.clientX - pan.startClient.x) * scaleX,
        y: pan.startViewport.y - (event.clientY - pan.startClient.y) * scaleY,
      });
    }
  }

  function finishPointer(event: PointerEvent<SVGSVGElement>): void {
    const endpointDrag = endpointDragRef.current;
    if (endpointDrag?.pointerId === event.pointerId) {
      endpointDragRef.current = null;
      const target = globalThis.document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<SVGElement>('[data-terminal-component-id][data-terminal-id]');
      const componentId = target?.dataset['terminalComponentId'];
      const terminal = target?.dataset['terminalId'];
      if (document && componentId && terminal) {
        const next = reconnectWireEndpoint(document, endpointDrag.wireId, endpointDrag.endpoint, {
          componentId,
          terminal,
        });
        if (next) {
          commitDocument(next, 'Конец провода переподключён.');
          setReconnectEndpoint(null);
          setWirePreviewEnd(null);
        } else {
          setReconnectEndpoint(null);
          setWirePreviewEnd(null);
          setNotice('Этот контакт уже занят выбранным концом провода.');
        }
      } else {
        setReconnectEndpoint(null);
        setWirePreviewEnd(null);
        setNotice('Наведите конец провода на подсвеченный контакт и отпустите.');
      }
    }
    const potentiometerDrag = potentiometerDragRef.current;
    if (potentiometerDrag?.pointerId === event.pointerId) {
      potentiometerDragRef.current = null;
      if (document) {
        pushHistory(document);
        const component = document.components.find(
          (item) => item.id === potentiometerDrag.componentId,
        );
        setNotice(`Положение ручки: ${Math.round((component?.wiperPosition ?? 0.5) * 100)}%.`);
      }
    }
    const actuatorPress = actuatorPressRef.current;
    if (actuatorPress?.pointerId === event.pointerId) {
      actuatorPressRef.current = null;
      setComponentState(actuatorPress.componentId, false, 'Кнопка отпущена.');
    }
    const vertexDrag = vertexDragRef.current;
    if (vertexDrag?.pointerId === event.pointerId) {
      vertexDragRef.current = null;
      if (document) pushHistory(document);
      setNotice('Изгиб провода перемещён.');
    }
    if (marquee?.pointerId === event.pointerId && document) {
      const left = Math.min(marquee.start.x, marquee.current.x);
      const right = Math.max(marquee.start.x, marquee.current.x);
      const top = Math.min(marquee.start.y, marquee.current.y);
      const bottom = Math.max(marquee.start.y, marquee.current.y);
      const ids = document.components
        .filter((component) => {
          const entry = catalogEntry(component);
          if (!entry) return false;
          const size = renderedSize(entry, component.rotation ?? 0);
          return (
            component.position.x <= right &&
            component.position.x + size.width >= left &&
            component.position.y <= bottom &&
            component.position.y + size.height >= top
          );
        })
        .map((component) => component.id);
      const existing = marquee.additive && selection?.kind === 'component' ? selection.ids : [];
      const combined = [...new Set([...existing, ...ids])];
      setSelection(
        combined.length > 0
          ? { kind: 'component', id: combined[0] as string, ids: combined }
          : null,
      );
      setMarquee(null);
    }
    const drag = componentDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      setDraggingComponents(false);
      componentDragRef.current = null;
      setDraggingComponents(false);
      if (document) {
        const moved = document.components.find((item) => item.id === drag.componentId);
        const didMove = Boolean(
          moved && (moved.position.x !== drag.startedAt.x || moved.position.y !== drag.startedAt.y),
        );
        if (didMove) {
          const snapped = snapComponentToBreadboard(document, drag.componentId);
          setDocument(snapped);
          pushHistory(snapped);
          const snappedComponent = snapped.components.find((item) => item.id === drag.componentId);
          setNotice(
            Object.keys(snappedComponent?.holeBindings ?? {}).length > 0
              ? 'Выводы привязаны к отверстиям макетки.'
              : 'Положение сохранится автоматически.',
          );
        }
      }
    }
    if (panDragRef.current?.pointerId === event.pointerId) {
      panDragRef.current = null;
      setPanning(false);
      const settled = panViewportRef.current;
      panViewportRef.current = null;
      if (settled) {
        // React and the document both learn the resting place, once.
        setViewport(settled);
        commitViewport(settled);
      }
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* capture may already be released */
    }
  }

  function startVertexDrag(
    event: PointerEvent<SVGCircleElement>,
    wireId: string,
    vertexIndex: number,
  ): void {
    if (simulationRunning) return;
    vertexDragRef.current = { pointerId: event.pointerId, wireId, vertexIndex };
    setSelection({ kind: 'wire', id: wireId, vertexIndex });
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function removeWireVertexAt(wireId: string, vertexIndex: number): void {
    if (!document) return;
    const next = removeWireVertex(document, wireId, vertexIndex);
    commitDocument(next, 'Точка изгиба удалена.');
    setSelection({ kind: 'wire', id: wireId });
  }

  function startEndpointDrag(
    event: PointerEvent<SVGCircleElement>,
    wireId: string,
    endpoint: 'from' | 'to',
  ): void {
    if (simulationRunning) return;
    endpointDragRef.current = { pointerId: event.pointerId, wireId, endpoint };
    setSelection({ kind: 'wire', id: wireId });
    setReconnectEndpoint(endpoint);
    setWirePreviewEnd(toWorld(event));
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function addWireVertexAt(event: MouseEvent<SVGPathElement>, wireId: string): void {
    if (!document) return;
    const next = insertWireVertex(document, wireId, toWorld(event));
    if (next === document) return;
    commitDocument(next, 'Точка управления проводом добавлена.');
    setSelection({ kind: 'wire', id: wireId });
    event.stopPropagation();
    event.preventDefault();
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const zoom = clamp(viewport.zoom * (event.deltaY > 0 ? 0.88 : 1.14), MIN_ZOOM, MAX_ZOOM);
    if (zoom === viewport.zoom) return;

    // Keep whatever is under the pointer under the pointer. The old arithmetic
    // placed the view from a plain fraction of the element's width, which ignores
    // the xMidYMid slice cropping the canvas — so the scene drifted sideways on
    // every step, and kept drifting at the zoom limits where nothing should have
    // moved at all. Asking the same inverse transform the rest of the editor uses
    // removes the discrepancy instead of compensating for it.
    const before = toWorld(event);
    const after = clientToWorld(
      event.clientX,
      event.clientY,
      rect,
      { x: viewport.x, y: viewport.y, zoom },
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
    applyViewport({
      x: viewport.x + (before.x - after.x),
      y: viewport.y + (before.y - after.y),
      zoom,
    });
  }

  function zoomBy(factor: number): void {
    const center = visibleCenter();
    const zoom = clamp(viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    applyViewport({
      x: center.x - STAGE_WIDTH / zoom / 2,
      y: center.y - STAGE_HEIGHT / zoom / 2,
      zoom,
    });
  }

  function fitScene(): void {
    if (!document || document.components.length === 0) {
      applyViewport(DEFAULT_VIEWPORT);
      return;
    }
    const bounds = sceneBounds(document);
    applyViewport(bounds ? fitViewport(bounds, STAGE_WIDTH, STAGE_HEIGHT) : DEFAULT_VIEWPORT);
  }

  useEffect(() => {
    function keyDown(event: globalThis.KeyboardEvent): void {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement))
        spacePressedRef.current = true;
      const editable =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      if (editable) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (modifier && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelected();
      } else if (modifier && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteCopied();
      } else if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelection();
      } else if (event.key.toLowerCase() === 'r' && selection?.kind === 'component') {
        event.preventDefault();
        rotateSelected();
      } else if (event.key === 'Escape') {
        setCatalogPlacementState(null);
        setPendingTerminal(null);
        setWireDraftVertices([]);
        setWirePreviewEnd(null);
        setSelection(null);
        setReconnectEndpoint(null);
        setNotice(null);
      }
    }
    function keyUp(event: globalThis.KeyboardEvent): void {
      if (event.code === 'Space') spacePressedRef.current = false;
    }
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
    };
  });

  const filteredCatalog = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase('ru');
    return workbenchCatalog().filter(
      (family) =>
        familyMatchesCategory(family, category) &&
        (!query || familySearchText(family).includes(query)),
    );
  }, [category, libraryQuery]);

  useEffect(() => {
    setLibraryVariantPopover(null);
  }, [category, libraryQuery, libraryView]);

  const selectedComponent =
    selection?.kind === 'component'
      ? (document?.components.find((item) => item.id === selection.id) ?? null)
      : null;
  const selectedWire =
    selection?.kind === 'wire'
      ? (document?.connections.find((item) => item.id === selection.id) ?? null)
      : null;
  const selectedEntry = selectedComponent ? catalogEntry(selectedComponent) : null;
  const selectedFamily = selectedComponent
    ? familyForVariant(selectedComponent.variantId ?? selectedComponent.componentTypeId)
    : null;
  const catalogPlacementComponent = useMemo(() => {
    if (!document || !catalogPlacement?.point) return null;
    return addComponentToDocument(
      document,
      catalogPlacement.componentTypeId,
      catalogPlacement.point,
      'catalog-placement-preview',
    ).component;
  }, [catalogPlacement, document]);
  const resultByComponent = useMemo(() => {
    const map = new Map<string, ComponentResult>();
    for (const item of result?.components ?? []) map.set(item.componentId, item);
    return map;
  }, [result]);

  const terminalConnections = useMemo(() => {
    const connections = new Map<string, TerminalRef[]>();
    if (!document) return connections;

    const add = (endpoint: TerminalRef, peer: TerminalRef): void => {
      const key = terminalRefKey(endpoint.componentId, endpoint.terminal);
      connections.set(key, [...(connections.get(key) ?? []), peer]);
    };

    for (const wire of document.connections) {
      add(wire.from, wire.to);
      add(wire.to, wire.from);
    }
    for (const component of document.components) {
      for (const [terminal, binding] of Object.entries(component.holeBindings ?? {})) {
        const componentTerminal = { componentId: component.id, terminal };
        const breadboardTerminal = {
          componentId: binding.breadboardComponentId,
          terminal: binding.holeId,
        };
        add(componentTerminal, breadboardTerminal);
        add(breadboardTerminal, componentTerminal);
      }
    }
    return connections;
  }, [document]);

  function terminalConnectionCount(componentId: string, terminal: Terminal): number {
    return terminalConnections.get(terminalRefKey(componentId, terminal))?.length ?? 0;
  }

  function terminalConnectionLabel(componentId: string, terminal: Terminal): string {
    if (!document) return 'Свободен';
    const peers = terminalConnections.get(terminalRefKey(componentId, terminal)) ?? [];
    if (peers.length === 0) return 'Свободен';
    return peers
      .map((peer) => {
        const component = document.components.find((item) => item.id === peer.componentId);
        if (!component) return peer.terminal;
        const entry = catalogEntry(component);
        const componentLabel = component.name ?? entry?.label ?? component.id;
        const terminalLabel = entry?.terminals[peer.terminal]?.label ?? peer.terminal;
        return `${componentLabel}: ${terminalLabel}`;
      })
      .join(', ');
  }

  function componentLedBrightness(component: SchematicComponent): number {
    if (component.kind !== 'led' || !simulationRunning) return 0;
    return Math.round(clamp(resultByComponent.get(component.id)?.brightness ?? 0, 0, 100));
  }

  const diagnosticsByComponent = useMemo(() => {
    const map = new Map<string, Diagnostic[]>();
    for (const diagnostic of result?.diagnostics ?? []) {
      const explicitComponentIds = diagnostic.componentIds ?? [];
      // A numerical/topology diagnostic can describe the whole powered circuit
      // and therefore arrive without a component id. Circuits does not open a
      // global result window for that case: it anchors the visible warning to
      // the power source. Keep the calculation fail-closed, but put its message
      // where the learner can act on it.
      const componentIds =
        explicitComponentIds.length > 0
          ? explicitComponentIds
          : diagnostic.severity === 'info'
            ? []
            : (document?.components
                .filter((component) => component.kind === 'source')
                .map((component) => component.id) ?? []);
      for (const componentId of componentIds) {
        map.set(componentId, [...(map.get(componentId) ?? []), diagnostic]);
      }
    }
    return map;
  }, [document, result]);
  const diagnosticCodesByComponent = useMemo(
    () =>
      new Map(
        [...diagnosticsByComponent.entries()].map(([componentId, diagnostics]) => [
          componentId,
          new Set(diagnostics.map((diagnostic) => diagnostic.code)),
        ]),
      ),
    [diagnosticsByComponent],
  );
  const errorDiagnosticComponentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [componentId, diagnostics] of diagnosticsByComponent) {
      if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        ids.add(componentId);
      }
    }
    return ids;
  }, [diagnosticsByComponent]);

  function componentVisualState(component: SchematicComponent): ComponentVisualState {
    if (component.kind === 'switch') return component.state ? 'on' : 'default';
    if (component.kind === 'button') return component.state ? 'pressed' : 'default';
    if (component.kind === 'lamp' && simulationRunning) {
      return resultByComponent.get(component.id)?.lit ? 'lit' : 'off';
    }
    if (component.kind !== 'led' || !simulationRunning) return 'default';
    const codes = diagnosticCodesByComponent.get(component.id);
    if (codes?.has('reverse_polarity')) return 'reverse';
    if (codes?.has('led_burnout') || codes?.has('short_circuit')) return 'burned';
    if (codes?.has('led_overcurrent')) return 'overcurrent';
    return resultByComponent.get(component.id)?.lit ? 'lit' : 'off';
  }

  // While a pan is in flight the element carries a viewBox React did not write.
  // If anything else re-renders mid-drag, render the position the canvas is
  // actually at, or React would put it back where the drag started.
  const viewBox = viewportViewBox(panViewportRef.current ?? viewport, STAGE_WIDTH, STAGE_HEIGHT);
  const pendingStart =
    pendingTerminal && document
      ? (() => {
          const component = document.components.find(
            (item) => item.id === pendingTerminal.componentId,
          );
          return component
            ? terminalPositionInDocument(document, component, pendingTerminal.terminal)
            : null;
        })()
      : null;

  return {
    project,
    document,
    result,
    versions,
    status,
    saveStatus,
    saveCopy,
    saveError,
    notice,
    setNotice,
    selection,
    setSelection,
    pendingTerminal,
    wireDraftVertices,
    wirePreviewEnd,
    activeWireColor,
    orthogonalWireMode,
    simulationRunning,
    simulationStatus,
    libraryOpen,
    setLibraryOpen,
    libraryQuery,
    setLibraryQuery,
    category,
    setCategory,
    libraryView,
    setLibraryView,
    libraryVariant,
    setLibraryVariant,
    libraryVariantPopover,
    setLibraryVariantPopover,
    toggleLibraryVariantPopover,
    viewport,
    projectTitle,
    setProjectTitle,
    stageRef,
    canUndo,
    canRedo,
    undo,
    redo,
    duplicateSelected,
    copySelected,
    pasteCopied,
    hasClipboard: clipboardSelection?.kind === 'component',
    removeSelection,
    removeWireVertexAt,
    rotateSelected,
    mirrorSelected,
    updateSelectedValue,
    updateSelectedName,
    setSelectedState,
    toggleComponentState,
    setSelectedWiper,
    setSelectedProperties,
    setSelectedVariant,
    setWireColor,
    toggleWireRoute,
    removeWireBends,
    beginReconnect,
    reconnectEndpoint,
    clickTerminal,
    startComponentDrag,
    startPotentiometerControl,
    selectComponent,
    startVertexDrag,
    startEndpointDrag,
    addWireVertexAt,
    startPan,
    handlePointerMove,
    finishPointer,
    handleWheel,
    zoomBy,
    fitScene,
    placeCatalogComponent,
    saveNow,
    toggleSimulation,
    resetSimulation,
    checkpoint,
    renameProject,
    filteredCatalog,
    selectedComponent,
    selectedWire,
    selectedEntry,
    selectedFamily,
    resultByComponent,
    terminalConnectionCount,
    terminalConnectionLabel,
    diagnosticsByComponent,
    diagnosticCodesByComponent,
    errorDiagnosticComponentIds,
    componentVisualState,
    componentLedBrightness,
    viewBox,
    pendingStart,
    busy,
    panning,
    draggingComponents,
    marquee,
    catalogPlacement,
    catalogPlacementComponent,
    addComponent,
    addFamily,
    beginFamilyPlacement,
    moveFamilyPlacement,
    finishFamilyPlacement,
    cancelFamilyPlacement,
  };
}

export type ElectronicsWorkbenchController = ReturnType<typeof useElectronicsWorkbench>;
