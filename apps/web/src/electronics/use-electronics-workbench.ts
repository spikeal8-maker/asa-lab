import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import type { ElectronicsArduinoSerialProjection } from '@asa-lab/electronics/engine';
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
  fitViewportToScreen,
  gestureViewport,
  freeWirePoint,
  lockOrthogonalBend,
  lockOrthogonalPoint,
  potentiometerWiperPosition,
  resolveWireAssist,
  resolveWireVertexAssist,
  viewportViewBox,
  worldToClient,
  type Point,
  type Viewport,
  type WireAssistAxis,
  type WireVertexAssistTarget,
} from './workbench-geometry';
import { useWorkbenchProjectState } from './use-workbench-project-state';
import {
  addComponentToDocument,
  componentsBoundToBreadboard,
  connectTerminals,
  duplicateComponentInDocument,
  insertWireVertex,
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
  type PanDrag,
  type PotentiometerDrag,
  type SegmentDrag,
  nextComponentSelection,
  type Selection,
  type TerminalRef,
  type VertexDrag,
} from './workbench-model';
import { calculateLiveSimulation, calculateSimulationPreflight } from './live-simulation';
import { ElectronicsLiveSimulationWorkerController } from './live-simulation-worker-controller';
import { warmProductionAsset } from './production-asset-contracts';
import { unlockPiezoAudio, usePiezoAudio } from './use-piezo-audio';
import {
  applyRuntimeComponentOverrides,
  type RuntimeComponentOverride,
  type RuntimeComponentOverrides,
} from './workbench-runtime-controls';
import {
  createComponentDragPreview,
  createWireDragPreview,
  createVisualFrame,
  translatedDragDocument,
} from './workbench-drag-preview';
import {
  isEditableShortcutTarget,
  resolveWorkbenchShortcut,
  targetConsumesSpace,
} from './workbench-shortcuts';

function terminalRefKey(componentId: string, terminal: Terminal): string {
  return `${componentId}:${terminal}`;
}

function compactWorkbench(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(max-width: 980px)').matches ?? window.innerWidth <= 980;
}

const ELECTRONICS_VIEWPORT_PREFIX = 'asa-electronics-viewport:';
const WIRE_DRAG_THRESHOLD_PX = 5;
const DESKTOP_INITIAL_ZOOM = 1.25;
const KEYBOARD_NUDGE_STEP = 5;
const KEYBOARD_NUDGE_LARGE_STEP = 20;

