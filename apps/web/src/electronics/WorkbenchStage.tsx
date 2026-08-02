import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  catalogEntry,
  componentPointPosition,
  renderedSize,
  terminalPosition,
} from './component-catalog';
import { ProductionComponentVisual } from './ProductionComponentVisual';
import { productionBreadboard } from './production-manifest-adapter';
import { roundedOrthogonalPath, wirePoints } from './workbench-geometry';
import { CircuitIcon, FitIcon, MoreIcon, ZoomInIcon, ZoomOutIcon } from './workbench-icons';
import { componentTransform } from './workbench-model';
import { terminalPositionInDocument } from './workbench-document';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

function contactLabel(kind: string, terminal: string, fallback: string): string {
  if (kind === 'source' && terminal === 'BAT-') return 'Отрицательный';
  if (kind === 'source' && terminal === 'BAT+') return 'Положительный';
  const labels: Readonly<Record<string, string>> = {
    anode: 'Анод',
    cathode: 'Катод',
    common: 'Общий контакт',
    'throw-left': 'Левый контакт',
    'throw-right': 'Правый контакт',
    wiper: 'Движок',
    'terminal-1': 'Контакт 1',
    'terminal-2': 'Контакт 2',
    'lead-1': 'Вывод 1',
    'lead-2': 'Вывод 2',
    L1: 'Контакт 1',
    L2: 'Контакт 2',
  };
  return labels[terminal] ?? fallback;
}

