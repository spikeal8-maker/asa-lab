import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Terminal } from '../api';
import { catalogEntry, renderedSize, terminalPosition, visualAsset } from './component-catalog';
import { roundedOrthogonalPath, wirePoints } from './workbench-geometry';
import { CircuitIcon, FitIcon, MoreIcon, ZoomInIcon, ZoomOutIcon } from './workbench-icons';
import { componentTransform } from './workbench-model';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

export function WorkbenchStage({
  controller: c,
}: {
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const document = c.document!;
  return (
    <section className="workbench-stage" aria-label="Рабочее поле электронной схемы">
      <svg
        ref={c.stageRef}
        className={`workbench-canvas${c.panning ? ' panning' : ''}`}
        viewBox={`${c.viewBox.x} ${c.viewBox.y} ${c.viewBox.width} ${c.viewBox.height}`}
        preserveAspectRatio="xMidYMid slice"
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
            <path d="M20 0H0V20" fill="none" stroke="#e8ebef" strokeWidth="1" />
          </pattern>
          <pattern id="asa-grid-large" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="url(#asa-grid-small)" />
            <path d="M100 0H0V100" fill="none" stroke="#dadde3" strokeWidth="1.2" />
          </pattern>
          <filter id="asa-selection-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#137db6" floodOpacity=".28" />
          </filter>
        </defs>
        <rect
          className="workbench-grid-hit"
          x="-4000"
          y="-3000"
          width="9000"
          height="7000"
          fill="url(#asa-grid-large)"
        />
        <g className="workbench-wire-layer" data-testid="wire-layer">
          {document.connections.map((wire) => {
            const fromComponent = document.components.find(
              (item) => item.id === wire.from.componentId,
            );
            const toComponent = document.components.find((item) => item.id === wire.to.componentId);
            if (!fromComponent || !toComponent) return null;
            const from = terminalPosition(
              fromComponent.kind,
              fromComponent.position,
              wire.from.terminal,
              fromComponent.rotation ?? 0,
            );
            const to = terminalPosition(
              toComponent.kind,
              toComponent.position,
              wire.to.terminal,
              toComponent.rotation ?? 0,
            );
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
        {document.components
          .filter((component) => component.kind !== 'wire')
          .map((component) => {
            const entry = catalogEntry(component.kind);
            if (!entry?.asset || !entry.terminals) return null;
            const baseSize = renderedSize(entry, 0);
            const boxSize = renderedSize(entry, component.rotation ?? 0);
            const selected =
              c.selection?.kind === 'component' && c.selection.ids.includes(component.id);
            const asset = visualAsset(entry, c.componentVisualState(component));
            const diagnostics = [...(c.diagnosticCodesByComponent.get(component.id) ?? [])];
            return (
              <g
                key={component.id}
                className={diagnostics.length > 0 ? 'workbench-component-diagnostic' : undefined}
                data-testid="schematic-component"
                data-kind={component.kind}
                data-diagnostics={diagnostics.join(',')}
                data-x={component.position.x}
                data-y={component.position.y}
              >
                {selected ? (
                  <rect
                    className="workbench-selection-box"
                    x={component.position.x - 8}
                    y={component.position.y - 8}
                    width={boxSize.width + 16}
                    height={boxSize.height + 16}
                    rx="8"
                  />
                ) : null}
                <g
                  className="workbench-part"
                  transform={componentTransform(component)}
                  onPointerDown={(e) => c.startComponentDrag(e, component)}
                  onClick={(e) => {
                    e.stopPropagation();
                    c.selectComponent(component.id, e.shiftKey);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (component.kind === 'switch' || component.kind === 'button') {
                      c.toggleComponentState(component.id);
                    }
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
                  {asset ? (
                    <image
                      href={asset}
                      width={baseSize.width}
                      height={baseSize.height}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  ) : null}
                </g>
                {(Object.keys(entry.terminals) as Terminal[]).map((terminal) => {
                  const terminalSpec = entry.terminals[terminal];
                  if (!terminalSpec) return null;
                  const point = terminalPosition(
                    component.kind,
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
                      <circle className="workbench-terminal-dot" r="5.5" />
                      {selected || c.pendingTerminal ? (
                        <text x="0" y="-12" textAnchor="middle">
                          {terminalSpec.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
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
        <button type="button" onClick={() => c.zoomBy(1.2)} aria-label="Приблизить">
          <ZoomInIcon />
        </button>
        <button type="button" onClick={() => c.zoomBy(0.82)} aria-label="Отдалить">
          <ZoomOutIcon />
        </button>
        <span>{Math.round(c.viewport.zoom * 100)}%</span>
      </div>
      <div className="workbench-stage-status">
        {c.simulationRunning ? <span className="simulation-dot" /> : null}
        <span>{c.simulationRunning ? 'Моделирование запущено' : 'Редактирование'}</span>
        <span>·</span>
        <span>Колесо — масштаб, пробел + перетаскивание — панорама</span>
      </div>
      {c.notice ? (
        <div className="workbench-toast" role="status" aria-live="polite">
          {c.notice}
        </div>
      ) : null}
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
    </section>
  );
}
