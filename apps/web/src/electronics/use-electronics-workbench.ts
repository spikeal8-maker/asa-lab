import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import type { ComponentResult, ProductionStateValue, SchematicComponent, Terminal } from '../api';
import {
  catalogEntry,
  componentPointPosition,
  familyById,
  familyForVariant,
  familyMatchesCategory,
  familySearchText,
  renderedSize,
  selectedFamilyVariant,
  visualAsset,
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
  magneticWirePoint,
  potentiometerWiperPosition,
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
  moveWireSegment,
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
  updateSelectionProperties,
  updateSelectionValue,
  updateSelectionVariant,
} from './workbench-document';
import { diagnosticsGroupedByComponent } from './diagnostic-presentation';
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
  MAGNET_SCREEN_UNITS,
  type PanDrag,
  type PotentiometerDrag,
  type SegmentDrag,
  type Selection,
  type TerminalRef,
  type VertexDrag,
} from './workbench-model';
import {
  advanceLiveSimulation,
  calculateLiveSimulation,
  calculateSimulationPreflight,
} from './live-simulation';
import { warmProductionAsset } from './production-asset-contracts';
import { unlockPiezoAudio, usePiezoAudio } from './use-piezo-audio';
import {
  applyRuntimeComponentOverrides,
  type RuntimeComponentOverride,
  type RuntimeComponentOverrides,
} from './workbench-runtime-controls';

function terminalRefKey(componentId: string, terminal: Terminal): string {
  return `${componentId}:${terminal}`;
}

function compactWorkbench(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(max-width: 760px)').matches ?? window.innerWidth <= 760;
}

const ELECTRONICS_VIEWPORT_PREFIX = 'asa-electronics-viewport:';

function ordinaryLedVisualState(result: ComponentResult | undefined): ComponentVisualState {
  if (result?.junctionState === 'reverse_blocking') return 'reverse';
  if (result?.presentationState === 'failed') return 'burned';
  if (result?.presentationState === 'destructive') {
    return result.stressState === 'burned' ? 'burned' : 'overcurrent';
  }
  return result?.lit ? 'lit' : 'off';
}

export function readLocalElectronicsViewport(projectId: string): Viewport | null {
  try {
    const raw = window.localStorage.getItem(`${ELECTRONICS_VIEWPORT_PREFIX}${projectId}`);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<Viewport>;
    if (
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y) ||
      !Number.isFinite(candidate.zoom)
    ) {
      return null;
    }
    return {
      x: Number(candidate.x),
      y: Number(candidate.y),
      zoom: clamp(Number(candidate.zoom), MIN_ZOOM, MAX_ZOOM),
    };
  } catch {
    return null;
  }
}

function writeLocalElectronicsViewport(projectId: string, viewport: Viewport): void {
  try {
    window.localStorage.setItem(
      `${ELECTRONICS_VIEWPORT_PREFIX}${projectId}`,
      JSON.stringify(viewport),
    );
  } catch {
    // A blocked/full localStorage must not disable canvas navigation.
  }
}

