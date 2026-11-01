import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  ElectronicsDisplayArtifact,
  ElectronicsSimulationArtifact,
  PublicDisplayComponent,
} from '@asa-lab/contracts';
import type { SchematicComponent } from '../api';
import { catalogEntry, renderedSize, terminalPosition } from '../electronics/component-catalog';
import {
  NativeOpticalProvider,
  ProductionComponentVisual,
} from '../electronics/NativeOpticalComponentVisual';
import { NativeOpticalPresentation } from '../electronics/native-optical-presentation';
import { ordinaryLedVisualState } from '../electronics/component-result-presentation';
import { PublicElectronicsRuntime, publicSimulationDocument } from './electronics-public-runtime';
import { componentTransform } from '../electronics/workbench-model';
import { roundedWirePath, wirePoints } from '../electronics/workbench-geometry';

const PublishedBlocks = lazy(() =>
  import('./PublicArduinoBlocks').then((m) => ({ default: m.PublicArduinoBlocks })),
);

/** Reconstruct only validated display fields; never accept an editor property bag. */
export function publicDisplayComponentModel(source: PublicDisplayComponent): SchematicComponent {
  const visual = source.visualProperties;
  const properties = Object.freeze({
    ...(visual?.mirrorX !== undefined ? { mirrorX: visual.mirrorX } : {}),
    ...(visual?.mirrorY !== undefined ? { mirrorY: visual.mirrorY } : {}),
    ...(visual?.pinLayout !== undefined ? { pinLayout: visual.pinLayout } : {}),
  });
  const component: SchematicComponent = {
    id: source.id,
    kind: source.kind,
    value: source.value,
    position: Object.freeze({ ...source.position }),
    ...(source.componentTypeId !== undefined ? { componentTypeId: source.componentTypeId } : {}),
    ...(source.variantId !== undefined ? { variantId: source.variantId } : {}),
    ...(source.rotation !== undefined ? { rotation: source.rotation } : {}),
    ...(source.name !== undefined ? { name: source.name } : {}),
    ...(source.state !== undefined ? { state: source.state } : {}),
    ...(source.pinIds ? { pinIds: [...source.pinIds] } : {}),
    stateProperties: properties,
  };
  if (component.pinIds) Object.freeze(component.pinIds);
  return Object.freeze(component);
}

