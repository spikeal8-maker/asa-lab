import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  catalogEntry,
  componentPointPosition,
  renderedSize,
  terminalPosition,
} from './component-catalog';
import { ProductionComponentVisual } from './ProductionComponentVisual';
import { productionBreadboard } from './production-manifest-adapter';
import { roundedWirePath, wirePoints } from './workbench-geometry';
import { CircuitIcon, FitIcon, ZoomInIcon, ZoomOutIcon } from './workbench-icons';
import { componentTransform } from './workbench-model';
import { terminalPositionInDocument } from './workbench-document';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

/** The part currently in hand, drawn on the cursor wherever the cursor is.
 *
 * The placement preview lives inside the canvas, so until the pointer crossed
 * onto the board there was nothing to see: a part picked from the catalogue
 * disappeared behind the panel it came from, and the only sign anything had
 * happened was a line of text. This follows the pointer over the whole window,
 * including the panel, from the moment the card is pressed.
 *
 * It writes its own transform rather than holding the position in state: this sits
 * above a canvas that is expensive to re-render, and a pointer move must not cost
 * a render of the scene.
 */
function PickedUpPart({
  controller: c,
}: {
  controller: ElectronicsWorkbenchController;
}): JSX.Element | null {
  const holder = useRef<HTMLDivElement>(null);
  // Driven by the intent to place, not by the preview on the canvas. That preview
  // needs a point on the board, and there is none until the pointer crosses onto
  // it — so keying this to the preview drew nothing at all while the cursor was
  // still over the panel, which is exactly the moment it is needed.
  const placing = c.catalogPlacement;
  const typeId = placing?.mode === 'pointer' && !placing.point ? placing.componentTypeId : null;

  useEffect(() => {
    if (!typeId) return;
    function follow(event: PointerEvent): void {
      const node = holder.current;
      if (node) {
        node.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
      }
    }
    window.addEventListener('pointermove', follow);
    return () => window.removeEventListener('pointermove', follow);
  }, [typeId]);

  if (!typeId || !placing?.clientPoint) return null;
  const entry = catalogEntry(typeId);
  if (!entry) return null;
  const size = renderedSize(entry, 0);
  const stageRect = c.stageRef.current?.getBoundingClientRect();
  const scale = stageRect
    ? Math.max(stageRect.width / c.viewBox.width, stageRect.height / c.viewBox.height)
    : 1;
  return (
    <div
      className="workbench-picked-up"
      ref={holder}
      aria-hidden="true"
      style={{
        width: `${size.width * scale}px`,
        height: `${size.height * scale}px`,
        transform: `translate(${placing.clientPoint.x}px, ${placing.clientPoint.y}px) translate(-50%, -50%)`,
      }}
    >
      <svg viewBox={`0 0 ${size.width} ${size.height}`} width="100%" height="100%">
        <ProductionComponentVisual
          entry={entry}
          component={{
            id: 'catalog-pointer-preview',
            kind: entry.kind,
            componentTypeId: entry.key,
            variantId: entry.variantId,
            position: { x: 0, y: 0 },
            value: entry.defaultValue,
          }}
          width={size.width}
          height={size.height}
          visualState="default"
          effectiveBrightness={0}
        />
      </svg>
    </div>
  );
}

function tooltipWidth(label: string, zoom: number): number {
  return Math.max(58, label.length * 7.4 + 18) / zoom;
}

function tooltipPlacement(
  label: string,
  point: { readonly x: number; readonly y: number },
  viewBox: { readonly x: number; readonly y: number; readonly width: number },
  zoom: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly textY: number } {
  const width = tooltipWidth(label, zoom);
  const margin = 8 / zoom;
  const half = width / 2;
  const centre = Math.min(
    viewBox.x + viewBox.width - half - margin,
    Math.max(viewBox.x + half + margin, point.x),
  );
  const above = -36 / zoom;
  const below = 14 / zoom;
  const y = point.y + above < viewBox.y + margin ? below : above;
  return { x: centre - point.x - half, y, width, textY: y + 15 / zoom };
}

