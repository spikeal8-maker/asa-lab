import { useMemo } from 'react';
import type { SchematicComponent, SchematicDocument } from '../api';
import { catalogEntry } from './component-catalog';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

function SchematicSymbol({ component }: { component: SchematicComponent }): JSX.Element {
  const commonLabel = (
    <>
      <text x="0" y="82" textAnchor="middle">
        {component.name ?? component.kind}
      </text>
      {component.value ? (
        <text x="0" y="98" textAnchor="middle" className="value">
          {component.value}
        </text>
      ) : null}
    </>
  );
  if (component.kind === 'resistor') {
    return (
      <>
        <line x1="-105" y1="35" x2="-66" y2="35" />
        <path d="M-66 35l12-18 18 36 18-36 18 36 18-36 18 36 12-18" />
        <line x1="66" y1="35" x2="105" y2="35" />
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'source') {
    return (
      <>
        <line x1="-105" y1="35" x2="-26" y2="35" />
        <line x1="-26" y1="10" x2="-26" y2="60" />
        <line x1="-9" y1="20" x2="-9" y2="50" />
        <line x1="9" y1="10" x2="9" y2="60" />
        <line x1="26" y1="20" x2="26" y2="50" />
        <line x1="26" y1="35" x2="105" y2="35" />
        <text x="-28" y="5">
          +
        </text>
        <text x="20" y="5">
          −
        </text>
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'led' || component.kind === 'diode') {
    return (
      <>
        <line x1="-105" y1="35" x2="-32" y2="35" />
        <path className="symbol-body" d="M-32 12v46l52-23z" />
        <line x1="20" y1="10" x2="20" y2="60" />
        <line x1="20" y1="35" x2="105" y2="35" />
        {component.kind === 'led' ? (
          <g className="schematic-light-rays">
            <path d="M35 8l17-13" />
            <path d="M45 20l18-13" />
          </g>
        ) : null}
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'switch' || component.kind === 'button') {
    return (
      <>
        <line x1="-105" y1="35" x2="-45" y2="35" />
        <circle cx="-38" cy="35" r="6" />
        <circle cx="38" cy="35" r="6" />
        <line x1="45" y1="35" x2="105" y2="35" />
        <line x1="-32" y1="31" x2="31" y2={component.state ? '35' : '10'} />
        {component.kind === 'button' ? <line x1="0" y1="-8" x2="0" y2="12" /> : null}
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'potentiometer') {
    return (
      <>
        <line x1="-105" y1="35" x2="-66" y2="35" />
        <path d="M-66 35l12-18 18 36 18-36 18 36 18-36 18 36 12-18" />
        <line x1="66" y1="35" x2="105" y2="35" />
        <path d="M0-2v27m0 0l-7-10m7 10l7-10" />
        {commonLabel}
      </>
    );
  }
  return (
    <>
      <line x1="-105" y1="35" x2="-85" y2="35" />
      <rect x="-85" y="0" width="170" height="70" rx="5" />
      <line x1="85" y1="35" x2="105" y2="35" />
      {commonLabel}
    </>
  );
}

export function SchematicView({
  document,
  controller,
}: {
  document: SchematicDocument;
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const components = document.components.filter(
    (component) => component.kind !== 'wire' && component.kind !== 'breadboard',
  );
  const positions = new Map(
    components.map((component, index) => [
      component.id,
      { x: 180 + (index % 4) * 280, y: 180 + Math.floor(index / 4) * 180 },
    ]),
  );
  return (
    <section className="workbench-alternate-view workbench-schematic-view" aria-label="Схема">
      <svg viewBox="0 0 1400 850" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="schematic-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#e7eaed" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1400" height="850" fill="url(#schematic-grid)" />
        {document.connections.map((wire) => {
          const from = positions.get(wire.from.componentId);
          const to = positions.get(wire.to.componentId);
          if (!from || !to) return null;
          return (
            <path
              key={wire.id}
              d={`M${from.x + 85} ${from.y + 35}H${(from.x + to.x) / 2}V${to.y + 35}H${to.x - 85}`}
              className="workbench-schematic-wire"
              style={{ stroke: wire.color ?? '#e3212b' }}
            />
          );
        })}
        {components.map((component) => {
          const position = positions.get(component.id)!;
          const entry = catalogEntry(component);
          const selected =
            controller.selection?.kind === 'component' &&
            controller.selection.ids.includes(component.id);
          return (
            <g
              key={component.id}
              className={`workbench-schematic-symbol${selected ? ' selected' : ''}`}
              transform={`translate(${position.x} ${position.y})`}
              role="button"
              tabIndex={0}
              onClick={() => controller.selectComponent(component.id, false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  controller.selectComponent(component.id, false);
                }
              }}
            >
              <SchematicSymbol
                component={{
                  ...component,
                  name: component.name ?? entry?.label ?? component.kind,
                }}
              />
              {entry?.asset && !entry.simulationSupported && entry.blockReason ? (
                <g
                  className="workbench-schematic-model-warning"
                  transform="translate(78 -7)"
                  role="img"
                  aria-label="Математическая модель ещё не готова"
                >
                  <circle r="11" />
                  <text y="4">!</text>
                  <title>
                    {entry.blockReason ??
                      'Компонент участвует в схеме, но математическая модель ещё не готова.'}
                  </title>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

export function BomView({ document }: { document: SchematicDocument }): JSX.Element {
  const rows = useMemo(() => {
    const grouped = new Map<string, { names: string[]; component: string; count: number }>();
    for (const component of document.components.filter((item) => item.kind !== 'wire')) {
      const entry = catalogEntry(component);
      const key = `${entry?.key ?? component.kind}:${component.variantId ?? ''}:${component.value}`;
      const row = grouped.get(key);
      const name = component.name ?? entry?.label ?? component.kind;
      if (row) {
        row.count += 1;
        row.names.push(name);
      } else {
        const value = component.value ? `${component.value} ${entry?.unit ?? ''}`.trim() : '';
        grouped.set(key, {
          names: [name],
          component: [value, entry?.label ?? component.kind].filter(Boolean).join(' '),
          count: 1,
        });
      }
    }
    return [...grouped.values()].sort((left, right) =>
      left.component.localeCompare(right.component, 'ru'),
    );
  }, [document]);
  return (
    <section
      className="workbench-alternate-view workbench-bom-view"
      aria-label="Список компонентов"
    >
      <div className="workbench-bom-card">
        <h2>Список компонентов</h2>
        <p>{rows.reduce((sum, row) => sum + row.count, 0)} компонентов в проекте</p>
        <table>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Количество</th>
              <th>Компонент</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.component}:${row.names.join(':')}`}>
                <td>
                  {row.names.map((name) => (
                    <div key={name}>{name}</div>
                  ))}
                </td>
                <td>{row.count}</td>
                <td>{row.component}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