/** A frozen presentation model; no editor, document state or runtime is mounted. */
export function ElectronicsPublicationScene({
  artifact,
}: {
  readonly artifact: ElectronicsDisplayArtifact | ElectronicsSimulationArtifact;
}): JSX.Element {
  const [runtime, setRuntime] = useState<PublicElectronicsRuntime | null>(null);
  const [message, setMessage] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const programs =
    artifact.schemaVersion === 3
      ? artifact.components.filter((c) => typeof c.stateProperties?.arduinoSource === 'string')
      : [];
  const [inputs, setInputs] = useState<ReadonlyMap<string, SchematicComponent>>(new Map());
  const idlePort = useMemo(() => new NativeOpticalPresentation(), []);
  const section = useRef<HTMLElement>(null);
  const activeRuntime = useRef<PublicElectronicsRuntime | null>(null);
  const stop = () => activeRuntime.current?.dispose();
  const start = () => {
    if (artifact.schemaVersion !== 3 || activeRuntime.current) return;
    setMessage('');
    const next = new PublicElectronicsRuntime(artifact, (reason) => {
      if (activeRuntime.current !== next) return;
      activeRuntime.current = null;
      setRuntime(null);
      setInputs(new Map());
      setMessage(reason ?? '');
    });
    activeRuntime.current = next;
    setRuntime(next);
    next.start();
  };
  useEffect(() => {
    setRuntime(null);
    setInputs(new Map());
    const background = () => {
      if (document.hidden) activeRuntime.current?.stop('Просмотр приостановлен в фоновой вкладке.');
    };
    const blur = () => activeRuntime.current?.stop('Просмотр остановлен при потере фокуса.');
    document.addEventListener('visibilitychange', background);
    window.addEventListener('blur', blur);
    return () => {
      const previous = activeRuntime.current;
      activeRuntime.current = null;
      previous?.dispose();
      document.removeEventListener('visibilitychange', background);
      window.removeEventListener('blur', blur);
    };
  }, [artifact]);
  const input = (id: string, patch: Pick<SchematicComponent, 'state' | 'wiperPosition'>) => {
    const updated = activeRuntime.current?.input(id, patch);
    if (updated) setInputs((current) => new Map(current).set(id, updated));
  };
  const scene = useMemo(() => {
    const simulation = artifact.schemaVersion === 3 ? publicSimulationDocument(artifact) : null;
    const components = artifact.components.map((source, index) => {
      const component =
        inputs.get(source.id) ??
        simulation?.components[index] ??
        publicDisplayComponentModel(source);
      const entry = catalogEntry(component);
      if (!entry) throw new Error('Unsupported public component');
      return Object.freeze({
        component,
        entry,
        size: renderedSize(entry),
        bounds: renderedSize(entry, component.rotation),
      });
    });
    const indexed = new Map(components.map((item) => [item.component.id, item]));
    const wires = artifact.connections.map((wire) => {
      const from = indexed.get(wire.from.componentId)?.component;
      const to = indexed.get(wire.to.componentId)?.component;
      const a = from && terminalPosition(from, from.position, wire.from.terminal, from.rotation);
      const b = to && terminalPosition(to, to.position, wire.to.terminal, to.rotation);
      if (!a || !b) throw new Error('Unsupported public terminal');
      return Object.freeze({
        id: wire.id,
        color: wire.color ?? '#287b63',
        points: Object.freeze(
          wirePoints(a, b, wire.vertices).map((point) => Object.freeze({ ...point })),
        ),
      });
    });
    const points = [
      ...components.flatMap(({ component: c, bounds }) => [
        c.position,
        { x: c.position.x + bounds.width, y: c.position.y + bounds.height },
      ]),
      ...wires.flatMap((wire) => wire.points),
    ];
    const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
    const minY = points.length ? Math.min(...points.map((point) => point.y)) : 0;
    const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 200;
    const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 150;
    const width = Math.max(320, maxX - minX + 80);
    const height = Math.max(width / 1.6, maxY - minY + 80);
    return {
      components: Object.freeze(components),
      wires: Object.freeze(wires),
      fit: { x: minX - 40, y: minY - 40, width, height },
    };
  }, [artifact, inputs]);
  const [view, setView] = useState(scene.fit);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const zoom = (factor: number) =>
    setView((current) => {
      const width = Math.max(
        scene.fit.width / 8,
        Math.min(scene.fit.width * 4, current.width * factor),
      );
      const height = (width * current.height) / current.width;
      return {
        x: current.x + (current.width - width) / 2,
        y: current.y + (current.height - height) / 2,
        width,
        height,
      };
    });
  return (
    <section
      ref={section}
      className="public-electronics-viewer"
      data-testid="public-electronics-viewer"
      aria-label="Опубликованная электрическая схема"
    >
      <div className="public-electronics-tools" role="toolbar" aria-label="Просмотр схемы">
        <span>Схема · просмотр</span>
        {artifact.schemaVersion === 3 ? (
          <>
            <button
              type="button"
              data-testid="public-electronics-start"
              onClick={runtime ? stop : start}
            >
              {runtime ? 'Стоп' : 'Начать'}
            </button>
          </>
        ) : null}
        {programs.length ? (
          <button
            type="button"
            aria-label="Код Arduino"
            title="Код Arduino"
            aria-expanded={codeOpen}
            onClick={() => setCodeOpen(!codeOpen)}
          >
            <span className="public-code-label-full">Код Arduino</span>
            <span className="public-code-label-short" aria-hidden="true">
              Код
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className="public-electronics-more"
          aria-label="Инструменты просмотра"
          title="Инструменты просмотра"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((v) => !v)}
        >
          •••
        </button>
        <div className={`public-electronics-secondary-tools${toolsOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            data-testid="public-electronics-reset"
            aria-label="Сброс"
            title="Сброс"
            onClick={() => {
              stop();
              setInputs(new Map());
              setMessage('');
            }}
          >
            ↺
          </button>{' '}
          <button
            type="button"
            data-testid="public-electronics-zoom-out"
            aria-label="Уменьшить схему"
            onClick={() => zoom(1.25)}
          >
            −
          </button>
          <output aria-label="Масштаб">{Math.round((scene.fit.width / view.width) * 100)}%</output>
          <button
            type="button"
            data-testid="public-electronics-zoom-in"
            aria-label="Увеличить схему"
            onClick={() => zoom(0.8)}
          >
            +
          </button>
          <button
            type="button"
            data-testid="public-electronics-fit"
            aria-label="Вписать схему"
            title="Вписать схему"
            onClick={() => setView(scene.fit)}
          >
            ⊡
          </button>
          <button
            type="button"
            aria-label="На весь экран"
            onClick={() => {
              void (
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : section.current?.requestFullscreen()
              )?.catch(() => setMessage('Полноэкранный режим недоступен.'));
            }}
          >
            ⛶
          </button>{' '}
        </div>
      </div>
      {message ? (
        <p role="status" className="public-electronics-hint">
          {message}
        </p>
      ) : null}
      <NativeOpticalProvider port={runtime?.port ?? idlePort}>
        <svg
          data-testid="public-electronics-scene"
          className="public-electronics-scene"
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          tabIndex={0}
          role={artifact.schemaVersion === 3 ? 'group' : 'img'}
          aria-label="Схема. Стрелки перемещают, плюс и минус меняют масштаб, Home вписывает схему. На сенсорном экране перемещайте схему по горизонтали."
          onKeyDown={(event) => {
            const direction = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            }[event.key];
            if (direction) {
              event.preventDefault();
              setView((current) => ({
                ...current,
                x: current.x + (direction[0]! * current.width) / 10,
                y: current.y + (direction[1]! * current.height) / 10,
              }));
            } else if (['+', '=', '-', 'Home'].includes(event.key)) {
              event.preventDefault();
              if (event.key === 'Home') setView(scene.fit);
              else zoom(event.key === '-' ? 1.25 : 0.8);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            drag.current = { ...start, x: event.clientX, y: event.clientY };
            if (rect.width && rect.height)
              setView((current) => {
                const scale = Math.min(rect.width / current.width, rect.height / current.height);
                return {
                  ...current,
                  x: current.x - dx / scale,
                  y: current.y - (event.pointerType === 'touch' ? 0 : dy / scale),
                };
              });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <g data-testid="public-electronics-viewport">
            {scene.wires.map((wire) => (
              <path
                key={wire.id}
                data-testid="public-electronics-wire"
                data-wire-id={wire.id}
                d={roundedWirePath(wire.points)}
                fill="none"
                stroke={wire.color}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ))}
            {scene.components.map(({ component, entry, size }) => (
              <g
                key={component.id}
                data-testid="public-electronics-component"
                data-component-id={component.id}
                transform={componentTransform(component)}
              >
                <PublicComponentVisual
                  component={component}
                  entry={entry}
                  width={size.width}
                  height={size.height}
                  runtime={runtime}
                />
                {runtime && ['button', 'switch', 'potentiometer'].includes(component.kind) ? (
                  <rect
                    data-testid={`public-input-${component.id}`}
                    width={size.width}
                    height={size.height}
                    fill="transparent"
                    role={component.kind === 'potentiometer' ? 'slider' : 'button'}
                    tabIndex={0}
                    aria-label={component.name ?? component.kind}
                    aria-pressed={
                      component.kind === 'button' || component.kind === 'switch'
                        ? component.state === true
                        : undefined
                    }
                    aria-valuemin={component.kind === 'potentiometer' ? 0 : undefined}
                    aria-valuemax={component.kind === 'potentiometer' ? 100 : undefined}
                    aria-valuenow={
                      component.kind === 'potentiometer'
                        ? Math.round((component.wiperPosition ?? 0.5) * 100)
                        : undefined
                    }
                    style={{ cursor: 'pointer', touchAction: 'none' }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      if (event.button !== 0) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      if (component.kind === 'button') input(component.id, { state: true });
                      else if (component.kind === 'switch')
                        input(component.id, { state: !component.state });
                      else
                        input(component.id, {
                          wiperPosition:
                            (component.wiperPosition ?? 0.5) + 0.1 > 1
                              ? 0
                              : (component.wiperPosition ?? 0.5) + 0.1,
                        });
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      if (component.kind === 'button') input(component.id, { state: false });
                    }}
                    onPointerCancel={() => {
                      if (component.kind === 'button') input(component.id, { state: false });
                    }}
                    onLostPointerCapture={() => {
                      if (component.kind === 'button') input(component.id, { state: false });
                    }}
                    onBlur={() => {
                      if (component.kind === 'button') input(component.id, { state: false });
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (
                        component.kind === 'potentiometer' &&
                        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                      ) {
                        event.preventDefault();
                        input(component.id, {
                          wiperPosition: Math.max(
                            0,
                            Math.min(
                              1,
                              (component.wiperPosition ?? 0.5) +
                                (['ArrowRight', 'ArrowUp'].includes(event.key) ? 0.05 : -0.05),
                            ),
                          ),
                        });
                      } else if ([' ', 'Enter'].includes(event.key)) {
                        event.preventDefault();
                        if (!event.repeat && component.kind !== 'potentiometer')
                          input(component.id, {
                            state: component.kind === 'button' ? true : !component.state,
                          });
                      }
                    }}
                    onKeyUp={(event) => {
                      event.stopPropagation();
                      if (
                        [' ', 'Enter'].includes(event.key) &&
                        component.kind === 'button' &&
                        component.state
                      ) {
                        event.preventDefault();
                        input(component.id, { state: false });
                      }
                    }}
                  />
                ) : null}
              </g>
            ))}
          </g>
        </svg>
      </NativeOpticalProvider>
      <p className="public-electronics-hint">
        {artifact.schemaVersion === 2 ? 'Для этой версии доступен только просмотр. ' : ''}
        Перетаскивайте схему · Масштаб + / − · Home — вписать
      </p>
      {codeOpen ? (
        <aside className="public-electronics-code" aria-label="Код Arduino">
          <div className="public-electronics-code-heading">
            <h2>Код Arduino</h2>
            <button type="button" onClick={() => setCodeOpen(false)} aria-label="Закрыть код">
              ×
            </button>
          </div>
          {programs.map((c) => (
            <div key={c.id}>
              <h3>{c.name ?? 'Arduino'}</h3>
              {['blocks', 'blocks-text'].includes(String(c.stateProperties?.arduinoCodeMode)) ? (
                typeof c.stateProperties?.arduinoBlocks === 'string' ? (
                  <Suspense fallback={<p role="status">Загружаем блоки…</p>}>
                    <PublishedBlocks value={c.stateProperties.arduinoBlocks} />
                  </Suspense>
                ) : (
                  <p role="status">
                    В этой опубликованной версии структура блоков не сохранена. Автор может обновить
                    публикацию из редактора.
                  </p>
                )
              ) : (
                <pre>
                  <code>{String(c.stateProperties?.arduinoSource)}</code>
                </pre>
              )}
              {c.stateProperties?.arduinoCodeMode === 'blocks-text' ? (
                <details>
                  <summary>Сгенерированный текст</summary>
                  <pre>
                    <code>{String(c.stateProperties.arduinoSource)}</code>
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
        </aside>
      ) : null}
    </section>
  );
}

export function PublicComponentVisual({
  runtime,
  ...props
}: Omit<Parameters<typeof ProductionComponentVisual>[0], 'visualState' | 'simulationRunning'> & {
  runtime: PublicElectronicsRuntime | null;
}) {
  const idle = useMemo(() => new NativeOpticalPresentation(), []);
  const port = runtime?.port ?? idle;
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const result = port.resultMap(snapshot.committed).get(props.component.id);
  const state =
    props.component.kind === 'led' && runtime
      ? ordinaryLedVisualState(result)
      : props.component.kind === 'button'
        ? props.component.state
          ? 'pressed'
          : 'default'
        : props.component.kind === 'switch'
          ? props.component.state
            ? 'on'
            : 'off'
          : 'default';
  return (
    <ProductionComponentVisual
      {...props}
      visualState={state}
      result={result}
      simulationRunning={Boolean(runtime)}
      simulationTimeMs={(snapshot.committed?.frame.atMicroseconds ?? 0) / 1000}
      {...(runtime ? { onLedAssetReadiness: runtime.assetReadiness } : {})}
    />
  );
}