export function WorkbenchStage({
  controller: c,
  showGrid,
}: {
  controller: ElectronicsWorkbenchController;
  showGrid: boolean;
}): JSX.Element {
  const document = c.document!;
  const [hoveredBreadboardNet, setHoveredBreadboardNet] = useState<{
    boardId: string;
    groupId: string;
  } | null>(null);
  const lastWireClick = useRef<{
    wireId: string;
    x: number;
    y: number;
    at: number;
  } | null>(null);
  const lastVertexClick = useRef<{
    wireId: string;
    vertexIndex: number;
    x: number;
    y: number;
    at: number;
  } | null>(null);

  function isRepeatedClick(
    previous: { x: number; y: number; at: number } | null,
    event: ReactPointerEvent<SVGElement>,
  ): boolean {
    if (!previous) return false;
    return (
      Date.now() - previous.at <= 420 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8
    );
  }

  function handleWirePointerDown(
    event: ReactPointerEvent<SVGPathElement>,
    wireId: string,
    segmentIndex?: number,
  ): void {
    // While a new wire is being laid, a click on any existing wire must reach
    // the canvas: it adds a draft bend exactly there, so a route can be drawn
    // along (and onto) other wires. Swallowing the event here made cable
    // management impossible — the bend simply never happened.
    if (c.pendingTerminal) return;
    event.stopPropagation();
    const previous = lastWireClick.current;
    const repeated = previous?.wireId === wireId && isRepeatedClick(previous, event);
    if (event.detail >= 2 || repeated) {
      lastWireClick.current = null;
      c.addWireVertexAt(event, wireId);
      return;
    }
    lastWireClick.current = {
      wireId,
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
    };
    if (segmentIndex === undefined) {
      c.setSelection({ kind: 'wire', id: wireId });
      return;
    }
    c.startSegmentDrag(event, wireId, segmentIndex);
  }

  const orderedComponents = [
    ...document.components.filter((component) => component.kind === 'breadboard'),
    ...document.components.filter((component) => component.kind !== 'breadboard'),
  ];
  const selectedWire =
    c.selection?.kind === 'wire'
      ? document.connections.find((wire) => wire.id === c.selection?.id)
      : null;
  const selectedWireFromComponent = selectedWire
    ? document.components.find((item) => item.id === selectedWire.from.componentId)
    : null;
  const selectedWireToComponent = selectedWire
    ? document.components.find((item) => item.id === selectedWire.to.componentId)
    : null;
  const selectedWireFrom =
    selectedWire && selectedWireFromComponent
      ? terminalPositionInDocument(document, selectedWireFromComponent, selectedWire.from.terminal)
      : null;
  const selectedWireTo =
    selectedWire && selectedWireToComponent
      ? terminalPositionInDocument(document, selectedWireToComponent, selectedWire.to.terminal)
      : null;
  const routedWires = document.connections.flatMap((wire) => {
    const fromComponent = document.components.find((item) => item.id === wire.from.componentId);
    const toComponent = document.components.find((item) => item.id === wire.to.componentId);
    if (!fromComponent || !toComponent) return [];
    const from = terminalPositionInDocument(document, fromComponent, wire.from.terminal);
    const to = terminalPositionInDocument(document, toComponent, wire.to.terminal);
    if (!from || !to) return [];
    const selected = c.selection?.kind === 'wire' && c.selection.id === wire.id;
    const displayedFrom =
      selected && c.reconnectEndpoint === 'from' && c.wirePreviewEnd ? c.wirePreviewEnd : from;
    const displayedTo =
      selected && c.reconnectEndpoint === 'to' && c.wirePreviewEnd ? c.wirePreviewEnd : to;
    return [
      {
        wire,
        selected,
        points: wirePoints(displayedFrom, displayedTo, wire.vertices),
        path: roundedWirePath(wirePoints(displayedFrom, displayedTo, wire.vertices)),
      },
    ];
  });
  return (
    <section className="workbench-stage" aria-label="Рабочее поле электронной схемы">
      <PickedUpPart controller={c} />
      <svg
        ref={c.stageRef}
        className={`workbench-canvas${c.panning ? ' panning' : ''}${
          c.pendingTerminal || c.reconnectEndpoint ? ' wiring' : ''
        }${c.catalogPlacement ? ' placing' : ''}`}
        viewBox={`${c.viewBox.x} ${c.viewBox.y} ${c.viewBox.width} ${c.viewBox.height}`}
        preserveAspectRatio="xMidYMid slice"
        onPointerDownCapture={c.placeCatalogComponent}
        onPointerDown={c.startPan}
        onPointerMove={c.handlePointerMove}
        onPointerUp={c.finishPointer}
        onPointerCancel={c.finishPointer}
        onWheel={c.handleWheel}
      >
        <defs>
          <pattern id="asa-grid-small" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#eceff2" strokeWidth="0.8" />
          </pattern>
          <pattern id="asa-grid-large" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="url(#asa-grid-small)" />
            <path d="M100 0H0V100" fill="none" stroke="#dfe3e7" strokeWidth="1" />
          </pattern>
        </defs>
        <rect
          className="workbench-grid-hit"
          x="-4000"
          y="-3000"
          width="9000"
          height="7000"
          fill={showGrid ? 'url(#asa-grid-large)' : '#f4f5f6'}
        />
        <g className="workbench-wire-layer workbench-wire-hit-layer">
          {routedWires.map(({ wire, path }) => (
            <path
              key={wire.id}
              data-testid="wire-hit"
              data-wire-id={wire.id}
              className="workbench-wire-hit"
              d={path}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(event) => handleWirePointerDown(event, wire.id)}
              onClick={(event) => event.stopPropagation()}
            />
          ))}
          {routedWires.flatMap(({ wire, points }) =>
            points.slice(0, -1).map((start, segmentIndex) => {
              const end = points[segmentIndex + 1];
              if (!end) return null;
              const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
              return (
                <path
                  key={`${wire.id}-segment-${segmentIndex}`}
                  data-testid="wire-segment"
                  data-wire-id={wire.id}
                  data-wire-segment-index={segmentIndex}
                  className={`workbench-wire-segment-hit ${horizontal ? 'horizontal' : 'vertical'}`}
                  d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) => handleWirePointerDown(event, wire.id, segmentIndex)}
                  onClick={(event) => event.stopPropagation()}
                />
              );
            }),
          )}
        </g>
        {orderedComponents
          .filter((component) => component.kind !== 'wire')
          .map((component) => {
            const entry = catalogEntry(component);
            if (!entry?.asset || !entry.terminals) return null;
            const baseSize = renderedSize(entry, 0);
            const selected =
              c.selection?.kind === 'component' && c.selection.ids.includes(component.id);
            const visualState = c.componentVisualState(component);
            const componentDiagnostics = c.diagnosticsByComponent.get(component.id) ?? [];
            const diagnostics = componentDiagnostics.map((diagnostic) => diagnostic.code);
            const actionableDiagnostics = componentDiagnostics.filter(
              (diagnostic) => diagnostic.severity !== 'info',
            );
            const isLedIndicator = entry.key === 'led-5mm';
            const isRgbLed = entry.key === 'rgb-led';
            const ledBurned = (isLedIndicator || isRgbLed) && diagnostics.includes('led_burnout');
            const ledOvercurrent = isLedIndicator && diagnostics.includes('led_overcurrent');
            const primaryDiagnostic = ledBurned
              ? actionableDiagnostics.find((diagnostic) => diagnostic.code === 'led_burnout')
              : ledOvercurrent
                ? actionableDiagnostics.find((diagnostic) => diagnostic.code === 'led_overcurrent')
                : actionableDiagnostics[0];
            const diagnosticText = primaryDiagnostic
              ? `${primaryDiagnostic.message}${
                  primaryDiagnostic.suggestedAction ? ` ${primaryDiagnostic.suggestedAction}` : ''
                }`
              : '';
            // The ordinary Tinkercad LED keeps reverse and disconnected states
            // visually quiet. Its on-canvas marker exists only for actual
            // over-current, and the destructive state replaces it with the
            // starburst. Other components retain their existing diagnostics.
            const showDiagnosticIndicator = isLedIndicator
              ? ledOvercurrent || ledBurned
              : !isRgbLed || ledBurned;
            return (
              <g
                key={component.id}
                className={`${selected ? 'workbench-component-selected' : ''}${
                  c.simulationRunning && selected && c.errorDiagnosticComponentIds.has(component.id)
                    ? ' workbench-component-diagnostic'
                    : ''
                }${
                  c.simulationRunning && component.state
                    ? ' workbench-component-actuator-active'
                    : ''
                }`}
                data-testid="schematic-component"
                data-kind={component.kind}
                data-component-type={component.componentTypeId}
                data-hole-bindings={Object.keys(component.holeBindings ?? {}).length}
                data-hole-ids={Object.entries(component.holeBindings ?? {})
                  .map(([pinId, binding]) => `${pinId}:${binding.holeId}`)
                  .join(',')}
                data-diagnostics={diagnostics.join(',')}
                data-x={component.position.x}
                data-y={component.position.y}
              >
                {Object.keys(component.holeBindings ?? {}).length > 0 ? (
                  <g className="workbench-mounted-leads" pointerEvents="none" aria-hidden="true">
                    {Object.keys(component.holeBindings ?? {}).map((terminal) => {
                      const physicalPoint = terminalPosition(
                        component,
                        component.position,
                        terminal,
                        component.rotation ?? 0,
                      );
                      const landingPoint = terminalPositionInDocument(
                        document,
                        component,
                        terminal,
                      );
                      if (!physicalPoint || !landingPoint) return null;
                      return (
                        <line
                          key={terminal}
                          className={`workbench-mounted-lead${
                            component.kind === 'source' && terminal === 'BAT+'
                              ? ' positive'
                              : component.kind === 'source' && terminal === 'BAT-'
                                ? ' negative'
                                : ''
                          }`}
                          data-mounted-terminal={terminal}
                          x1={physicalPoint.x}
                          y1={physicalPoint.y}
                          x2={landingPoint.x}
                          y2={landingPoint.y}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  </g>
                ) : null}
                <g
                  className={`workbench-part${selected ? ' selected' : ''}`}
                  transform={componentTransform(component)}
                  onPointerDown={(e) => c.startComponentDrag(e, component)}
                  onClick={(e) => {
                    e.stopPropagation();
                    c.selectComponent(component.id, e.shiftKey);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${entry.label}. Перетащите для перемещения.`}
                  onKeyDown={(e: ReactKeyboardEvent<SVGGElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      c.selectComponent(component.id, e.shiftKey);
                    }
                  }}
                >
                  <rect
                    className="workbench-component-body-hit"
                    x="0"
                    y="0"
                    width={baseSize.width}
                    height={baseSize.height}
                    fill="#ffffff"
                    fillOpacity={0.001}
                    pointerEvents="all"
                  />
                  <ProductionComponentVisual
                    entry={entry}
                    component={component}
                    width={baseSize.width}
                    height={baseSize.height}
                    visualState={visualState}
                    effectiveBrightness={c.componentLedBrightness(component)}
                    result={c.resultByComponent.get(component.id)}
                    selected={selected}
                    selectionOffset={1.6 / c.viewport.zoom}
                    simulationRunning={c.simulationRunning}
                    onSwitchActuate={
                      c.simulationRunning && component.kind === 'switch'
                        ? () => c.toggleComponentState(component.id)
                        : undefined
                    }
                  />
                  {component.kind === 'potentiometer' && c.simulationRunning ? (
                    <circle
                      className="workbench-potentiometer-hit"
                      cx={baseSize.width / 2}
                      cy={baseSize.height * 0.45}
                      r={Math.min(baseSize.width, baseSize.height) * 0.25}
                      onPointerDown={(event) => c.startPotentiometerControl(event, component)}
                      aria-label="Повернуть ручку потенциометра"
                    />
                  ) : null}
                </g>
                {c.simulationRunning && primaryDiagnostic && showDiagnosticIndicator ? (
                  <g transform={componentTransform(component)}>
                    <g
                      className={`workbench-component-diagnostic-indicator${
                        ledBurned ? ' workbench-led-burnout-explosion' : ''
                      }${
                        isLedIndicator && ledOvercurrent ? ' workbench-led-warning-indicator' : ''
                      }${c.errorDiagnosticComponentIds.has(component.id) ? ' error' : ''}`}
                      data-testid={
                        ledBurned
                          ? entry.key === 'rgb-led'
                            ? 'rgb-led-burnout-explosion'
                            : 'led-burnout-explosion'
                          : isLedIndicator
                            ? 'led-diagnostic-badge'
                            : 'component-diagnostic-indicator'
                      }
                      data-diagnostic-count={actionableDiagnostics.length}
                      transform={`translate(${
                        ledBurned ? baseSize.width * 0.5 : baseSize.width * 0.83
                      } ${ledBurned ? baseSize.height * 0.35 : baseSize.height * 0.16})`}
                      pointerEvents="all"
                      role="img"
                      tabIndex={0}
                      aria-label={diagnosticText}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        c.selectComponent(component.id, event.shiftKey);
                      }}
                    >
                      <title>{diagnosticText}</title>
                      {ledBurned ? (
                        // Compact burst: at full size (~14 мм) it swallowed the
                        // whole LED and the burned part could not be told from any
                        // other. At 0.55 the flash still reads clearly while the
                        // dome and leads stay visible around it.
                        <g transform={`scale(${0.55 / c.viewport.zoom})`} aria-hidden="true">
                          <path
                            className="workbench-led-explosion-outer"
                            d="M0-30 7-17 20-24 18-9 33-8 22 3 34 13 18 14 19 30 6 21 0 35-7 21-20 29-18 14-34 13-22 3-33-8-18-9-20-24-7-17Z"
                          />
                          <path
                            className="workbench-led-explosion-inner"
                            d="M0-22 5-11 16-16 13-5 24 0 13 5 16 16 5 11 0 23-5 11-16 16-13 5-24 0-13-5-16-16-5-11Z"
                          />
                        </g>
                      ) : (
                        <>
                          <circle r={9 / c.viewport.zoom} vectorEffect="non-scaling-stroke" />
                          <text y={4 / c.viewport.zoom} fontSize={12 / c.viewport.zoom}>
                            !
                          </text>
                        </>
                      )}
                      {primaryDiagnostic ? (
                        <foreignObject
                          className="workbench-component-diagnostic-tooltip"
                          x={-100 / c.viewport.zoom}
                          y={18 / c.viewport.zoom}
                          width={200 / c.viewport.zoom}
                          height={142 / c.viewport.zoom}
                          pointerEvents="none"
                        >
                          <div style={{ fontSize: `${12 / c.viewport.zoom}px` }}>
                            <strong>{primaryDiagnostic.message}</strong>
                            {primaryDiagnostic.suggestedAction ? (
                              <small>{primaryDiagnostic.suggestedAction}</small>
                            ) : null}
                          </div>
                        </foreignObject>
                      ) : null}
                    </g>
                  </g>
                ) : null}
                {/* Several hundred invisible hover targets, each recomputing its
                    world position from the board's. While something is being
                    dragged they have nothing to respond to, and drawing them is
                    the difference between the board following the pointer and
                    crawling after it. */}
                {component.kind === 'breadboard' && !c.draggingComponents
                  ? (productionBreadboard(component.componentTypeId ?? '')?.holes ?? []).map(
                      (hole) => {
                        const point = componentPointPosition(
                          component,
                          component.position,
                          hole,
                          component.rotation ?? 0,
                        );
                        if (!point) return null;
                        const pending =
                          c.pendingTerminal?.componentId === component.id &&
                          c.pendingTerminal.terminal === hole.id;
                        const connected =
                          hoveredBreadboardNet?.boardId === component.id &&
                          hoveredBreadboardNet.groupId === hole.groupId;
                        return (
                          <g
                            key={hole.id}
                            className={`workbench-breadboard-terminal${pending ? ' pending' : ''}${connected ? ' connected' : ''}`}
                            data-hole-id={hole.id}
                            data-group-id={hole.groupId}
                            onPointerEnter={() =>
                              setHoveredBreadboardNet({
                                boardId: component.id,
                                groupId: hole.groupId,
                              })
                            }
                            onPointerLeave={() => setHoveredBreadboardNet(null)}
                          >
                            <circle
                              className="workbench-breadboard-hole-hit"
                              cx={point.x}
                              cy={point.y}
                              r="5"
                              data-terminal-component-id={component.id}
                              data-terminal-id={hole.id}
                              role="button"
                              tabIndex={0}
                              aria-label={`${entry.label}: отверстие ${hole.id}`}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                c.clickTerminal(component.id, hole.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  c.clickTerminal(component.id, hole.id);
                                }
                              }}
                            />
                            <rect
                              className="workbench-contact-square"
                              x={point.x - 5 / c.viewport.zoom}
                              y={point.y - 5 / c.viewport.zoom}
                              width={10 / c.viewport.zoom}
                              height={10 / c.viewport.zoom}
                              rx={1 / c.viewport.zoom}
                            />
                            <circle
                              className="workbench-breadboard-hole"
                              cx={point.x}
                              cy={point.y}
                              r="2.3"
                            />
                            <circle
                              className="workbench-breadboard-net-ring"
                              cx={point.x}
                              cy={point.y}
                              r="4.5"
                            />
                          </g>
                        );
                      },
                    )
                  : null}
                {Object.keys(entry.terminals).map((terminal) => {
                  if (component.kind === 'breadboard') return null;
                  if (component.holeBindings?.[terminal]) return null;
                  const terminalSpec = entry.terminals[terminal];
                  if (!terminalSpec) return null;
                  const point = terminalPosition(
                    component,
                    component.position,
                    terminal,
                    component.rotation ?? 0,
                  );
                  if (!point) return null;
                  const pending =
                    c.pendingTerminal?.componentId === component.id &&
                    c.pendingTerminal.terminal === terminal;
                  const connected = c.terminalConnectionCount(component.id, terminal) > 0;
                  return (
                    <g
                      key={terminal}
                      className={`workbench-terminal${pending ? ' pending' : ''}${
                        connected ? ' connected' : ''
                      }`}
                      transform={`translate(${point.x} ${point.y})`}
                      data-connected={connected ? 'true' : 'false'}
                    >
                      <circle
                        className="workbench-terminal-hit"
                        r={8 / c.viewport.zoom}
                        data-terminal-component-id={component.id}
                        data-terminal-id={terminal}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          c.clickTerminal(component.id, terminal);
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${entry.label}: вывод ${terminalSpec.label}, ${
                          connected ? 'подключён' : 'свободен'
                        }`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            c.clickTerminal(component.id, terminal);
                          }
                        }}
                      />
                      <rect
                        className="workbench-terminal-dot"
                        x={-5 / c.viewport.zoom}
                        y={-5 / c.viewport.zoom}
                        width={10 / c.viewport.zoom}
                        height={10 / c.viewport.zoom}
                        rx={1 / c.viewport.zoom}
                        vectorEffect="non-scaling-stroke"
                      />
                      {(() => {
                        const label = terminalSpec.label;
                        const tooltip = tooltipPlacement(label, point, c.viewBox, c.viewport.zoom);
                        return (
                          <g className="workbench-terminal-tooltip">
                            <text
                              x={tooltip.x + tooltip.width / 2}
                              y={tooltip.textY}
                              fontSize={12 / c.viewport.zoom}
                            >
                              {label}
                            </text>
                          </g>
                        );
                      })()}
                    </g>
                  );
                })}
              </g>
            );
          })}
        <g className="workbench-wire-layer workbench-wire-overlay" data-testid="wire-layer">
          {routedWires.map(({ wire, path, selected }) => {
            return (
              <g key={wire.id}>
                {/* No non-scaling-stroke on the wire itself. A wire is a physical
                    object: zoom in and it should thicken along with the parts it
                    connects. Pinning its width to screen pixels made it look like
                    a hair stretched across magnified components. The hit path
                    keeps a constant screen width, because that one is a target for
                    the pointer rather than a thing being looked at. */}
                {selected ? <path className="workbench-wire-selection" d={path} /> : null}
                <path
                  data-testid="schematic-wire"
                  data-wire-id={wire.id}
                  className="workbench-wire"
                  d={path}
                  stroke={wire.color ?? '#e3212b'}
                  pointerEvents="none"
                />
                {selected
                  ? (wire.vertices ?? []).map((vertex, index) => (
                      <circle
                        key={`${wire.id}-vertex-${index}`}
                        className={`workbench-wire-vertex${
                          c.selection?.kind === 'wire' &&
                          c.selection.id === wire.id &&
                          c.selection.vertexIndex === index
                            ? ' active'
                            : ''
                        }`}
                        cx={vertex.x}
                        cy={vertex.y}
                        r={4.5 / c.viewport.zoom}
                        fill={wire.color ?? '#e3212b'}
                        data-testid="wire-vertex"
                        data-wire-id={wire.id}
                        data-wire-vertex-index={index}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          const previous = lastVertexClick.current;
                          const repeated =
                            previous?.wireId === wire.id &&
                            previous.vertexIndex === index &&
                            isRepeatedClick(previous, event);
                          if (event.detail >= 2 || repeated) {
                            lastVertexClick.current = null;
                            c.removeWireVertexAt(wire.id, index);
                            return;
                          }
                          lastVertexClick.current = {
                            wireId: wire.id,
                            vertexIndex: index,
                            x: event.clientX,
                            y: event.clientY,
                            at: Date.now(),
                          };
                          c.startVertexDrag(event, wire.id, index);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Delete' || event.key === 'Backspace') {
                            event.preventDefault();
                            event.stopPropagation();
                            c.removeWireVertexAt(wire.id, index);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`Изгиб провода ${index + 1}`}
                      />
                    ))
                  : null}
              </g>
            );
          })}
          {c.pendingStart && c.wirePreviewEnd ? (
            <path
              className="workbench-wire-preview"
              d={roundedWirePath(wirePoints(c.pendingStart, c.wirePreviewEnd, c.wireDraftVertices))}
              stroke={c.activeWireColor}
            />
          ) : null}
        </g>
        {selectedWire && selectedWireFrom && selectedWireTo ? (
          <g className="workbench-wire-control-layer" data-testid="wire-control-layer">
            {(
              [
                ['from', selectedWireFrom],
                ['to', selectedWireTo],
              ] as const
            ).map(([endpoint, point]) => (
              <circle
                key={endpoint}
                className="workbench-wire-endpoint"
                data-testid="wire-endpoint"
                data-wire-id={selectedWire.id}
                data-wire-endpoint={endpoint}
                cx={point.x}
                cy={point.y}
                r={5 / c.viewport.zoom}
                fill={selectedWire.color ?? '#e3212b'}
                onPointerDown={(event) => c.startEndpointDrag(event, selectedWire.id, endpoint)}
                role="button"
                tabIndex={0}
                aria-label={`${endpoint === 'from' ? 'Начало' : 'Конец'} провода`}
              />
            ))}
          </g>
        ) : null}
        {c.catalogPlacementComponent ? (
          <g
            className="workbench-placement-preview"
            transform={componentTransform(c.catalogPlacementComponent)}
            data-testid="catalog-placement-preview"
          >
            {(() => {
              const entry = catalogEntry(c.catalogPlacementComponent);
              if (!entry) return null;
              const size = renderedSize(entry, 0);
              return (
                <ProductionComponentVisual
                  entry={entry}
                  component={c.catalogPlacementComponent}
                  width={size.width}
                  height={size.height}
                  visualState="default"
                  effectiveBrightness={0}
                />
              );
            })()}
          </g>
        ) : null}
        {c.marquee ? (
          <rect
            className="workbench-marquee"
            x={Math.min(c.marquee.start.x, c.marquee.current.x)}
            y={Math.min(c.marquee.start.y, c.marquee.current.y)}
            width={Math.abs(c.marquee.current.x - c.marquee.start.x)}
            height={Math.abs(c.marquee.current.y - c.marquee.start.y)}
          />
        ) : null}
      </svg>
      {document.components.filter((item) => item.kind !== 'wire').length === 0 ? (
        <div className="workbench-empty-stage">
          <CircuitIcon />
          <h2>Рабочее поле пустое</h2>
          <p>Перетащите компоненты из библиотеки справа или нажмите на карточку компонента.</p>
        </div>
      ) : null}
      <div className="workbench-stage-controls">
        <button type="button" onClick={c.fitScene} aria-label="Подогнать проект">
          <FitIcon />
        </button>
        <button type="button" onClick={() => c.zoomBy(1.18)} aria-label="Увеличить масштаб">
          <ZoomInIcon />
        </button>
        <button type="button" onClick={() => c.zoomBy(0.85)} aria-label="Уменьшить масштаб">
          <ZoomOutIcon />
        </button>
        <span aria-label={`Масштаб ${Math.round(c.viewport.zoom * 100)} процентов`}>
          {Math.round(c.viewport.zoom * 100)}%
        </span>
      </div>
    </section>
  );
}
