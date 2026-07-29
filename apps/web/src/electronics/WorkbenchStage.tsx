import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  catalogEntry,
  componentPhysicalSummary,
  renderedSize,
  terminalPosition,
  visualAsset,
} from './component-catalog';
import { roundedOrthogonalPath, wirePoints } from './workbench-geometry';
import { CircuitIcon, FitIcon, MoreIcon, ZoomInIcon, ZoomOutIcon } from './workbench-icons';
import { componentTransform } from './workbench-model';
import {
  BREADBOARD_PITCH_MM,
  BREADBOARD_PITCH_UNITS,
  HALF_PITCH_UNITS,
} from './workbench-scale';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

export function WorkbenchStage({
  controller: c,
}: {
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const document = c.document!;
  const majorPitch = BREADBOARD_PITCH_UNITS * 5;
  return (
    <section className="workbench-stage" aria-label="Рабочее поле электронной схемы">
      <svg
        ref={c.stageRef}
        className={`workbench-canvas${c.panning ? ' panning' : ''}`}
        viewBox={`${c.viewBox.x} ${c.viewBox.y} ${c.viewBox.width} ${c.viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={c.startPan}
        onPointerMove={c.handlePointerMove}
        onPointerUp={c.finishPointer}
        onPointerCancel={c.finishPointer}
        onWheel={c.handleWheel}
        onDragOver={(event) => event.preventDefault()}
        onDrop={c.handleDrop}
      >
        <defs>
          <pattern
            id="asa-grid-half-pitch"
            width={HALF_PITCH_UNITS}
            height={HALF_PITCH_UNITS}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M${HALF_PITCH_UNITS} 0H0V${HALF_PITCH_UNITS}`}
              fill="none"
              stroke="#eef0f2"
              strokeWidth="0.7"
            />
          </pattern>
          <pattern
            id="asa-grid-breadboard-pitch"
            width={BREADBOARD_PITCH_UNITS}
            height={BREADBOARD_PITCH_UNITS}
            patternUnits="userSpaceOnUse"
          >
            <rect
              width={BREADBOARD_PITCH_UNITS}
              height={BREADBOARD_PITCH_UNITS}
              fill="url(#asa-grid-half-pitch)"
            />
            <path
              d={`M${BREADBOARD_PITCH_UNITS} 0H0V${BREADBOARD_PITCH_UNITS}`}
              fill="none"
              stroke="#dfe3e7"
              strokeWidth="1"
            />
          </pattern>
          <pattern
            id="asa-grid-major"
            width={majorPitch}
            height={majorPitch}
            patternUnits="userSpaceOnUse"
          >
            <rect width={majorPitch} height={majorPitch} fill="url(#asa-grid-breadboard-pitch)" />
            <path
              d={`M${majorPitch} 0H0V${majorPitch}`}
              fill="none"
              stroke="#cfd5db"
              strokeWidth="1.25"
            />
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
          fill="url(#asa-grid-major)"
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
              <g key={wire.id} data-wire-id={wire.id}>
                <path
                  className="workbench-wire-hit"
                  d={path}
                  onClick={(event) => {
                    event.stopPropagation();
                    c.setSelection({ kind: 'wire', id: wire.id });
                  }}
                />
                {selected ? <path className="workbench-wire-selection" d={path} /> : null}
                <path
                  data-testid="schematic-wire"
                  className="workbench-wire"
                  d={path}
                  stroke={wire.color ?? '#e3212b'}
                  onClick={(event) => {
                    event.stopPropagation();
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
            const selected = c.selection?.kind === 'component' && c.selection.id === component.id;
            const asset = visualAsset(entry, c.componentVisualState(component));
            return (
              <g
                key={component.id}
                data-testid="schematic-component"
                data-kind={component.kind}
                data-component-id={component.id}
                data-x={component.position.x}
                data-y={component.position.y}
                data-physical={componentPhysicalSummary(entry)}
                data-physical-evidence={entry.physical.evidence}
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
                  onPointerDown={(event) => c.startComponentDrag(event, component)}
                  onClick={(event) => {
                    event.stopPropagation();
                    c.setSelection({ kind: 'component', id: component.id });
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${entry.label}. ${componentPhysicalSummary(entry)}. Перетащите для перемещения.`}
                  onKeyDown={(event: ReactKeyboardEvent<SVGGElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      c.setSelection({ kind: 'component', id: component.id });
                    }
                  }}
                >
                  {asset ? (
                    <image
                      href={asset}
                      width={baseSize.width}
                      height={baseSize.height}
                      preserveAspectRatio="xMidYMid meet"
                      pointerEvents="none"
                    />
                  ) : null}
                </g>
                {(['a', 'b'] as const).map((terminal) => {
                  const point = terminalPosition(
                    component.kind,
                    component.position,
                    terminal,
                    component.rotation ?? 0,
                  );
                  if (!point) return null;
                  const spec = entry.terminals[terminal];
                  const pending =
                    c.pendingTerminal?.componentId === component.id &&
                    c.pendingTerminal.terminal === terminal;
                  return (
                    <g
                      key={terminal}
                      className={`workbench-terminal${pending ? ' pending' : ''}`}
                      transform={`translate(${point.x} ${point.y})`}
                      data-terminal-id={spec.id}
                      data-terminal-role={spec.role}
                    >
                      <circle
                        className="workbench-terminal-hit"
                        r="14"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          c.clickTerminal(component.id, terminal);
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${entry.label}: вывод ${spec.label}, ${spec.role}`}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            c.clickTerminal(component.id, terminal);
                          }
                        }}
                      />
                      <circle className="workbench-terminal-dot" r="5.5" />
                      {selected || c.pendingTerminal ? (
                        <text x="0" y="-12" textAnchor="middle">
                          {spec.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
      </svg>
      {document.components.filter((item) => item.kind !== 'wire').length === 0 ? (
        <div className="workbench-empty-stage">
          <CircuitIcon />
          <h2>Рабочее поле пустое</h2>
          <p>
            Перетащите компоненты из библиотеки справа. Выводы автоматически привязываются к
            шагу макетной платы 2,54 мм.
          </p>
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
        <span>Сетка {BREADBOARD_PITCH_MM.toFixed(2).replace('.', ',')} мм</span>
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
            {(c.result?.diagnostics ?? []).slice(0, 3).map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`} className={diagnostic.severity}>
                {diagnostic.message}
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