function emptyInitialViewport(): Viewport {
  if (compactWorkbench()) return DEFAULT_VIEWPORT;
  const width = STAGE_WIDTH / DESKTOP_INITIAL_ZOOM;
  const height = STAGE_HEIGHT / DESKTOP_INITIAL_ZOOM;
  return {
    x: (STAGE_WIDTH - width) / 2,
    y: (STAGE_HEIGHT - height) / 2,
    zoom: DESKTOP_INITIAL_ZOOM,
  };
}

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
    getCurrentDocument,
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
    confirmSimulationStarted,
    busy,
    projectTitle,
    setProjectTitle,
    canUndo,
    canRedo,
    undo: projectUndo,
    redo: projectRedo,
    commitDocument: projectCommitDocument,
    saveNow,
    toggleSimulation,
    resetSimulation,
    checkpoint,
    renameProject,
  } = projectState;

  const documentMutationEpochRef = useRef(0);

  const markDocumentMutation = (): void => {
    documentMutationEpochRef.current += 1;
  };

  const commitDocument = (...args: Parameters<typeof projectCommitDocument>) => {
    // Parameter/value edits can remain live during modelling. Structural
    // entrypoints leave simulation explicitly before they call this wrapper.
    markDocumentMutation();
    return projectCommitDocument(...args);
  };

  const undo = () => {
    ensureEditModeForStructuralAction();
    markDocumentMutation();
    return projectUndo();
  };

  const redo = () => {
    ensureEditModeForStructuralAction();
    markDocumentMutation();
    return projectRedo();
  };

  const documentMutationEpoch = (): number => documentMutationEpochRef.current;

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
  const [requestedHorizonMicroseconds, setRequestedHorizonMicroseconds] = useState(0);
  const [liveResult, setLiveResult] = useState<typeof persistedResult>(null);
  const [arduinoSerialByBoard, setArduinoSerialByBoard] = useState<
    Readonly<Record<string, ElectronicsArduinoSerialProjection>>
  >({});
  const simulationWorkerRef = useRef<ElectronicsLiveSimulationWorkerController | null>(null);
  if (simulationWorkerRef.current === null) {
    simulationWorkerRef.current = new ElectronicsLiveSimulationWorkerController();
  }
  const runtimeDocumentRef = useRef(runtimeDocument);
  runtimeDocumentRef.current = runtimeDocument;
  const resetSimulationRef = useRef(resetSimulation);
  resetSimulationRef.current = resetSimulation;

  function ensureEditModeForStructuralAction(): void {
    if (!simulationRunning) return;
    simulationWorkerRef.current?.stop();
    resetSimulation();
    setRuntimeOverrides({});
    simulationStartedAtRef.current = null;
    setRequestedHorizonMicroseconds(0);
    setLiveResult(null);
    setArduinoSerialByBoard({});
  }

  useEffect(() => {
    if (!simulationRunning) {
      simulationStartedAtRef.current = null;
      setRequestedHorizonMicroseconds(0);
      setLiveResult(null);
      setArduinoSerialByBoard({});
      return;
    }

    simulationStartedAtRef.current = window.performance.now();
    setRequestedHorizonMicroseconds(0);
    const interval = window.setInterval(() => {
      const startedAt = simulationStartedAtRef.current;
      if (startedAt !== null) {
        setRequestedHorizonMicroseconds(
          Math.max(0, Math.round((window.performance.now() - startedAt) * 1000)),
        );
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [simulationRunning]);

  useEffect(() => {
    const controller = simulationWorkerRef.current;
    if (!controller) return;
    if (!simulationRunning) {
      controller.stop();
      return;
    }
    const initialDocument = runtimeDocumentRef.current;
    if (!initialDocument) return;
    setLiveResult(null);
    setArduinoSerialByBoard({});
    controller.start(projectId, initialDocument, {
      onResult: (nextResult) => {
        setLiveResult(nextResult);
        confirmSimulationStarted();
      },
      onSerialProjection: (serial) => {
        setArduinoSerialByBoard(
          Object.fromEntries(serial.map((entry) => [entry.componentId, entry])) as Readonly<
            Record<string, ElectronicsArduinoSerialProjection>
          >,
        );
      },
      onFailure: () => {
        resetSimulationRef.current();
        setNotice(
          'Моделирование остановлено: вычислительный модуль не отвечает. Запустите его ещё раз.',
        );
      },
    });
    return () => controller.stop();
  }, [confirmSimulationStarted, projectId, setNotice, simulationRunning]);

  useEffect(() => {
    if (!runtimeDocument || !simulationRunning) return;
    simulationWorkerRef.current?.update(runtimeDocument, requestedHorizonMicroseconds);
  }, [requestedHorizonMicroseconds, runtimeDocument, simulationRunning]);

  function sendArduinoSerialRx(boardId: string, text: string): void {
    if (!simulationRunning || !text) return;
    simulationWorkerRef.current?.sendSerialRx(boardId, text, requestedHorizonMicroseconds);
  }

  const result = useMemo(
    () =>
      simulationRunning
        ? liveResult
        : calculateLiveSimulation(
            runtimeDocument,
            persistedResult,
            false,
            requestedHorizonMicroseconds / 1000,
          ),
    [liveResult, persistedResult, requestedHorizonMicroseconds, runtimeDocument, simulationRunning],
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
  const [wirePreviewVertices, setWirePreviewVertices] = useState<readonly Point[]>([]);
  const [wireGuide, setWireGuide] = useState<{
    readonly from: Point;
    readonly via?: Point;
    readonly to: Point;
  } | null>(null);
  const [activeWireColor, setActiveWireColor] = useState('#149447');
  const [orthogonalWireMode, setOrthogonalWireMode] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(() => !compactWorkbench());
  const [libraryQuery, setLibraryQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory>('all');
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
  const catalogPreviewRef = useRef<HTMLDivElement>(null);
  const catalogPlacementRef = useRef<CatalogPlacement | null>(null);
  const componentDragRef = useRef<ComponentDrag | null>(null);
  const dragPreviewRef = useRef<ReturnType<typeof createComponentDragPreview> | null>(null);
  const wireDragPreviewRef = useRef<ReturnType<typeof createWireDragPreview> | null>(null);
  const visualFrameRef = useRef<ReturnType<typeof createVisualFrame> | null>(null);
  if (!visualFrameRef.current) visualFrameRef.current = createVisualFrame();
  const touchPointsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{
    ids: number[];
    center: Point;
    distance: number;
    viewport: Viewport;
  } | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  // Where the view actually is while a pan is in flight, since React state is
  // deliberately not being updated for each frame of it.
  const panViewportRef = useRef<Viewport | null>(null);
  const vertexDragRef = useRef<VertexDrag | null>(null);
  const segmentDragRef = useRef<SegmentDrag | null>(null);
  const lastVertexPressRef = useRef<{
    wireId: string;
    vertexIndex: number;
    x: number;
    y: number;
    at: number;
  } | null>(null);
  const endpointDragRef = useRef<EndpointDrag | null>(null);
  const wireStartPressRef = useRef<{
    pointerId: number;
    source: TerminalRef;
    startClient: Point;
    dragging: boolean;
  } | null>(null);
  const suppressTerminalClickRef = useRef(false);
  const wireAssistAxisRef = useRef<WireAssistAxis | null>(null);
  const vertexAssistTargetRef = useRef<WireVertexAssistTarget | null>(null);
  const actuatorPressRef = useRef<ActuatorPress | null>(null);
  const potentiometerDragRef = useRef<PotentiometerDrag | null>(null);
  const spacePressedRef = useRef(false);
  const counterRef = useRef(0);
  const viewportProjectRef = useRef<string | null>(null);

  function clearDragPreview(): void {
    visualFrameRef.current?.cancel();
    dragPreviewRef.current?.restore();
    wireDragPreviewRef.current?.restore();
    dragPreviewRef.current = null;
    wireDragPreviewRef.current = null;
    if (stageRef.current) {
      delete stageRef.current.dataset['componentDragging'];
      delete stageRef.current.dataset['wireDragging'];
    }
  }

  function cancelInteraction(): void {
    clearDragPreview();
    spacePressedRef.current = false;
    const stage = stageRef.current;
    const pointerIds = [
      wireStartPressRef.current?.pointerId,
      componentDragRef.current?.pointerId,
      vertexDragRef.current?.pointerId,
      segmentDragRef.current?.pointerId,
      panDragRef.current?.pointerId,
      ...touchPointsRef.current.keys(),
    ];
    componentDragRef.current = null;
    vertexDragRef.current = null;
    segmentDragRef.current = null;
    endpointDragRef.current = null;
    wireStartPressRef.current = null;
    suppressTerminalClickRef.current = false;
    potentiometerDragRef.current = null;
    panDragRef.current = null;
    pinchRef.current = null;
    touchPointsRef.current.clear();
    setDraggingComponents(false);
    setPanning(false);
    setMarquee(null);
    setReconnectHover(null);
    wireAssistAxisRef.current = null;
    vertexAssistTargetRef.current = null;
    setWireGuide(null);
    const settled = panViewportRef.current;
    if (settled) applyViewport(settled);
    for (const id of pointerIds) {
      if (id !== undefined && stage?.hasPointerCapture(id)) stage.releasePointerCapture(id);
    }
    const press = actuatorPressRef.current;
    actuatorPressRef.current = null;
    if (press) setComponentState(press.componentId, false, 'Кнопка отпущена.');
  }

  function componentDragDelta(drag: ComponentDrag, client: Point): Point {
    if (Math.hypot(client.x - drag.startClient.x, client.y - drag.startClient.y) < 3)
      return { x: 0, y: 0 };
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const world = clientToWorld(
      client.x,
      client.y,
      stage.getBoundingClientRect(),
      panViewportRef.current ?? viewport,
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
    const bounds = drag.bounds;
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clamp(world.x - drag.offset.x - drag.startedAt.x, -980 - bounds.minX, 4980 - bounds.maxX),
      y: clamp(world.y - drag.offset.y - drag.startedAt.y, -980 - bounds.minY, 3980 - bounds.maxY),
    };
  }

  function previewWire(
    source: NonNullable<ReturnType<typeof getCurrentDocument>>,
    next: typeof source,
    wireId: string,
  ): void {
    visualFrameRef.current?.schedule(() => {
      const stage = stageRef.current;
      if (!stage) return;
      wireDragPreviewRef.current ??= createWireDragPreview(stage, source, wireId);
      wireDragPreviewRef.current.draw(next);
    });
  }

  // A cancelled pointer, Escape, tab switch or route unmount cannot save a half gesture.
  const cancelInteractionRef = useRef(cancelInteraction);
  cancelInteractionRef.current = cancelInteraction;
  useEffect(() => {
    const cancel = () => {
      cancelInteractionRef.current();
      setCatalogPlacementState(null);
    };
    const hide = () => {
      if (globalThis.document.visibilityState === 'hidden') cancel();
    };
    window.addEventListener('blur', cancel);
    globalThis.document.addEventListener('visibilitychange', hide);
    return () => {
      clearDragPreview();
      componentDragRef.current = null;
      vertexDragRef.current = null;
      segmentDragRef.current = null;
      endpointDragRef.current = null;
      wireStartPressRef.current = null;
      suppressTerminalClickRef.current = false;
      potentiometerDragRef.current = null;
      panDragRef.current = null;
      pinchRef.current = null;
      touchPointsRef.current.clear();
      catalogPlacementRef.current = null;
      window.removeEventListener('blur', cancel);
      globalThis.document.removeEventListener('visibilitychange', hide);
    };
  }, [projectId]);
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
    const pointer = clientToWorld(
      clientX,
      clientY,
      rect,
      panViewportRef.current ?? viewport,
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
    // addComponentToDocument accepts the centre and applies the size offset once.
    return pointer;
  }

  function applyViewport(next: Viewport): void {
    panViewportRef.current = null;
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
      const stored = readLocalElectronicsViewport(project.id);
      const restored =
        stored ??
        (document.components.length === 0
          ? emptyInitialViewport()
          : (document.viewport ?? DEFAULT_VIEWPORT));
      // A document saved while the editor allowed a wider range would otherwise
      // reopen at a zoom the server will not accept back, and every save from
      // then on would fail for a reason the drawing does not explain.
      setViewport({ ...restored, zoom: clamp(restored.zoom, MIN_ZOOM, MAX_ZOOM) });
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
    ensureEditModeForStructuralAction();
    const variant = selectedFamilyVariant(family, null);
    cancelInteraction();
    const next: CatalogPlacement = {
      componentTypeId: variant.componentTypeId,
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
    catalogPlacementRef.current = {
      ...current,
      clientPoint: { x: clientX, y: clientY },
    };
    visualFrameRef.current?.schedule(syncCatalogPreview);
  }

  function syncCatalogPreview(): void {
    const node = catalogPreviewRef.current;
    const placing = catalogPlacementRef.current;
    const stage = stageRef.current;
    if (!node || !placing || !stage) return;
    node.style.visibility = placing.clientPoint ? 'visible' : 'hidden';
    if (!placing.clientPoint) return;
    const entry = catalogEntry(placing.componentTypeId);
    if (!entry) return;
    const size = renderedSize(entry, entry.defaultRotation);
    const rect = stage.getBoundingClientRect();
    const zoom = (panViewportRef.current ?? viewport).zoom;
    const scale = Math.max(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT) * zoom;
    node.style.width = size.width * scale + 'px';
    node.style.height = size.height * scale + 'px';
    node.style.transform =
      'translate(' +
      placing.clientPoint.x +
      'px,' +
      placing.clientPoint.y +
      'px) translate(-50%, -50%)';
  }

  function selectFamilyByTouch(familyId: string): void {
    beginFamilyPlacement(familyId);
    setLibraryOpen(false);
    setNotice('Компонент выбран. Коснитесь места на рабочем поле, куда его поставить.');
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
    visualFrameRef.current?.cancel();
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
    const currentDocument = getCurrentDocument();
    if (!currentDocument || selection?.kind !== 'component') return;
    ensureEditModeForStructuralAction();
    const duplicated = duplicateComponentInDocument(
      currentDocument,
      selection,
      nextId(selection.id),
    );
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
    const currentDocument = getCurrentDocument();
    if (!currentDocument || clipboardSelection?.kind !== 'component') return;
    ensureEditModeForStructuralAction();
    const duplicated = duplicateComponentInDocument(
      currentDocument,
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
    const currentDocument = getCurrentDocument();
    if (!currentDocument || !selection) return;
    ensureEditModeForStructuralAction();
    if (selection.kind === 'wire' && selection.vertexIndex !== undefined) {
      removeWireVertexAt(selection.id, selection.vertexIndex);
      return;
    }
    commitDocument(
      removeSelectionFromDocument(currentDocument, selection),
      selection.kind === 'wire' ? 'Провод удалён.' : 'Элемент удалён.',
    );
    setSelection(null);
  }

  function rotateSelected(): void {
    const currentDocument = getCurrentDocument();
    if (!currentDocument) return;
    ensureEditModeForStructuralAction();
    const next = rotateSelectionInDocument(currentDocument, selection);
    if (next) commitDocument(next, 'Элемент повернут на 45° вокруг центра — провода обновлены.');
  }

  function mirrorSelected(axis: 'horizontal' | 'vertical'): void {
    const currentDocument = getCurrentDocument();
    if (!currentDocument) return;
    ensureEditModeForStructuralAction();
    const next = mirrorSelectionInDocument(currentDocument, selection, axis);
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
            )) ||
          (component?.componentTypeId === 'pir-sensor' &&
            Object.keys(properties).every((key) => key === 'motionDetected'))
        );
      })()
    ) {
      setRuntimeComponentOverride(selection.id, { stateProperties: properties });
      return;
    }
    const next = updateSelectionProperties(document, selection, properties);
    if (next) commitDocument(next, message);
  }

  function setMultimeterMeasurementMode(
    componentId: string,
    measurementMode: 'dc-voltage' | 'dc-current' | 'resistance',
  ): void {
    const component = runtimeDocument?.components.find((item) => item.id === componentId);
    if (!document || component?.componentTypeId !== 'multimeter') return;
    if (simulationRunning) {
      setRuntimeComponentOverride(componentId, { stateProperties: { measurementMode } });
      return;
    }
    commitDocument(
      {
        ...document,
        components: document.components.map((item) =>
          item.id === componentId
            ? {
                ...item,
                stateProperties: { ...item.stateProperties, measurementMode },
              }
            : item,
        ),
      },
      measurementMode === 'dc-current'
        ? 'Мультиметр переключён в режим тока.'
        : measurementMode === 'resistance'
          ? 'Мультиметр переключён в режим сопротивления.'
          : 'Мультиметр переключён в режим напряжения.',
    );
  }

  function setRegulatedPowerSupplyControls(
    componentId: string,
    patch: {
      readonly voltageSetpointVolt?: number;
      readonly currentLimitAmp?: number;
      readonly outputEnabled?: boolean;
    },
  ): void {
    if (!document || !runtimeDocument) return;
    const component = runtimeDocument.components.find((item) => item.id === componentId);
    if (!component || component.componentTypeId !== 'regulated-power-supply') return;
    if (
      (patch.voltageSetpointVolt !== undefined && !Number.isFinite(patch.voltageSetpointVolt)) ||
      (patch.currentLimitAmp !== undefined && !Number.isFinite(patch.currentLimitAmp))
    ) {
      return;
    }
    const normalized = {
      ...(patch.voltageSetpointVolt === undefined
        ? {}
        : { voltageSetpointVolt: clamp(patch.voltageSetpointVolt, 0, 30) }),
      ...(patch.currentLimitAmp === undefined
        ? {}
        : { currentLimitAmp: clamp(patch.currentLimitAmp, 0, 5) }),
      ...(patch.outputEnabled === undefined ? {} : { outputEnabled: patch.outputEnabled }),
    };
    if (simulationRunning) {
      setRuntimeComponentOverride(componentId, { stateProperties: normalized });
      return;
    }
    commitDocument(
      {
        ...document,
        components: document.components.map((item) =>
          item.id === componentId
            ? {
                ...item,
                ...(normalized.voltageSetpointVolt === undefined
                  ? {}
                  : { value: normalized.voltageSetpointVolt }),
                ...(normalized.outputEnabled === undefined
                  ? {}
                  : { state: normalized.outputEnabled }),
                stateProperties: { ...item.stateProperties, ...normalized },
              }
            : item,
        ),
      },
      'Настройки лабораторного источника изменены.',
    );
  }

  function setSignalGeneratorControls(
    componentId: string,
    patch: {
      readonly waveform?: 'sine' | 'square' | 'triangle';
      readonly frequencyHz?: number;
      readonly amplitudeVpp?: number;
      readonly dcOffsetVolt?: number;
      readonly outputEnabled?: boolean;
    },
  ): void {
    if (!document || !runtimeDocument) return;
    const component = runtimeDocument.components.find((item) => item.id === componentId);
    if (!component || component.componentTypeId !== 'signal-generator') return;
    if (
      (patch.frequencyHz !== undefined && !Number.isFinite(patch.frequencyHz)) ||
      (patch.amplitudeVpp !== undefined && !Number.isFinite(patch.amplitudeVpp)) ||
      (patch.dcOffsetVolt !== undefined && !Number.isFinite(patch.dcOffsetVolt))
    ) {
      return;
    }
    const normalized = {
      ...(patch.waveform === undefined ? {} : { waveform: patch.waveform }),
      ...(patch.frequencyHz === undefined
        ? {}
        : { frequencyHz: clamp(patch.frequencyHz, 1, 1_000_000) }),
      ...(patch.amplitudeVpp === undefined
        ? {}
        : { amplitudeVpp: clamp(patch.amplitudeVpp, 0, 10) }),
      ...(patch.dcOffsetVolt === undefined
        ? {}
        : { dcOffsetVolt: clamp(patch.dcOffsetVolt, -5, 5) }),
      ...(patch.outputEnabled === undefined ? {} : { outputEnabled: patch.outputEnabled }),
    };
    if (simulationRunning) {
      setRuntimeComponentOverride(componentId, { stateProperties: normalized });
      return;
    }
    commitDocument(
      {
        ...document,
        components: document.components.map((item) =>
          item.id === componentId
            ? {
                ...item,
                ...(normalized.frequencyHz === undefined ? {} : { value: normalized.frequencyHz }),
                ...(normalized.outputEnabled === undefined
                  ? {}
                  : { state: normalized.outputEnabled }),
                stateProperties: { ...item.stateProperties, ...normalized },
              }
            : item,
        ),
      },
      'Настройки генератора сигналов изменены.',
    );
  }

  function updateArduinoProgram(
    componentId: string,
    properties: Readonly<Record<string, ProductionStateValue>>,
  ): void {
    // Arduino text is persisted after a short debounce. Always merge it into
    // the newest document instead of the render snapshot captured when the
    // timer was created; otherwise switching between two boards can restore
    // the previous source of the first board.
    const currentDocument = getCurrentDocument();
    if (!currentDocument) return;
    const component = currentDocument.components.find((item) => item.id === componentId);
    if (
      !component ||
      (component.componentTypeId !== 'arduino-uno' && component.variantId !== 'arduino-uno')
    ) {
      return;
    }
    commitDocument({
      ...currentDocument,
      components: currentDocument.components.map((item) =>
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
    const currentRuntimeDocument = runtimeDocumentRef.current;
    if (!currentRuntimeDocument) return;
    simulationStartedAtRef.current = window.performance.now();
    setRequestedHorizonMicroseconds(0);
    setLiveResult(null);
    simulationWorkerRef.current?.restart(currentRuntimeDocument);
    setNotice('Arduino перезапущена: setup() и loop() выполняются сначала.');
  }

  function setSelectedVariant(variantId: string): void {
    if (!document || selection?.kind !== 'component') return;
    ensureEditModeForStructuralAction();
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
    ensureEditModeForStructuralAction();
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
    ensureEditModeForStructuralAction();
    const next = removeSelectedWireBends(document, selection);
    if (next) commitDocument(next, 'Изгибы провода удалены.');
  }

  function beginReconnect(endpoint: 'from' | 'to'): void {
    if (selection?.kind !== 'wire') return;
    ensureEditModeForStructuralAction();
    setReconnectEndpoint(endpoint);
    setReconnectHover(null);
    setWirePreviewEnd(null);
    setNotice('Выберите новый вывод для переподключения провода.');
  }

  function wireTerminalPoint(ref: TerminalRef): Point | null {
    if (!document) return null;
    const component = document.components.find((item) => item.id === ref.componentId);
    return component ? terminalPositionInDocument(document, component, ref.terminal) : null;
  }

  function clearPendingWire(): void {
    setPendingTerminal(null);
    setWireDraftVertices([]);
    setWirePreviewVertices([]);
    setWirePreviewEnd(null);
    setReconnectHover(null);
    wireAssistAxisRef.current = null;
    setWireGuide(null);
  }

  function beginWireAtTerminal(componentId: string, terminal: Terminal): void {
    if (!document) return;
    ensureEditModeForStructuralAction();
    const source = { componentId, terminal };
    setSelection(null);
    setPendingTerminal(source);
    setWireDraftVertices([]);
    setWirePreviewVertices([]);
    setReconnectHover(null);
    wireAssistAxisRef.current = null;
    setWireGuide(null);
    setWirePreviewEnd(wireTerminalPoint(source));
    setNotice(
      'Ведите провод к цели. Щелчок добавляет точку, Shift фиксирует участок под 90°, Esc отменяет.',
    );
  }

  function commitPendingWireTo(
    target: TerminalRef,
    forceOrthogonal = false,
    sourceOverride?: TerminalRef,
  ): boolean {
    if (!document) return false;
    const source = sourceOverride ?? pendingTerminal;
    if (!source) return false;
    if (source.componentId === target.componentId && source.terminal === target.terminal) {
      clearPendingWire();
      setNotice('Прокладка провода отменена.');
      return false;
    }
    const sourcePoint = wireTerminalPoint(source);
    const targetPoint = wireTerminalPoint(target);
    if (!sourcePoint || !targetPoint) return false;
    const finalVertices =
      orthogonalWireMode || forceOrthogonal
        ? completeOrthogonalRoute(sourcePoint, targetPoint, wireDraftVertices)
        : wireDraftVertices;
    const connected = connectTerminals(
      document,
      source,
      target,
      nextId('wire'),
      activeWireColor,
      finalVertices,
    );
    if (connected.kind === 'duplicate') {
      clearPendingWire();
      setNotice('Эти выводы уже соединены.');
      return false;
    }
    commitDocument(connected.document, 'Провод добавлен.');
    setSelection({ kind: 'wire', id: connected.wire.id });
    clearPendingWire();
    return true;
  }

  function consumeTerminalClick(): boolean {
    if (!suppressTerminalClickRef.current) return false;
    suppressTerminalClickRef.current = false;
    return true;
  }

  function startWireTerminalPointer(
    event: PointerEvent<SVGCircleElement>,
    componentId: string,
    terminal: Terminal,
  ): void {
    event.stopPropagation();
    if (event.button !== 0 || !document || reconnectEndpoint || pendingTerminal) {
      return;
    }
    // Terminal hit areas intentionally remain generous. On compact parts they
    // can cover almost the whole body, so Shift+click must still honor the
    // workbench multi-selection gesture instead of unexpectedly starting a wire.
    if (event.shiftKey) {
      selectComponent(componentId, true);
      suppressTerminalClickRef.current = true;
      event.preventDefault();
      return;
    }
    const source = terminalTargetAt(event.clientX, event.clientY) ?? { componentId, terminal };
    beginWireAtTerminal(source.componentId, source.terminal);
    wireStartPressRef.current = {
      pointerId: event.pointerId,
      source,
      startClient: { x: event.clientX, y: event.clientY },
      dragging: false,
    };
    suppressTerminalClickRef.current = true;
    stageRef.current?.setPointerCapture(event.pointerId);
  }

  function clickTerminal(
    componentId: string,
    terminal: Terminal,
    forceOrthogonal = false,
    pointer?: Point,
  ): void {
    if (!document) return;
    const resolved = pointer ? terminalTargetAt(pointer.x, pointer.y) : null;
    const target = resolved ?? { componentId, terminal };
    if (forceOrthogonal && !pendingTerminal && !reconnectEndpoint) {
      selectComponent(target.componentId, true);
      return;
    }
    ensureEditModeForStructuralAction();
    if (reconnectEndpoint && selection?.kind === 'wire') {
      const next = reconnectWireEndpoint(document, selection.id, reconnectEndpoint, target);
      if (next) commitDocument(next, 'Конец провода переподключён.');
      setReconnectEndpoint(null);
      setReconnectHover(null);
      setWirePreviewEnd(null);
      return;
    }
    if (!pendingTerminal) {
      beginWireAtTerminal(target.componentId, target.terminal);
      return;
    }
    commitPendingWireTo(target, forceOrthogonal);
  }

  function selectComponent(componentId: string, additive = false): void {
    setSelection((current) => nextComponentSelection(current, componentId, additive));
  }

  function toWorld(event: PointerEvent | MouseEvent | DragEvent | WheelEvent): Point {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    return clientToWorld(
      event.clientX,
      event.clientY,
      stage.getBoundingClientRect(),
      panViewportRef.current ?? viewport,
      STAGE_WIDTH,
      STAGE_HEIGHT,
    );
  }

  function wireVertexDragPoint(
    wireId: string,
    vertexIndex: number,
    point: Point,
    clientPoint: Point,
    lockRightAngle: boolean,
    disableSoftAssist: boolean,
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

    if (lockRightAngle) {
      vertexAssistTargetRef.current = null;
      setWireGuide(null);
      return lockOrthogonalBend(previous, next, point);
    }

    const stage = stageRef.current;
    if (!stage || disableSoftAssist) {
      vertexAssistTargetRef.current = null;
      setWireGuide(null);
      return freePoint;
    }

    const rect = stage.getBoundingClientRect();
    const activeViewport = panViewportRef.current ?? viewport;
    const previousClient = worldToClient(previous, rect, activeViewport, STAGE_WIDTH, STAGE_HEIGHT);
    const nextClient = worldToClient(next, rect, activeViewport, STAGE_WIDTH, STAGE_HEIGHT);
    const assisted = resolveWireVertexAssist(
      previousClient,
      nextClient,
      clientPoint,
      vertexAssistTargetRef.current,
      disableSoftAssist,
    );
    vertexAssistTargetRef.current = assisted.target;
    if (!assisted.target) {
      setWireGuide(null);
      return freePoint;
    }

    const candidate =
      assisted.target === 'previous-x-next-y'
        ? { x: previous.x, y: next.y }
        : { x: next.x, y: previous.y };
    setWireGuide({ from: previous, via: candidate, to: next });
    return candidate;
  }

  function wireDraftPoint(
    anchor: Point,
    point: Point,
    clientPoint: Point,
    forceOrthogonal: boolean,
    disableSoftAssist: boolean,
  ): Point {
    if (forceOrthogonal) {
      wireAssistAxisRef.current = null;
      setWireGuide(null);
      return lockOrthogonalPoint(anchor, freeWirePoint(point));
    }

    const stage = stageRef.current;
    if (!stage || disableSoftAssist) {
      wireAssistAxisRef.current = null;
      setWireGuide(null);
      return freeWirePoint(point);
    }

    const rect = stage.getBoundingClientRect();
    const activeViewport = panViewportRef.current ?? viewport;
    const anchorClient = worldToClient(anchor, rect, activeViewport, STAGE_WIDTH, STAGE_HEIGHT);
    const assisted = resolveWireAssist(
      anchorClient,
      clientPoint,
      wireAssistAxisRef.current,
      disableSoftAssist,
    );
    wireAssistAxisRef.current = assisted.axis;
    if (!assisted.axis) {
      setWireGuide(null);
      return freeWirePoint(point);
    }

    const assistedPoint =
      assisted.axis === 'horizontal' ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };

    // The guide is drafting help, not another copy of the preview. Extend it in
    // screen space beyond both ends of the active segment so the dashed axis is
    // still visible when the solid wire preview lies on the same line.
    const guideExtensionPx = 24;
    const alignedClient =
      assisted.axis === 'horizontal'
        ? { x: clientPoint.x, y: anchorClient.y }
        : { x: anchorClient.x, y: clientPoint.y };
    const guideFromClient =
      assisted.axis === 'horizontal'
        ? {
            x: Math.min(anchorClient.x, alignedClient.x) - guideExtensionPx,
            y: anchorClient.y,
          }
        : {
            x: anchorClient.x,
            y: Math.min(anchorClient.y, alignedClient.y) - guideExtensionPx,
          };
    const guideToClient =
      assisted.axis === 'horizontal'
        ? {
            x: Math.max(anchorClient.x, alignedClient.x) + guideExtensionPx,
            y: anchorClient.y,
          }
        : {
            x: anchorClient.x,
            y: Math.max(anchorClient.y, alignedClient.y) + guideExtensionPx,
          };
    setWireGuide({
      from: clientToWorld(
        guideFromClient.x,
        guideFromClient.y,
        rect,
        activeViewport,
        STAGE_WIDTH,
        STAGE_HEIGHT,
      ),
      to: clientToWorld(
        guideToClient.x,
        guideToClient.y,
        rect,
        activeViewport,
        STAGE_WIDTH,
        STAGE_HEIGHT,
      ),
    });
    return assistedPoint;
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
    // A press can still be an ordinary selection click while modelling.
    // Structural intent begins only after the existing 3 px drag threshold is
    // crossed; then the same pointer gesture continues in edit mode.
    if (!document) return;
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
    componentDragRef.current = {
      componentId: component.id,
      componentIds,
      pointerId: event.pointerId,
      offset: { x: point.x - component.position.x, y: point.y - component.position.y },
      startedAt: component.position,
      startedDocument: document,
      startClient: { x: event.clientX, y: event.clientY },
      bounds: sceneBounds({
        ...document,
        components: document.components.filter((part) => componentIds.includes(part.id)),
      }),
      startedInSimulation: simulationRunning,
      structuralEditStarted: false,
    };
    setDraggingComponents(true);
    if (stageRef.current) stageRef.current.dataset['componentDragging'] = 'true';
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
        const point = wireDraftPoint(
          anchor,
          rawPoint,
          { x: event.clientX, y: event.clientY },
          orthogonalWireMode || event.shiftKey,
          event.altKey,
        );
        const next = [...current, point];
        setWirePreviewEnd(point);
        setWirePreviewVertices(next);
        wireAssistAxisRef.current = null;
        setWireGuide(null);
        return next;
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
      startViewport: panViewportRef.current ?? viewport,
    };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (onEmptyCanvas && !event.shiftKey) setSelection(null);
    event.preventDefault();
  }

  function beginStagePointer(event: PointerEvent<SVGSVGElement>): void {
    if (event.pointerType === 'touch') {
      if (pinchRef.current && !pinchRef.current.ids.includes(event.pointerId)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointsRef.current.size >= 2) {
        const points = [...touchPointsRef.current.entries()].slice(0, 2);
        const a = points[0];
        const b = points[1];
        if (!a || !b) return;
        const startViewport = panViewportRef.current ?? viewport;
        cancelInteraction();
        for (const [id, point] of points) {
          touchPointsRef.current.set(id, point);
          event.currentTarget.setPointerCapture(id);
        }
        pinchRef.current = {
          ids: points.map(([id]) => id),
          center: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 },
          distance: Math.max(1, Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y)),
          viewport: startViewport,
        };
        setCatalogPlacementState(null);
        setPendingTerminal(null);
        setWireDraftVertices([]);
        setWirePreviewEnd(null);
        setPanning(true);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    placeCatalogComponent(event);
  }

  // Pointer capture and overlapping breadboard holes make DOM hit order
  // unsuitable as electrical truth. Resolve against the actual rendered terminal
  // circles, then choose the nearest eligible centre deterministically.
  function terminalTargetAt(clientX: number, clientY: number): TerminalRef | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const candidates = [
      ...stage.querySelectorAll<SVGGraphicsElement>(
        '[data-terminal-component-id][data-terminal-id]',
      ),
    ]
      .flatMap((element) => {
        const componentId = element.dataset['terminalComponentId'];
        const terminal = element.dataset['terminalId'];
        if (!componentId || !terminal) return [];
        const rect = element.getBoundingClientRect();
        const radiusX = rect.width / 2;
        const radiusY = rect.height / 2;
        if (radiusX <= 0 || radiusY <= 0) return [];
        const dx = clientX - (rect.left + rect.right) / 2;
        const dy = clientY - (rect.top + rect.bottom) / 2;
        const normalizedDistance = Math.hypot(dx / radiusX, dy / radiusY);
        if (normalizedDistance > 1) return [];
        return [
          {
            componentId,
            terminal: terminal as Terminal,
            normalizedDistance,
            distance: Math.hypot(dx, dy),
          },
        ];
      })
      .sort(
        (a, b) =>
          a.normalizedDistance - b.normalizedDistance ||
          a.distance - b.distance ||
          a.componentId.localeCompare(b.componentId) ||
          String(a.terminal).localeCompare(String(b.terminal)),
      );
    const first = candidates[0];
    return first ? { componentId: first.componentId, terminal: first.terminal } : null;
  }

  function updateWireDraftPreview(
    start: Point,
    world: Point,
    clientPoint: Point,
    forceOrthogonal: boolean,
    disableSoftAssist: boolean,
    target: TerminalRef | null,
  ): void {
    const targetPoint = target ? wireTerminalPoint(target) : null;
    if (targetPoint) {
      wireAssistAxisRef.current = null;
      setWireGuide(null);
      setWirePreviewEnd(targetPoint);
      setWirePreviewVertices(
        forceOrthogonal
          ? completeOrthogonalRoute(start, targetPoint, wireDraftVertices)
          : wireDraftVertices,
      );
      return;
    }

    const anchor = wireDraftVertices[wireDraftVertices.length - 1] ?? start;
    setWirePreviewEnd(
      wireDraftPoint(anchor, world, clientPoint, forceOrthogonal, disableSoftAssist),
    );
    setWirePreviewVertices(wireDraftVertices);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>): void {
    const client = { x: event.clientX, y: event.clientY };
    if (touchPointsRef.current.has(event.pointerId))
      touchPointsRef.current.set(event.pointerId, client);
    const pinch = pinchRef.current;
    if (pinch) {
      const a = touchPointsRef.current.get(pinch.ids[0] as number);
      const b = touchPointsRef.current.get(pinch.ids[1] as number);
      if (a && b) {
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const zoom = clamp(
          (pinch.viewport.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance,
          MIN_ZOOM,
          MAX_ZOOM,
        );
        moveViewport(
          gestureViewport(
            pinch.viewport,
            pinch.center,
            center,
            zoom,
            event.currentTarget.getBoundingClientRect(),
            STAGE_WIDTH,
            STAGE_HEIGHT,
          ),
        );
      }
      event.preventDefault();
      return;
    }
    const world = toWorld(event);
    const wireStartPress = wireStartPressRef.current;
    if (wireStartPress?.pointerId === event.pointerId) {
      if (
        Math.hypot(
          event.clientX - wireStartPress.startClient.x,
          event.clientY - wireStartPress.startClient.y,
        ) >= WIRE_DRAG_THRESHOLD_PX
      ) {
        wireStartPress.dragging = true;
      }
      const start = wireTerminalPoint(wireStartPress.source);
      const target = terminalTargetAt(event.clientX, event.clientY);
      setReconnectHover(target);
      if (start) {
        updateWireDraftPreview(
          start,
          world,
          client,
          orthogonalWireMode || event.shiftKey,
          event.altKey,
          target,
        );
      }
      return;
    }
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
      catalogPlacementRef.current = {
        ...catalogPlacement,
        clientPoint: { x: event.clientX, y: event.clientY },
      };
      visualFrameRef.current?.schedule(syncCatalogPreview);
      return;
    }
    const vertexDrag = vertexDragRef.current;
    if (vertexDrag?.pointerId === event.pointerId && document) {
      previewWire(
        vertexDrag.startedDocument,
        moveWireVertex(
          vertexDrag.startedDocument,
          vertexDrag.wireId,
          vertexDrag.vertexIndex,
          wireVertexDragPoint(
            vertexDrag.wireId,
            vertexDrag.vertexIndex,
            world,
            client,
            event.shiftKey,
            event.altKey,
          ),
        ),
        vertexDrag.wireId,
      );
      return;
    }
    const segmentDrag = segmentDragRef.current;
    if (segmentDrag?.pointerId === event.pointerId) {
      const pointerDelta = {
        x: world.x - segmentDrag.startPointer.x,
        y: world.y - segmentDrag.startPointer.y,
      };
      previewWire(
        segmentDrag.startedDocument,
        moveWireSegment(
          segmentDrag.startedDocument,
          segmentDrag.wireId,
          segmentDrag.segmentIndex,
          pointerDelta,
        ),
        segmentDrag.wireId,
      );
      return;
    }
    if (marquee?.pointerId === event.pointerId) {
      setMarquee({ ...marquee, current: world });
      return;
    }
    if (pendingTerminal && pendingStart) {
      const target = terminalTargetAt(event.clientX, event.clientY);
      setReconnectHover(target);
      updateWireDraftPreview(
        pendingStart,
        world,
        client,
        orthogonalWireMode || event.shiftKey,
        event.altKey,
        target,
      );
    } else if (reconnectEndpoint) {
      setWirePreviewEnd(world);
    }
    const drag = componentDragRef.current;
    if (drag && drag.pointerId === event.pointerId && document) {
      const delta = componentDragDelta(drag, client);
      if (
        drag.startedInSimulation &&
        !drag.structuralEditStarted &&
        (delta.x !== 0 || delta.y !== 0)
      ) {
        drag.structuralEditStarted = true;
        ensureEditModeForStructuralAction();
      }
      visualFrameRef.current?.schedule(() => {
        const stage = stageRef.current;
        if (!stage || componentDragRef.current !== drag) return;
        dragPreviewRef.current ??= createComponentDragPreview(
          stage,
          drag.startedDocument,
          drag.componentIds,
        );
        dragPreviewRef.current.draw(delta);
      });
      return;
    }
    const pan = panDragRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      moveViewport(
        gestureViewport(
          pan.startViewport,
          pan.startClient,
          client,
          pan.startViewport.zoom,
          rect,
          STAGE_WIDTH,
          STAGE_HEIGHT,
        ),
      );
    }
  }

  function finishPointer(event: PointerEvent<SVGSVGElement>): void {
    touchPointsRef.current.delete(event.pointerId);
    if (pinchRef.current && !pinchRef.current.ids.includes(event.pointerId)) return;
    if (pinchRef.current) {
      pinchRef.current = null;
      const settled = panViewportRef.current ?? viewport;
      const remaining = [...touchPointsRef.current.entries()][0];
      panDragRef.current = remaining
        ? { pointerId: remaining[0], startClient: remaining[1], startViewport: settled }
        : null;
      if (!remaining) {
        setPanning(false);
        applyViewport(settled);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const wireStartPress = wireStartPressRef.current;
    if (wireStartPress?.pointerId === event.pointerId) {
      wireStartPressRef.current = null;
      const dragged =
        wireStartPress.dragging ||
        Math.hypot(
          event.clientX - wireStartPress.startClient.x,
          event.clientY - wireStartPress.startClient.y,
        ) >= WIRE_DRAG_THRESHOLD_PX;
      setReconnectHover(null);
      if (dragged) {
        const target = terminalTargetAt(event.clientX, event.clientY);
        if (
          target &&
          (target.componentId !== wireStartPress.source.componentId ||
            target.terminal !== wireStartPress.source.terminal)
        ) {
          commitPendingWireTo(target, event.shiftKey, wireStartPress.source);
        } else {
          clearPendingWire();
          setNotice('Провод не создан: отпустите его на контакте.');
        }
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      window.setTimeout(() => {
        suppressTerminalClickRef.current = false;
      }, 0);
      return;
    }
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
      const point = wireVertexDragPoint(
        vertexDrag.wireId,
        vertexDrag.vertexIndex,
        toWorld(event),
        { x: event.clientX, y: event.clientY },
        event.shiftKey,
        event.altKey,
      );
      vertexAssistTargetRef.current = null;
      setWireGuide(null);
      const source = vertexDrag.startedDocument;
      const old = source.connections.find((wire) => wire.id === vertexDrag.wireId)?.vertices?.[
        vertexDrag.vertexIndex
      ];
      clearDragPreview();
      if (getCurrentDocument() === source && old && (point.x !== old.x || point.y !== old.y)) {
        commitDocument(
          moveWireVertex(source, vertexDrag.wireId, vertexDrag.vertexIndex, point),
          'Изгиб провода перемещён.',
        );
      }
    }
    const segmentDrag = segmentDragRef.current;
    if (segmentDrag?.pointerId === event.pointerId) {
      segmentDragRef.current = null;
      const point = toWorld(event);
      const delta = {
        x: point.x - segmentDrag.startPointer.x,
        y: point.y - segmentDrag.startPointer.y,
      };
      clearDragPreview();
      if (
        getCurrentDocument() === segmentDrag.startedDocument &&
        Math.hypot(delta.x, delta.y) >= 0.5
      ) {
        commitDocument(
          moveWireSegment(
            segmentDrag.startedDocument,
            segmentDrag.wireId,
            segmentDrag.segmentIndex,
            delta,
          ),
          'Отрезок провода перемещён параллельно.',
        );
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
      const rawDelta = componentDragDelta(drag, { x: event.clientX, y: event.clientY });
      const delta = {
        x: Math.round(rawDelta.x * 1000) / 1000,
        y: Math.round(rawDelta.y * 1000) / 1000,
      };
      clearDragPreview();
      componentDragRef.current = null;
      setDraggingComponents(false);
      if (getCurrentDocument() === drag.startedDocument && (delta.x !== 0 || delta.y !== 0)) {
        let next = translatedDragDocument(drag.startedDocument, drag.componentIds, delta);
        for (const id of drag.componentIds) {
          const part = next.components.find((item) => item.id === id);
          const carried = Object.values(part?.holeBindings ?? {}).some((binding) =>
            drag.componentIds.includes(binding.breadboardComponentId),
          );
          if (part && part.kind !== 'breadboard' && !carried)
            next = snapComponentToBreadboard(next, id);
        }
        commitDocument(next, 'Положение сохранится автоматически.');
      } else if (drag.componentIds.length > 1) {
        // Pointer capture can suppress the later React click. A zero-distance
        // press on one member of a selected group is still an ordinary click:
        // collapse to that component. Any actual movement keeps the group drag.
        setSelection({ kind: 'component', id: drag.componentId, ids: [drag.componentId] });
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

  function cancelPointer(event: PointerEvent<SVGSVGElement>): void {
    cancelInteraction();
    setPendingTerminal(null);
    setWireDraftVertices([]);
    setWirePreviewVertices([]);
    setWirePreviewEnd(null);
    wireAssistAxisRef.current = null;
    setWireGuide(null);
    setReconnectEndpoint(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startVertexDrag(
    event: PointerEvent<SVGCircleElement>,
    wireId: string,
    vertexIndex: number,
  ): void {
    ensureEditModeForStructuralAction();
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
    if (!document) return;
    vertexAssistTargetRef.current = null;
    setWireGuide(null);
    vertexDragRef.current = {
      pointerId: event.pointerId,
      wireId,
      vertexIndex,
      startedDocument: document,
    };
    setSelection({ kind: 'wire', id: wireId, vertexIndex });
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function startSegmentDrag(
    event: PointerEvent<SVGPathElement>,
    wireId: string,
    segmentIndex: number,
  ): void {
    if (pendingTerminal || !document) return;
    ensureEditModeForStructuralAction();
    // WorkbenchStage is the single arbiter of wire click sequences. Starting
    // a segment drag must never reinterpret a rejected pair as a double-click.
    segmentDragRef.current = {
      pointerId: event.pointerId,
      wireId,
      segmentIndex,
      startPointer: toWorld(event),
      startedDocument: document,
    };
    setSelection({ kind: 'wire', id: wireId, segmentIndex });
    stageRef.current?.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function removeWireVertexAt(wireId: string, vertexIndex: number): void {
    if (!document) return;
    ensureEditModeForStructuralAction();
    const next = removeWireVertex(document, wireId, vertexIndex);
    commitDocument(next, 'Точка изгиба удалена.');
    setSelection({ kind: 'wire', id: wireId });
  }

  function startEndpointDrag(
    event: PointerEvent<SVGCircleElement>,
    wireId: string,
    endpoint: 'from' | 'to',
  ): void {
    ensureEditModeForStructuralAction();
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
    ensureEditModeForStructuralAction();
    const next = insertWireVertex(document, wireId, toWorld(event));
    if (next === document) return;
    commitDocument(next, 'Точка управления проводом добавлена.');
    setSelection({ kind: 'wire', id: wireId });
    event.stopPropagation();
    event.preventDefault();
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    if (
      componentDragRef.current ||
      vertexDragRef.current ||
      segmentDragRef.current ||
      pinchRef.current
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const current = panViewportRef.current ?? viewport;
    const zoom = clamp(current.zoom * (event.deltaY > 0 ? 0.88 : 1.14), MIN_ZOOM, MAX_ZOOM);
    const anchor = { x: event.clientX, y: event.clientY };
    applyViewport(gestureViewport(current, anchor, anchor, zoom, rect, STAGE_WIDTH, STAGE_HEIGHT));
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
      applyViewport(emptyInitialViewport());
      return;
    }
    const bounds = sceneBounds(document);
    const rect = stageRef.current?.getBoundingClientRect();
    applyViewport(
      bounds && rect
        ? fitViewportToScreen(
            bounds,
            rect,
            STAGE_WIDTH,
            STAGE_HEIGHT,
            MIN_ZOOM,
            MAX_ZOOM,
            compactWorkbench() ? { left: 64, right: 28, top: 28, bottom: 28 } : 28,
          )
        : DEFAULT_VIEWPORT,
    );
  }

  function nudgeSelection(dx: number, dy: number): void {
    const current = getCurrentDocument();
    if (!current || selection?.kind !== 'component') return;
    const selectedIds = selection.ids;
    const componentIds = [
      ...new Set([
        ...selectedIds,
        ...selectedIds.flatMap((id) => {
          const selected = current.components.find((item) => item.id === id);
          return selected?.kind === 'breadboard' ? componentsBoundToBreadboard(current, id) : [];
        }),
      ]),
    ];
    const bounds = sceneBounds({
      ...current,
      components: current.components.filter((part) => componentIds.includes(part.id)),
    });
    if (!bounds) return;
    const delta = {
      x: clamp(dx, -980 - bounds.minX, 4980 - bounds.maxX),
      y: clamp(dy, -980 - bounds.minY, 3980 - bounds.maxY),
    };
    if (delta.x === 0 && delta.y === 0) return;
    ensureEditModeForStructuralAction();
    let next = translatedDragDocument(current, componentIds, delta);
    // A multi-selection is one rigid body for keyboard nudges. Snapping every
    // member independently can pull one part onto a nearby breadboard hole and
    // deform the group. Keep single-part placement help, but preserve relative
    // geometry whenever the user explicitly selected more than one component.
    if (selectedIds.length === 1 && componentIds.length === 1) {
      const id = componentIds[0]!;
      const part = next.components.find((item) => item.id === id);
      if (part && part.kind !== 'breadboard') next = snapComponentToBreadboard(next, id);
    }
    commitDocument(next, 'Положение изменено с клавиатуры.');
  }

  const shortcutActionsRef = useRef<{
    readonly undo: () => unknown;
    readonly redo: () => unknown;
    readonly copy: () => void;
    readonly paste: () => void;
    readonly duplicate: () => void;
    readonly remove: () => void;
    readonly rotate: () => void;
    readonly selectAll: () => void;
    readonly nudge: (dx: number, dy: number) => void;
    readonly cancel: () => void;
  } | null>(null);
  shortcutActionsRef.current = {
    undo,
    redo,
    copy: copySelected,
    paste: pasteCopied,
    duplicate: duplicateSelected,
    remove: removeSelection,
    rotate: rotateSelected,
    selectAll: () => {
      const current = getCurrentDocument();
      const ids = current?.components.map((component) => component.id) ?? [];
      setSelection(ids.length > 0 ? { kind: 'component', id: ids[0]!, ids } : null);
    },
    nudge: nudgeSelection,
    cancel: () => {
      cancelInteraction();
      setCatalogPlacementState(null);
      setPendingTerminal(null);
      setWireDraftVertices([]);
      setWirePreviewEnd(null);
      setSelection(null);
      setReconnectEndpoint(null);
      setNotice(null);
    },
  };

  useEffect(() => {
    function keyDown(event: globalThis.KeyboardEvent): void {
      if (event.code === 'Space' && !targetConsumesSpace(event.target)) {
        spacePressedRef.current = true;
      }
      if (isEditableShortcutTarget(event.target)) return;

      const command = resolveWorkbenchShortcut(event);
      const actions = shortcutActionsRef.current;
      if (!command || !actions) return;
      if (command !== 'escape') event.preventDefault();

      if (command === 'undo') actions.undo();
      else if (command === 'redo') actions.redo();
      else if (command === 'copy') actions.copy();
      else if (command === 'paste') actions.paste();
      else if (command === 'duplicate') actions.duplicate();
      else if (command === 'delete') actions.remove();
      else if (command === 'rotate') actions.rotate();
      else if (command === 'select-all') actions.selectAll();
      else if (command === 'nudge-up')
        actions.nudge(0, -(event.shiftKey ? KEYBOARD_NUDGE_LARGE_STEP : KEYBOARD_NUDGE_STEP));
      else if (command === 'nudge-down')
        actions.nudge(0, event.shiftKey ? KEYBOARD_NUDGE_LARGE_STEP : KEYBOARD_NUDGE_STEP);
      else if (command === 'nudge-left')
        actions.nudge(-(event.shiftKey ? KEYBOARD_NUDGE_LARGE_STEP : KEYBOARD_NUDGE_STEP), 0);
      else if (command === 'nudge-right')
        actions.nudge(event.shiftKey ? KEYBOARD_NUDGE_LARGE_STEP : KEYBOARD_NUDGE_STEP, 0);
      else if (command === 'escape') actions.cancel();
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
  }, []);

  const filteredCatalog = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase('ru');
    return workbenchCatalog().filter(
      (family) =>
        familyMatchesCategory(family, category) &&
        (!query || familySearchText(family).includes(query)),
    );
  }, [category, libraryQuery]);

  const selectedComponent =
    selection?.kind === 'component' && selection.ids.length === 1
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
  const resultByComponent = useMemo(() => {
    const map = new Map<string, ComponentResult>();
    for (const item of result?.components ?? []) map.set(item.componentId, item);
    return map;
  }, [result]);
  const staticPreflightResult = useMemo(() => {
    if (!document || simulationRunning) return null;
    return calculateSimulationPreflight({
      ...document,
      simulation: { ...document.simulation, running: true },
    });
  }, [document, simulationRunning]);
  const diagnosticResult = simulationRunning ? result : (staticPreflightResult ?? result);
  const runtimePresentationResultByComponent = useMemo(
    () => (simulationRunning ? resultByComponent : new Map<string, ComponentResult>()),
    [resultByComponent, simulationRunning],
  );

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
    return Math.round(
      clamp(runtimePresentationResultByComponent.get(component.id)?.brightness ?? 0, 0, 100),
    );
  }

  const diagnosticsByComponent = useMemo(() => {
    return diagnosticsGroupedByComponent(diagnosticResult?.diagnostics ?? []);
  }, [diagnosticResult]);
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
      return runtimePresentationResultByComponent.get(component.id)?.lit ? 'lit' : 'off';
    }
    if ((component.kind !== 'led' && component.kind !== 'rgb-led') || !simulationRunning)
      return 'default';
    const componentResult = runtimePresentationResultByComponent.get(component.id);
    const calculatedState = componentResult?.presentationState;
    if (component.kind === 'rgb-led') {
      if (calculatedState === 'failed') return 'burned';
      if (calculatedState === 'destructive') {
        return runtimePresentationResultByComponent.get(component.id)?.stressState === 'burned'
          ? 'burned'
          : 'overcurrent';
      }
      return runtimePresentationResultByComponent.get(component.id)?.lit ? 'lit' : 'off';
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
    wirePreviewVertices,
    wirePreviewEnd,
    wireGuide,
    activeWireColor,
    orthogonalWireMode,
    simulationRunning,
    arduinoSerialByBoard,
    sendArduinoSerialRx,
    simulationTimeMs: requestedHorizonMicroseconds / 1000,
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
    documentMutationEpoch,
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
    setMultimeterMeasurementMode,
    setRegulatedPowerSupplyControls,
    setSignalGeneratorControls,
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
    consumeTerminalClick,
    startWireTerminalPointer,
    startComponentDrag,
    startPotentiometerControl,
    selectComponent,
    startVertexDrag,
    startSegmentDrag,
    startEndpointDrag,
    addWireVertexAt,
    startPan,
    beginStagePointer,
    handlePointerMove,
    finishPointer,
    cancelPointer,
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
    runtimePresentationResultByComponent,
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
    catalogPreviewRef,
    syncCatalogPreview,
    selectFamilyByTouch,
    addComponent,
    addFamily,
    beginFamilyPlacement,
    moveFamilyPlacement,
    finishFamilyPlacement,
    cancelFamilyPlacement,
  };
}

export type ElectronicsWorkbenchController = ReturnType<typeof useElectronicsWorkbench>;