function tooltipWidth(label: string, zoom: number): number {
  return Math.max(58, label.length * 7.4 + 18) / zoom;
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
  return (
    <section className="workbench-stage" aria-label="Рабочее поле электронной схемы">
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
        onDragOver={(e) => e.preventDefault()}
        onDrop={c.handleDrop}
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
        <g className="workbench-wire-layer" data-testid="wire-layer">
          {document.connections.map((wire) => {
            const fromComponent = document.components.find(
              (item) => item.id === wire.from.componentId,
            );
            const toComponent = document.components.find((item) => item.id === wire.to.componentId);
            if (!fromComponent || !toComponent) return null;
            const from = terminalPositionInDocument(document, fromComponent, wire.from.terminal);
            const to = terminalPositionInDocument(document, toComponent, wire.to.terminal);
            if (!from || !to) return null;
            const selected = c.selection?.kind === 'wire' && c.selection.id === wire.id;
            const displayedFrom =
              selected && c.reconnectEndpoint === 'from' && c.wirePreviewEnd
                ? c.wirePreviewEnd
                : from;
            const displayedTo =
              selected && c.reconnectEndpoint === 'to' && c.wirePreviewEnd ? c.wirePreviewEnd : to;
            const path = roundedOrthogonalPath(
              wirePoints(displayedFrom, displayedTo, wire.vertices),
            );
            return (
              <g key={wire.id}>
                <path
                  className="workbench-wire-hit"
                  d={path}
                  vectorEffect="non-scaling-stroke"
                  onClick={(e) => {
                    e.stopPropagation();
                    c.setSelection({ kind: 'wire', id: wire.id });
                  }}
                  onDoubleClick={(event) => c.addWireVertexAt(event, wire.id)}
                />
                {selected
                  ? (wire.vertices ?? []).map((vertex, index) => (
                      <circle
                        key={`${wire.id}-vertex-${index}`}
                        className="workbench-wire-vertex"
                        cx={vertex.x}
                        cy={vertex.y}
                        r={5 / c.viewport.zoom}
                        fill={wire.color ?? '#e3212b'}
                        onPointerDown={(event) => c.startVertexDrag(event, wire.id, index)}
                        aria-label={`Изгиб провода ${index + 1}`}
                      />
                    ))
                  : null}
                {selected ? (
                  <path
                    className="workbench-wire-selection"
                    d={path}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                <path
                  data-testid="schematic-wire"
                  className="workbench-wire"
                  d={path}
                  stroke={wire.color ?? '#e3212b'}
                  vectorEffect="non-scaling-stroke"
                  onClick={(e) => {
                    e.stopPropagation();
                    c.setSelection({ kind: 'wire', id: wire.id });
                  }}
                  onDoubleClick={(event) => c.addWireVertexAt(event, wire.id)}
                />
              </g>
            );
          })}
          {c.pendingStart && c.wirePreviewEnd ? (
            <path
              className="workbench-wire-preview"
              d={roundedOrthogonalPath(
                wirePoints(c.pendingStart, c.wirePreviewEnd, c.wireDraftVertices),
              )}
              stroke={c.activeWireColor}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
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
            const diagnostics = [...(c.diagnosticCodesByComponent.get(component.id) ?? [])];
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
                  <ProductionComponentVisual
                    entry={entry}
                    component={component}
                    width={baseSize.width}
                    height={baseSize.height}
                    visualState={visualState}
                    effectiveBrightness={c.componentLedBrightness(component)}
                    selected={selected}
                    selectionOffset={1.6 / c.viewport.zoom}
                    simulationRunning={c.simulationRunning}
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
                {component.kind === 'breadboard'
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
                            <g
                              className="workbench-terminal-tooltip"
                              transform={`translate(${point.x} ${point.y - 14 / c.viewport.zoom})`}
                            >
                              <rect
                                x={-tooltipWidth(hole.id, c.viewport.zoom) / 2}
                                y={-22 / c.viewport.zoom}
                                width={tooltipWidth(hole.id, c.viewport.zoom)}
                                height={22 / c.viewport.zoom}
                                rx={2 / c.viewport.zoom}
                              />
                              <text y={-7 / c.viewport.zoom} fontSize={12 / c.viewport.zoom}>
                                {hole.id}
                              </text>
                            </g>
                            <circle
                              className="workbench-breadboard-hole"
                              cx={point.x}
                              cy={point.y}
                              r="2.3"
                            >
                              <title>{hole.id}</title>
                            </circle>
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
                  return (
                    <g
                      key={terminal}
                      className={`workbench-terminal${pending ? ' pending' : ''}`}
                      transform={`translate(${point.x} ${point.y})`}
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
                        aria-label={`${entry.label}: вывод ${terminalSpec.label}`}
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
                        const label = contactLabel(component.kind, terminal, terminalSpec.label);
                        return (
                          <g
                            className="workbench-terminal-tooltip"
                            transform={`translate(0 ${-14 / c.viewport.zoom})`}
                          >
                            <rect
                              x={-tooltipWidth(label, c.viewport.zoom) / 2}
                              y={-22 / c.viewport.zoom}
                              width={tooltipWidth(label, c.viewport.zoom)}
                              height={22 / c.viewport.zoom}
                              rx={2 / c.viewport.zoom}
                            />
                            <text y={-7 / c.viewport.zoom} fontSize={12 / c.viewport.zoom}>
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
                cx={point.x}
                cy={point.y}
                r={6 / c.viewport.zoom}
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
      {c.notice ? (
        <div className="workbench-toast" role="status" aria-live="polite">
          {c.notice}
        </div>
      ) : null}
      {c.simulationRunning ? (
        <aside className="workbench-results" aria-label="Результаты моделирования">
          <button type="button" className="workbench-results-toggle" title="Результаты">
            <MoreIcon />
          </button>
          <div className="workbench-results-card">
            <strong>Ток</strong>
            <span data-testid="current-reading">
              {c.simulationRunning && c.result?.solved
                ? `${(c.result.current * 1000).toFixed(1)} мА`
                : '—'}
            </span>
            <ul data-testid="diagnostics">
              {(c.result?.diagnostics ?? []).slice(0, 3).map((d, i) => (
                <li key={`${d.code}-${i}`} className={d.severity}>
                  <span>{d.message}</span>
                  {d.suggestedAction ? <small>{d.suggestedAction}</small> : null}
                </li>
              ))}
            </ul>
            {c.versions.length > 0 ? (
              <small>Последняя версия: №{c.versions[0]?.versionNo}</small>
            ) : null}
          </div>
        </aside>
      ) : null}
    </section>
  );
}
