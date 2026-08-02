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
  const selectedLandingHoles = new Set(
    c.selection?.kind === 'component'
      ? document.components
          .filter(
            (component) =>
              c.selection?.kind === 'component' && c.selection.ids.includes(component.id),
          )
          .flatMap((component) =>
            Object.values(component.holeBindings ?? {}).map(
              (binding) => `${binding.breadboardComponentId}:${binding.holeId}`,
            ),
          )
      : [],
  );
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
            const path = roundedOrthogonalPath(wirePoints(from, to, wire.vertices));
            const selected = c.selection?.kind === 'wire' && c.selection.id === wire.id;
            return (
              <g key={wire.id}>
                <path
                  className="workbench-wire-hit"
                  d={path}
                  onClick={(e) => {
                    e.stopPropagation();
                    c.setSelection({ kind: 'wire', id: wire.id });
                  }}
                />
                {selected
                  ? (wire.vertices ?? []).map((vertex, index) => (
                      <circle
                        key={`${wire.id}-vertex-${index}`}
                        className="workbench-wire-vertex"
                        cx={vertex.x}
                        cy={vertex.y}
                        r="9"
                        onPointerDown={(event) => c.startVertexDrag(event, wire.id, index)}
                        aria-label={`Изгиб провода ${index + 1}`}
                      />
                    ))
                  : null}
                {selected ? <path className="workbench-wire-selection" d={path} /> : null}
                <path
                  data-testid="schematic-wire"
                  className="workbench-wire"
                  d={path}
                  stroke={wire.color ?? '#e3212b'}
                  onClick={(e) => {
                    e.stopPropagation();
                    c.setSelection({ kind: 'wire', id: wire.id });
                  }}
                />
              </g>
            );
          })}
          {c.pendingStart && c.wirePreviewEnd ? (
            <path
              className="workbench-wire-preview"
              d={roundedOrthogonalPath(wirePoints(c.pendingStart, c.wirePreviewEnd))}
              stroke={c.activeWireColor}
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
                        const landing = selectedLandingHoles.has(`${component.id}:${hole.id}`);
                        return (
                          <g
                            key={hole.id}
                            className={`workbench-breadboard-terminal${pending ? ' pending' : ''}${connected ? ' connected' : ''}${landing ? ' landing' : ''}`}
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
                        r="13"
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
                      <circle className="workbench-terminal-dot" r="3" />
                    </g>
                  );
                })}
              </g>
            );
          })}
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