export function useElectronicsWorkbench(projectId: string) {
  const projectState = useWorkbenchProjectState(projectId);
  const {
    project,
    document,
    serverRevision,
    setDocument,
    result: persistedResult,
    versions,
    status,
    saveStatus,
    saveError,
    saveIssue,
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

  const [runtimeOverrides, setRuntimeOverrides] = useState<RuntimeComponentOverrides>({});
  const runtimeDocument = useMemo(
    () => applyRuntimeComponentOverrides(document, simulationRunning, runtimeOverrides),
    [document, runtimeOverrides, simulationRunning],
  );

  useEffect(() => {
    if (!simulationRunning) setRuntimeOverrides({});
  }, [simulationRunning]);

  function setRuntimeComponentOverride(componentId: string, patch: RuntimeComponentOverride): void {
    setRuntimeOverrides((current) => {
      const previous = current[componentId];
      return {
        ...current,
        [componentId]: {
          ...previous,
          ...patch,
          ...(patch.stateProperties
            ? {
                stateProperties: {
                  ...previous?.stateProperties,
                  ...patch.stateProperties,
                },
              }
            : {}),
        },
      };
    });
  }

  const simulationStartedAtRef = useRef<number | null>(null);
  const [simulationTimeMs, setSimulationTimeMs] = useState(0);
  const [liveResult, setLiveResult] = useState<typeof persistedResult>(null);

  useEffect(() => {
    if (!simulationRunning) {
      simulationStartedAtRef.current = null;
      setSimulationTimeMs(0);
      setLiveResult(null);
      return;
    }

    simulationStartedAtRef.current = window.performance.now();
    setSimulationTimeMs(0);
    const interval = window.setInterval(() => {
      const startedAt = simulationStartedAtRef.current;
      if (startedAt !== null) {
        setSimulationTimeMs(window.performance.now() - startedAt);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [simulationRunning]);

  useEffect(() => {
    if (!runtimeDocument || !simulationRunning) return;
    setLiveResult((previous) =>
      advanceLiveSimulation(runtimeDocument, previous ?? persistedResult, simulationTimeMs),
    );
  }, [persistedResult, runtimeDocument, simulationRunning, simulationTimeMs]);

  const result = useMemo(
    () =>
      simulationRunning
        ? (liveResult ??
          calculateLiveSimulation(runtimeDocument, persistedResult, true, simulationTimeMs))
        : calculateLiveSimulation(runtimeDocument, persistedResult, false, simulationTimeMs),
    [liveResult, persistedResult, runtimeDocument, simulationRunning, simulationTimeMs],
  );
  usePiezoAudio(runtimeDocument, result, simulationRunning);

  useEffect(() => {
    if (!document || simulationRunning || status !== 'ready') return;
    const timer = window.setTimeout(() => {
      const runningDocument = {
        ...document,
        simulation: { ...document.simulation, running: true },
      };
      const preview = calculateSimulationPreflight(runningDocument);
      const previewByComponent = new Map(
        preview.components.map((componentResult) => [componentResult.componentId, componentResult]),
      );
      for (const component of document.components) {
        if (component.kind !== 'led') continue;
        const entry = catalogEntry(component);
        const componentResult = previewByComponent.get(component.id);
        if (!entry || !componentResult) continue;
        const state = ordinaryLedVisualState(componentResult);
        const visualComponent = {
          ...component,
          stateProperties: {
            ...component.stateProperties,
            ledBrightness: Math.round(clamp(componentResult.brightness ?? 0, 0, 100)),
          },
        };
        warmProductionAsset(visualAsset(entry, visualComponent, state));
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [document, simulationRunning, status]);

  async function toggleSimulationWithAudio(): Promise<void> {
    if (!simulationRunning) {
      setRuntimeOverrides({});
      try {
        await unlockPiezoAudio();
      } catch {
        // Audio permission or hardware availability must never prevent the
        // electrical simulation from starting. The visual/frequency evidence
        // remains valid and a later user gesture may unlock the speakers.
      }
    }
    await toggleSimulation();
  }

  const [selection, setSelection] = useState<Selection>(null);
  const [clipboardSelection, setClipboardSelection] = useState<Selection>(null);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalRef | null>(null);
  const [wireDraftVertices, setWireDraftVertices] = useState<readonly Point[]>([]);
  const [wirePreviewEnd, setWirePreviewEnd] = useState<Point | null>(null);
  const [activeWireColor, setActiveWireColor] = useState('#149447');
  const [orthogonalWireMode, setOrthogonalWireMode] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(() => !compactWorkbench());
  const [libraryQuery, setLibraryQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory>('basic');
  const [libraryView, setLibraryView] = useState<'grid' | 'list'>('grid');
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
  // While an endpoint drag holds pointer capture on the stage, CSS :hover no
  // longer follows the pointer — the terminal under it never lights up. The
  // hover target is therefore tracked explicitly and applied as a class.
  const [reconnectHover, setReconnectHover] = useState<{
    componentId: string;
    terminal: Terminal;
  } | null>(null);

  const stageRef = useRef<SVGSVGElement>(null);
  const catalogPlacementRef = useRef<CatalogPlacement | null>(null);
  const componentDragRef = useRef<ComponentDrag | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  // Where the view actually is while a pan is in flight, since React state is
  // deliberately not being updated for each frame of it.
  const panViewportRef = useRef<Viewport | null>(null);
  const vertexDragRef = useRef<VertexDrag | null>(null);
  const segmentDragRef = useRef<SegmentDrag | null>(null);
  const lastSegmentPressRef = useRef<{
    wireId: string;
    x: number;
    y: number;
    at: number;
  } | null>(null);
  const lastVertexPressRef = useRef<{
    wireId: string;
    vertexIndex: number;
    x: number;
    y: number;
    at: number;
  } | null>(null);
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
    writeLocalElectronicsViewport(projectId, next);
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
    writeLocalElectronicsViewport(projectId, next);
  }

  useEffect(() => {
    if (project && document && viewportProjectRef.current !== project.id) {
      viewportProjectRef.current = project.id;
      const stored =
        readLocalElectronicsViewport(project.id) ?? document.viewport ?? DEFAULT_VIEWPORT;
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

  function addFamily(familyId: string, at?: Point): void {
    const family = familyById(familyId);
    if (!family?.enabled) return;
    addComponent(selectedFamilyVariant(family, null).componentTypeId, at);
  }

  function beginFamilyPlacement(
    familyId: string,
    pointer?: { readonly pointerId: number; readonly clientX: number; readonly clientY: number },
  ): void {
    const family = familyById(familyId);
    if (!family?.enabled) return;
    const variant = selectedFamilyVariant(family, null);
    const next: CatalogPlacement = {
      componentTypeId: variant.componentTypeId,
      point: pointer
        ? catalogPositionAtClient(variant.componentTypeId, pointer.clientX, pointer.clientY)
        : null,
      clientPoint: pointer ? { x: pointer.clientX, y: pointer.clientY } : null,
      startClientPoint: pointer ? { x: pointer.clientX, y: pointer.clientY } : null,
      pointerId: pointer?.pointerId ?? null,
      mode: pointer ? 'pointer' : 'keyboard',
    };
    setCatalogPlacementState(next);
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
    const travel = current.startClientPoint
      ? Math.hypot(clientX - current.startClientPoint.x, clientY - current.startClientPoint.y)
      : Number.POSITIVE_INFINITY;
    if (!point) {
      // A phone tap cannot drag a part through the bottom sheet and onto a tiny
      // canvas reliably. A short tap therefore picks the part up, closes the
      // sheet and lets the learner tap the exact landing place next.
      if (compactWorkbench() && travel <= 12) {
        setCatalogPlacementState({
          ...current,
          point: null,
          clientPoint: null,
          startClientPoint: null,
          pointerId: null,
          mode: 'keyboard',
        });
        setLibraryOpen(false);
        setNotice('Компонент выбран. Коснитесь места на рабочем поле, куда его поставить.');
        return;
      }
      setCatalogPlacementState(null);
      setNotice('Размещение отменено: отпустите компонент над рабочим полем.');
      return;
    }
    setCatalogPlacementState(null);
    addComponent(current.componentTypeId, point);
    if (compactWorkbench()) setLibraryOpen(false);
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
    if (next) commitDocument(next, 'Элемент повернут на 45° вокруг центра — провода обновлены.');
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

  function updateSelectedResistanceValue(valueOhms: number, unit: string): void {
    if (!document || !Number.isFinite(valueOhms) || valueOhms < 0) return;
    const withValue = updateSelectionValue(document, selection, valueOhms);
    if (!withValue) return;
    const withUnit = updateSelectionProperties(withValue, selection, { resistanceUnit: unit });
    commitDocument(withUnit ?? withValue);
  }

  function updateSelectedName(name: string): void {
    if (!document) return;
    const next = updateSelectionName(document, selection, name);
    if (next) commitDocument(next);
  }

  function setSelectedState(state: boolean): void {
    if (!runtimeDocument) return;
    if (!simulationRunning) {
      setNotice('Запустите моделирование, чтобы управлять кнопкой или переключателем.');
      return;
    }
    if (selection?.kind !== 'component') return;
    const component = runtimeDocument.components.find((item) => item.id === selection.id);
    if (!component || (component.kind !== 'switch' && component.kind !== 'button')) return;
    setRuntimeComponentOverride(component.id, { state });
  }

  function setComponentState(componentId: string, state: boolean, message?: string): void {
    if (!runtimeDocument || !simulationRunning) return;
    const component = runtimeDocument.components.find((item) => item.id === componentId);
    if (!component || (component.kind !== 'switch' && component.kind !== 'button')) return;
    const target = { kind: 'component' as const, id: componentId, ids: [componentId] };
    setSelection(target);
    setRuntimeComponentOverride(componentId, { state });
    void message;
  }

  function toggleComponentState(componentId: string): void {
    if (!document || !simulationRunning) {
      setNotice('Запустите моделирование, чтобы управлять компонентом.');
      return;
    }
    const component = runtimeDocument?.components.find((item) => item.id === componentId);
    if (!component || (component.kind !== 'switch' && component.kind !== 'button')) return;
    setComponentState(
      componentId,
      !component.state,
      component.state ? 'Контакт разомкнут.' : 'Контакт замкнут.',
    );
  }

  function setSelectedWiper(position: number): void {
    if (!runtimeDocument) return;
    if (!simulationRunning) {
      setNotice('Положение ручки изменяется во время моделирования.');
      return;
    }
    if (selection?.kind !== 'component' || !Number.isFinite(position)) return;
    const component = runtimeDocument.components.find((item) => item.id === selection.id);
    if (!component || component.kind !== 'potentiometer') return;
    setRuntimeComponentOverride(component.id, { wiperPosition: clamp(position, 0, 1) });
  }

  function setSelectedMotorShaftLocked(shaftLocked: boolean): void {
    if (!runtimeDocument) return;
    if (!simulationRunning) {
      setNotice('Блокировка вала доступна во время моделирования.');
      return;
    }
    if (selection?.kind !== 'component') return;
    const component = runtimeDocument.components.find((item) => item.id === selection.id);
    if (
      !component ||
      (component.componentTypeId !== 'dc-motor' && component.componentTypeId !== 'gearmotor')
    )
      return;
    setRuntimeComponentOverride(component.id, { stateProperties: { shaftLocked } });
  }

  function setSelectedProperties(
    properties: Readonly<Record<string, string | number | boolean | readonly string[]>>,
    message?: string,
  ): void {
    if (!document) return;
    if (
      simulationRunning &&
      selection?.kind === 'component' &&
      (() => {
        const component = runtimeDocument?.components.find((item) => item.id === selection.id);
        return (
          (component?.kind === 'photoresistor' &&
            Object.keys(properties).every((key) => key === 'illumination')) ||
          (component?.componentTypeId === 'multimeter' &&
            Object.keys(properties).every(
              (key) => key === 'measurementMode' || key === 'meterRange',
            ))
        );
      })()
    ) {
      setRuntimeComponentOverride(selection.id, { stateProperties: properties });
      return;
    }
    const next = updateSelectionProperties(document, selection, properties);
    if (next) commitDocument(next, message);
  }

  function updateArduinoProgram(
    componentId: string,
    properties: Readonly<Record<string, ProductionStateValue>>,
  ): void {
    if (!document) return;
    const component = document.components.find((item) => item.id === componentId);
    if (
      !component ||
      (component.componentTypeId !== 'arduino-uno' && component.variantId !== 'arduino-uno')
    ) {
      return;
    }
    commitDocument({
      ...document,
      components: document.components.map((item) =>
        item.id === componentId
          ? { ...item, stateProperties: { ...item.stateProperties, ...properties } }
          : item,
      ),
    });
  }

  function resetArduinoRuntime(componentId: string): void {
    const component = document?.components.find((item) => item.id === componentId);
    if (
      !component ||
      (component.componentTypeId !== 'arduino-uno' && component.variantId !== 'arduino-uno')
    ) {
      return;
    }
    if (!simulationRunning) {
      setNotice('Запустите моделирование, чтобы перезапустить Arduino.');
      return;
    }
    simulationStartedAtRef.current = window.performance.now();
    setSimulationTimeMs(0);
    setNotice('Arduino перезапущена: setup() и loop() выполняются сначала.');
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
    setReconnectHover(null);
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
      setReconnectHover(null);
      setWirePreviewEnd(null);
      return;
    }
    if (!pendingTerminal) {
      // Starting a new wire is a new interaction. A previously selected wire
      // must stop showing its outline, endpoints and bend handles immediately;
      // otherwise the old controls remain visible underneath the live draft and
      // the editor appears to be editing two wires at once.
      setSelection(null);
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

  function wireDraftPoint(anchor: Point, point: Point, forceOrthogonal: boolean): Point {
    const freePoint = freeWirePoint(point);
    return forceOrthogonal
      ? lockOrthogonalPoint(anchor, freePoint)
      : magneticWirePoint(anchor, freePoint, MAGNET_SCREEN_UNITS / viewport.zoom);
  }

  function startComponentDrag(
    event: PointerEvent<SVGElement>,
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
    return potentiometerWiperPosition(center, point, component.rotation ?? 0);
  }

  function updatePotentiometerFromPointer(componentId: string, point: Point): void {
    if (!runtimeDocument || !simulationRunning) return;
    const component = runtimeDocument.components.find((item) => item.id === componentId);
    if (!component || component.kind !== 'potentiometer') return;
    const position = wiperPositionFromPointer(component, point);
    if (position === null) return;
    setRuntimeComponentOverride(componentId, { wiperPosition: position });
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
    const target = event.target as Element;
    const onEmptyCanvas = target.classList.contains('workbench-grid-hit');
    const onExistingWire =
      target.classList.contains('workbench-wire-hit') ||
      target.classList.contains('workbench-wire-segment-hit');
    if (event.button === 0 && pendingTerminal && (onEmptyCanvas || onExistingWire)) {
      const rawPoint = toWorld(event);
      setWireDraftVertices((current) => {
        if (current.length >= 48 || !pendingStart) return current;
        const anchor = current[current.length - 1] ?? pendingStart;
        const point = wireDraftPoint(anchor, rawPoint, orthogonalWireMode || event.shiftKey);
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

  // The dragged wire endpoint rides under the pointer, so a plain
  // elementFromPoint finds the endpoint itself instead of the terminal below.
  // Walk the whole stack under the pointer and take the first real terminal.
  function terminalTargetAt(
    clientX: number,
    clientY: number,
  ): { componentId: string; terminal: Terminal } | null {
    for (const element of globalThis.document.elementsFromPoint(clientX, clientY)) {
      const target = element.closest<SVGElement>('[data-terminal-component-id][data-terminal-id]');
      const componentId = target?.dataset['terminalComponentId'];
      const terminal = target?.dataset['terminalId'];
      if (componentId && terminal) return { componentId, terminal: terminal as Terminal };
    }
    return null;
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>): void {
    const world = toWorld(event);
    const endpointDrag = endpointDragRef.current;
    if (endpointDrag?.pointerId === event.pointerId) {
      setWirePreviewEnd(world);
      setReconnectHover(terminalTargetAt(event.clientX, event.clientY));
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
    const segmentDrag = segmentDragRef.current;
    if (segmentDrag?.pointerId === event.pointerId) {
      const pointerDelta = {
        x: world.x - segmentDrag.startPointer.x,
        y: world.y - segmentDrag.startPointer.y,
      };
      if (Math.hypot(pointerDelta.x, pointerDelta.y) >= 0.5) segmentDrag.moved = true;
      setDocument(
        moveWireSegment(
          segmentDrag.startedDocument,
          segmentDrag.wireId,
          segmentDrag.segmentIndex,
          pointerDelta,
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
      setWirePreviewEnd(wireDraftPoint(anchor, world, orthogonalWireMode || event.shiftKey));
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
      setReconnectHover(null);
      const target = terminalTargetAt(event.clientX, event.clientY);
      const componentId = target?.componentId;
      const terminal = target?.terminal;
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
    const segmentDrag = segmentDragRef.current;
    if (segmentDrag?.pointerId === event.pointerId) {
      segmentDragRef.current = null;
      if (segmentDrag.moved && document) {
        pushHistory(document);
        setNotice('Отрезок провода перемещён параллельно.');
      }
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
    const previous = lastVertexPressRef.current;
    const repeated =
      previous?.wireId === wireId &&
      previous.vertexIndex === vertexIndex &&
      Date.now() - previous.at <= 420 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8;
    if (event.detail >= 2 || repeated) {
      lastVertexPressRef.current = null;
      vertexDragRef.current = null;
      removeWireVertexAt(wireId, vertexIndex);
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    lastVertexPressRef.current = {
      wireId,
      vertexIndex,
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
    };
    vertexDragRef.current = { pointerId: event.pointerId, wireId, vertexIndex };
    setSelection({ kind: 'wire', id: wireId, vertexIndex });
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function startSegmentDrag(
    event: PointerEvent<SVGPathElement>,
    wireId: string,
    segmentIndex: number,
  ): void {
    if (simulationRunning || pendingTerminal || !document) return;
    const previous = lastSegmentPressRef.current;
    const repeated =
      previous?.wireId === wireId &&
      Date.now() - previous.at <= 420 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8;
    if (event.detail >= 2 || repeated) {
      lastSegmentPressRef.current = null;
      segmentDragRef.current = null;
      const next = insertWireVertex(document, wireId, toWorld(event));
      if (next !== document) commitDocument(next, 'Точка управления проводом добавлена.');
      setSelection({ kind: 'wire', id: wireId });
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    lastSegmentPressRef.current = {
      wireId,
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
    };
    segmentDragRef.current = {
      pointerId: event.pointerId,
      wireId,
      segmentIndex,
      startPointer: toWorld(event),
      startedDocument: document,
      moved: false,
    };
    setSelection({ kind: 'wire', id: wireId, segmentIndex });
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
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
    setReconnectHover(null);
    setWirePreviewEnd(toWorld(event));
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  function addWireVertexAt(
    event: MouseEvent<SVGPathElement> | PointerEvent<SVGPathElement>,
    wireId: string,
  ): void {
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

  const selectedComponent =
    selection?.kind === 'component'
      ? (runtimeDocument?.components.find((item) => item.id === selection.id) ?? null)
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
    return diagnosticsGroupedByComponent(result?.diagnostics ?? []);
  }, [result]);
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
    if ((component.kind !== 'led' && component.kind !== 'rgb-led') || !simulationRunning)
      return 'default';
    const componentResult = resultByComponent.get(component.id);
    const calculatedState = componentResult?.presentationState;
    if (component.kind === 'rgb-led') {
      if (calculatedState === 'failed') return 'burned';
      if (calculatedState === 'destructive') {
        return resultByComponent.get(component.id)?.stressState === 'burned'
          ? 'burned'
          : 'overcurrent';
      }
      return resultByComponent.get(component.id)?.lit ? 'lit' : 'off';
    }
    return ordinaryLedVisualState(componentResult);
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
    document: runtimeDocument,
    serverRevision,
    result,
    versions,
    status,
    saveStatus,
    saveError,
    saveIssue,
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
    simulationTimeMs,
    simulationStatus,
    libraryOpen,
    setLibraryOpen,
    libraryQuery,
    setLibraryQuery,
    category,
    setCategory,
    libraryView,
    setLibraryView,
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
    updateSelectedResistanceValue,
    updateSelectedName,
    setSelectedState,
    toggleComponentState,
    setSelectedWiper,
    setSelectedMotorShaftLocked,
    setSelectedProperties,
    updateArduinoProgram,
    resetArduinoRuntime,
    setSelectedVariant,
    setWireColor,
    toggleWireRoute,
    removeWireBends,
    beginReconnect,
    reconnectEndpoint,
    reconnectHover,
    clickTerminal,
    startComponentDrag,
    startPotentiometerControl,
    selectComponent,
    startVertexDrag,
    startSegmentDrag,
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
    toggleSimulation: toggleSimulationWithAudio,
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
