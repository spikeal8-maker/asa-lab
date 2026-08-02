import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { type ComponentResult, type SchematicComponent, type Terminal } from '../api';
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
  fitViewport,
  snap,
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
  moveComponentInDocument,
  moveComponentsInDocument,
  moveWireVertex,
  mirrorSelectionInDocument,
  reconnectWireEndpoint,
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
  DRAG_MIME,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type ActuatorPress,
  type CatalogPlacement,
  type ComponentDrag,
  type MarqueeDrag,
  type PanDrag,
  type PotentiometerDrag,
  type Selection,
  type TerminalRef,
  type VertexDrag,
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
    resetSimulation,
    checkpoint,
    renameProject,
  } = projectState;

  const [selection, setSelection] = useState<Selection>(null);
  const [clipboardSelection, setClipboardSelection] = useState<Selection>(null);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalRef | null>(null);
  const [wirePreviewEnd, setWirePreviewEnd] = useState<Point | null>(null);
  const [activeWireColor, setActiveWireColor] = useState('#149447');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory>('basic');
  const [libraryView, setLibraryView] = useState<'grid' | 'list'>('grid');
  const [libraryVariants, setLibraryVariants] = useState<Readonly<Record<string, string>>>({});
  const [libraryVariantPopover, setLibraryVariantPopover] = useState<string | null>(null);
  const [catalogPlacement, setCatalogPlacement] = useState<CatalogPlacement | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeDrag | null>(null);
  const [reconnectEndpoint, setReconnectEndpoint] = useState<'from' | 'to' | null>(null);

  const stageRef = useRef<SVGSVGElement>(null);
  const componentDragRef = useRef<ComponentDrag | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  const vertexDragRef = useRef<VertexDrag | null>(null);
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

  function applyViewport(next: Viewport): void {
    setViewport(next);
    if (document) {
      setDocument({ ...document, viewport: next });
      setSaveStatus('dirty');
    }
  }

  useEffect(() => {
    if (project && document && viewportProjectRef.current !== project.id) {
      viewportProjectRef.current = project.id;
      setViewport(document.viewport ?? DEFAULT_VIEWPORT);
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
    commitDocument(
      added.document,
      `${entry?.label ?? 'Компонент'} добавлен. Соедините выводы проводами.`,
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

  function beginFamilyPlacement(familyId: string): void {
    const family = familyById(familyId);
    if (!family?.enabled) return;
    const variant = selectedFamilyVariant(family, libraryVariants[familyId]);
    setCatalogPlacement({ componentTypeId: variant.componentTypeId, point: null });
    setLibraryVariantPopover(null);
    setSelection(null);
    setPendingTerminal(null);
    setWirePreviewEnd(null);
    setNotice(`${family.familyLabel} прикреплён к указателю. Щёлкните на рабочем поле.`);
  }

  function placeCatalogComponent(event: PointerEvent<SVGSVGElement>): void {
    if (!catalogPlacement || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const { componentTypeId } = catalogPlacement;
    setCatalogPlacement(null);
    addComponent(componentTypeId, toWorld(event));
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
    if (!document) return;
    const next = toggleSelectedWireRoute(document, selection);
    if (next) commitDocument(next);
  }

  function removeWireBends(): void {
    if (!document) return;
    const next = removeSelectedWireBends(document, selection);
    if (next) commitDocument(next, 'Изгибы провода удалены.');
  }

  function beginReconnect(endpoint: 'from' | 'to'): void {
    if (selection?.kind !== 'wire') return;
    setReconnectEndpoint(endpoint);
    setNotice('Выберите новый вывод для переподключения провода.');
  }

  function clickTerminal(componentId: string, terminal: Terminal): void {
    if (!document) return;
    if (reconnectEndpoint && selection?.kind === 'wire') {
      const next = reconnectWireEndpoint(document, selection.id, reconnectEndpoint, {
        componentId,
        terminal,
      });
      if (next) commitDocument(next, 'Конец провода переподключён.');
      setReconnectEndpoint(null);
      return;
    }
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
    const connected = connectTerminals(
      document,
      pendingTerminal,
      { componentId, terminal },
      nextId('wire'),
      activeWireColor,
    );
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

  function toWorld(event: PointerEvent | DragEvent | WheelEvent): Point {
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

  function startComponentDrag(
    event: PointerEvent<SVGGElement>,
    component: SchematicComponent,
  ): void {
    if (event.button !== 0 || pendingTerminal) return;
    if (event.shiftKey) {
      event.stopPropagation();
      return;
    }
    if (simulationRunning && (component.kind === 'button' || component.kind === 'switch')) {
      actuatorPressRef.current = {
        componentId: component.id,
        pointerId: event.pointerId,
        kind: component.kind,
      };
      stageRef.current?.setPointerCapture(event.pointerId);
      setSelection({ kind: 'component', id: component.id, ids: [component.id] });
      if (component.kind === 'button') {
        setComponentState(component.id, true, 'Кнопка нажата.');
      }
      event.stopPropagation();
      event.preventDefault();
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
    setSaveStatus('dirty');
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
    const potentiometerDrag = potentiometerDragRef.current;
    if (potentiometerDrag?.pointerId === event.pointerId) {
      updatePotentiometerFromPointer(potentiometerDrag.componentId, world);
      return;
    }
    if (catalogPlacement) {
      setCatalogPlacement((current) => (current ? { ...current, point: world } : current));
      return;
    }
    const vertexDrag = vertexDragRef.current;
    if (vertexDrag?.pointerId === event.pointerId && document) {
      setDocument(moveWireVertex(document, vertexDrag.wireId, vertexDrag.vertexIndex, world));
      setSaveStatus('dirty');
      return;
    }
    if (marquee?.pointerId === event.pointerId) {
      setMarquee({ ...marquee, current: world });
      return;
    }
    if (pendingTerminal) setWirePreviewEnd(world);
    const drag = componentDragRef.current;
    if (drag && drag.pointerId === event.pointerId && document) {
      const component = document.components.find((item) => item.id === drag.componentId);
      const entry = component ? catalogEntry(component) : null;
      if (!component || !entry) return;
      const size = renderedSize(entry, component.rotation ?? 0);
      const margin = 20;
      const next = {
        x: snap(clamp(world.x - drag.offset.x, -1000 + margin, 5000 - size.width - margin)),
        y: snap(clamp(world.y - drag.offset.y, -1000 + margin, 4000 - size.height - margin)),
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
      setSaveStatus('dirty');
      return;
    }
    const pan = panDragRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const scaleX = STAGE_WIDTH / pan.startViewport.zoom / rect.width;
      const scaleY = STAGE_HEIGHT / pan.startViewport.zoom / rect.height;
      applyViewport({
        ...pan.startViewport,
        x: pan.startViewport.x - (event.clientX - pan.startClient.x) * scaleX,
        y: pan.startViewport.y - (event.clientY - pan.startClient.y) * scaleY,
      });
    }
  }

  function finishPointer(event: PointerEvent<SVGSVGElement>): void {
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
      if (actuatorPress.kind === 'button') {
        setComponentState(actuatorPress.componentId, false, 'Кнопка отпущена.');
      } else {
        toggleComponentState(actuatorPress.componentId);
      }
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
      componentDragRef.current = null;
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
    vertexDragRef.current = { pointerId: event.pointerId, wireId, vertexIndex };
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
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
    applyViewport({ x: before.x - rx * visibleWidth, y: before.y - ry * visibleHeight, zoom });
  }

  function zoomBy(factor: number): void {
    const center = visibleCenter();
    const zoom = clamp(viewport.zoom * factor, 0.35, 3.2);
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

  function handleDrop(event: DragEvent<SVGSVGElement>): void {
    event.preventDefault();
    const componentTypeId = event.dataTransfer.getData(DRAG_MIME);
    const family = familyForVariant(componentTypeId);
    if (
      !catalogEntry(componentTypeId) ||
      !family?.enabled ||
      !family.variants.some((variant) => variant.variantId === componentTypeId && variant.enabled)
    )
      return;
    addComponent(componentTypeId, toWorld(event));
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
        setCatalogPlacement(null);
        setPendingTerminal(null);
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

  function componentLedBrightness(component: SchematicComponent): number {
    if (component.kind !== 'led' || !simulationRunning) return 0;
    const current = Math.abs(resultByComponent.get(component.id)?.current ?? 0);
    return Math.round(clamp((current / 0.02) * 100, 0, 100));
  }

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
  const errorDiagnosticComponentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const diagnostic of result?.diagnostics ?? []) {
      if (diagnostic.severity !== 'error') continue;
      for (const componentId of diagnostic.componentIds ?? []) ids.add(componentId);
    }
    return ids;
  }, [result]);

  function componentVisualState(component: SchematicComponent): ComponentVisualState {
    if (component.kind === 'switch') return component.state ? 'on' : 'default';
    if (component.kind === 'button') return component.state ? 'pressed' : 'default';
    if (component.kind === 'lamp' && simulationRunning) {
      return resultByComponent.get(component.id)?.lit ? 'lit' : 'off';
    }
    if (component.kind !== 'led' || !simulationRunning) return 'default';
    const codes = diagnosticCodesByComponent.get(component.id);
    if (codes?.has('reverse_polarity')) return 'reverse';
    if (codes?.has('short_circuit')) return 'burned';
    if (codes?.has('led_overcurrent')) return 'overcurrent';
    return resultByComponent.get(component.id)?.lit ? 'lit' : 'off';
  }

  const viewBox = viewportViewBox(viewport, STAGE_WIDTH, STAGE_HEIGHT);
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
    notice,
    setNotice,
    selection,
    setSelection,
    pendingTerminal,
    wirePreviewEnd,
    activeWireColor,
    simulationRunning,
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
    startPan,
    handlePointerMove,
    finishPointer,
    handleWheel,
    zoomBy,
    fitScene,
    handleDrop,
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
    diagnosticCodesByComponent,
    errorDiagnosticComponentIds,
    componentVisualState,
    componentLedBrightness,
    viewBox,
    pendingStart,
    busy,
    panning,
    marquee,
    catalogPlacement,
    catalogPlacementComponent,
    addComponent,
    addFamily,
    beginFamilyPlacement,
  };
}

export type ElectronicsWorkbenchController = ReturnType<typeof useElectronicsWorkbench>;
