import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const electronicsRoot = resolve(process.cwd(), 'apps/web/src/electronics');
const stageSource = readFileSync(resolve(electronicsRoot, 'WorkbenchStage.tsx'), 'utf8');
const sidebarSource = readFileSync(resolve(electronicsRoot, 'WorkbenchSidebars.tsx'), 'utf8');
const headerSource = readFileSync(resolve(electronicsRoot, 'WorkbenchHeader.tsx'), 'utf8');
const editorSource = readFileSync(resolve(electronicsRoot, '../pages/SchematicEditor.tsx'), 'utf8');
const productionVisualSource = readFileSync(
  resolve(electronicsRoot, 'ProductionComponentVisual.tsx'),
  'utf8',
);
const previewSource = readFileSync(resolve(electronicsRoot, 'component-preview.tsx'), 'utf8');
const workbenchCss = readFileSync(resolve(electronicsRoot, 'workbench.css'), 'utf8');

describe('owner-reference Electronics presentation contract', () => {
  it('keeps idle terminals and breadboard overlays invisible until an active target state', () => {
    expect(stageSource).not.toContain('workbench-snap-link');
    expect(stageSource).toContain('width={10 / c.viewport.zoom}');
    expect(stageSource).toContain('vectorEffect="non-scaling-stroke"');
    expect(stageSource).toContain("? ' wiring' : ''");
    expect(workbenchCss).toMatch(/\.workbench-terminal-dot\s*\{[^}]*opacity:\s*0;/s);
    expect(workbenchCss).toContain('.workbench-canvas.wiring .workbench-terminal-dot');
    expect(workbenchCss).toMatch(/\.workbench-breadboard-hole\s*\{[^}]*opacity:\s*0;/s);
    expect(stageSource).toContain('hoveredBreadboardNet.groupId === hole.groupId');
    expect(stageSource).toContain('workbench-breadboard-net-ring');
    expect(workbenchCss).toContain('.workbench-breadboard-terminal.connected');
    expect(stageSource).not.toContain('selectedLandingHoles');
    expect(workbenchCss).not.toContain('.workbench-breadboard-terminal.landing');
    expect(stageSource).toContain('workbench-terminal-tooltip');
    expect(stageSource).toContain('data-terminal-component-id');
    expect(stageSource).not.toContain('<title>{hole.id}</title>');
    expect(stageSource).not.toContain('tooltipWidth(hole.id');
    expect(stageSource).toContain('tooltipPlacement(label, point, c.viewBox');
    expect(stageSource).toContain('fontSize={12 / c.viewport.zoom}');
    expect(workbenchCss).not.toMatch(/\.workbench-terminal text\s*\{[^}]*font-size:/s);
    const terminalTooltipMarkup =
      stageSource.match(/<g className="workbench-terminal-tooltip">[\s\S]*?<\/g>/)?.[0] ?? '';
    expect(terminalTooltipMarkup).not.toContain('<rect');
    expect(workbenchCss).not.toContain('.workbench-terminal-tooltip rect');
    expect(workbenchCss).toMatch(/\.workbench-terminal-tooltip text\s*\{[^}]*text-shadow:/s);
  });

  it('keeps visible wires screen-stable and exposes the calculated LED visual state', () => {
    const visibleWireMarkup =
      stageSource.match(/data-testid="schematic-wire"[\s\S]*?\/>/)?.[0] ?? '';
    const previewWireMarkup =
      stageSource.match(/className="workbench-wire-preview"[\s\S]*?\/>/)?.[0] ?? '';
    expect(visibleWireMarkup).toContain('non-scaling-stroke');
    expect(previewWireMarkup).toContain('non-scaling-stroke');
    expect(workbenchCss).toMatch(/\.workbench-wire\s*\{[^}]*stroke-width:\s*3\.2;/s);
    expect(productionVisualSource).toContain('data-led-runtime-state');
    expect(productionVisualSource).toContain('data-led-brightness');
    expect(productionVisualSource).toContain('workbench-led-visual');
    expect(workbenchCss).toContain('.workbench-led-visual.is-lit .workbench-led-asset');
    expect(sidebarSource).toContain('До запуска LED не излучает свет');
    expect(sidebarSource).toContain('Ток ниже порога свечения выбранного цвета');
    expect(sidebarSource).toContain('Яркость рассчитана по току, напряжению и сопротивлению');
  });

  it('uses one three-column shelf and a meaningful detailed list', () => {
    expect(existsSync(resolve(electronicsRoot, 'workbench-tinkercad-parity.css'))).toBe(false);
    expect(workbenchCss).toContain('--wb-library-width: 276px');
    expect(workbenchCss).toContain('grid-template-columns: repeat(3, 74px)');
    expect(workbenchCss).toContain('column-gap: 8px');
    expect(workbenchCss).toContain('row-gap: 12px');
    expect(workbenchCss).toContain('height: 99px');
    expect(sidebarSource).not.toContain('workbench-family-variant-label');
    expect(sidebarSource).not.toContain('<small>В разработке</small>');
    expect(sidebarSource).not.toContain('workbench-catalog-blocked');
    expect(sidebarSource).not.toContain('workbench-variant-popover');
    expect(sidebarSource).toContain('workbench-catalog-copy');
    expect(sidebarSource).toContain('selectedVariant.entry.description');
    expect(sidebarSource).toContain('c.beginFamilyPlacement(family.familyId)');
    expect(sidebarSource).toContain('entry={selectedVariant.entry}');
    expect(previewSource).toContain('<ProductionComponentVisual');
    expect(workbenchCss).toContain('.workbench-component-vector-preview');
  });

  it('matches the compact editor chrome and shape-following selection contract', () => {
    expect(workbenchCss).toContain('--wb-header-height: 48px');
    expect(workbenchCss).toContain('--wb-toolbar-height: 48px');
    expect(stageSource).not.toContain('workbench-selection-box');
    expect(stageSource).toContain("workbench-part${selected ? ' selected' : ''}");
    expect(productionVisualSource).toContain('workbench-selection-silhouette');
    expect(productionVisualSource).toContain('tinkercad-four-pin-6x6');
    expect(productionVisualSource).toContain('tinkercad-three-pin-rotary');
    expect(productionVisualSource).toContain('tinkercad-spdt-three-pin');
    expect(stageSource).toContain('selectionOffset={1.6 / c.viewport.zoom}');
    expect(productionVisualSource).toContain('<feMorphology');
    expect(productionVisualSource).toContain('operator="dilate"');
    expect(productionVisualSource).toContain('operator="out"');
    expect(productionVisualSource).toContain('filter={`url(#${selectionFilterId})`}');
    expect(workbenchCss).toContain('border: 1px solid #3b8ed7');
    expect(sidebarSource).not.toContain('owner-provenance');
    expect(sidebarSource).not.toContain('workbench-inspector-preview');
    expect(headerSource).toContain('Копировать (Ctrl+C)');
    expect(headerSource).toContain('Вставить (Ctrl+V)');
    expect(headerSource).toContain("onViewChange('schematic')");
    expect(headerSource).toContain("onViewChange('bom')");
    expect(headerSource).not.toContain('Время моделирования:');
    expect(headerSource).toContain(
      "c.simulationRunning ? 'Остановить моделирование' : 'Начать моделирование'",
    );
    expect(headerSource).toContain("aria-label={c.simulationRunning ? 'Остановить моделирование'");
    expect(headerSource).toContain('data-simulation-status={c.simulationStatus}');
    expect(headerSource).toContain('workbench-wire-color-menu');
    expect(headerSource).toContain('role="menuitemradio"');
    expect(headerSource).not.toContain('<option key={color} value={color}>');
    expect(workbenchCss).toContain('.workbench-wire-color-menu button > span');
    expect(workbenchCss).toMatch(
      /\.workbench-wire-color summary > span\s*\{[^}]*flex:\s*0 0 30px;/s,
    );
    expect(headerSource).toContain('aria-label="Код — пока недоступен"');
    expect(headerSource).toContain('aria-label="Отправить — пока недоступно"');
    expect(workbenchCss).toContain('width: 222px');
    expect(workbenchCss).toContain('overflow-x: clip');
    expect(workbenchCss).toMatch(
      /\.workbench-toolbar-group\.right \.workbench-pill\.simulate\s*\{[^}]*height:\s*36px;/s,
    );
    expect(workbenchCss).toMatch(/\.workbench-tool svg\s*\{[^}]*width:\s*28px;/s);
    expect(workbenchCss).toMatch(/\.workbench-wire-preview\s*\{[^}]*stroke-dasharray:\s*none;/s);
    expect(workbenchCss).toMatch(/\.workbench-canvas\.wiring[^}]*cursor:\s*default;/s);
  });

  it('keeps selected-error emphasis and adds a zoom-stable LED diagnostic badge', () => {
    expect(stageSource).toContain('c.simulationRunning &&');
    expect(stageSource).toContain('c.errorDiagnosticComponentIds.has(component.id)');
    expect(stageSource).toContain('data-testid="led-diagnostic-badge"');
    expect(stageSource).toContain('c.simulationRunning && diagnostics.length > 0');
    expect(stageSource).toContain('r={18 / c.viewport.zoom}');
    expect(stageSource).toContain('fontSize={20 / c.viewport.zoom}');
    expect(stageSource).toContain('diagnostic.suggestedAction');
    expect(stageSource).toContain('pointerEvents="all"');
    expect(stageSource).not.toContain('data-testid="led-burnout-explosion"');
    expect(stageSource).not.toContain('workbench-led-burnout-explosion');
    expect(workbenchCss).toContain('.workbench-led-diagnostic-badge circle');
    expect(workbenchCss).toContain('.workbench-led-diagnostic-badge.error circle');
    expect(workbenchCss).not.toContain('workbench-led-explosion-flash');
    expect(workbenchCss).not.toContain('workbench-led-explosion-ring');
    expect(workbenchCss).not.toContain('workbench-led-explosion-ray');
    expect(workbenchCss).not.toContain('workbench-led-explosion-spark');
    expect(sidebarSource).toContain('Нагрузка относительно номинального тока');
    expect(sidebarSource).toContain('Светодиод перегорел');
    expect(workbenchCss).not.toContain('drop-shadow(0 0 7px rgba(211, 74, 48');
  });

  it('keeps the measured Circuits toolbar order and functional viewport controls', () => {
    expect(headerSource).toContain('workbench-breadboard-tools');
    expect(headerSource).toContain('workbench-wire-style');
    expect(headerSource).not.toContain('label="Подогнать под экран"');
    expect(workbenchCss).toContain('.workbench-toolbar-gap.rotate');
    expect(workbenchCss).toMatch(/\.workbench-wire-color\s*\{[^}]*flex:\s*0 0 62px;/s);
    expect(workbenchCss).toMatch(/\.workbench-wire-style\s*\{[^}]*flex:\s*0 0 67px;/s);
    expect(stageSource).toContain('c.zoomBy(1.18)');
    expect(stageSource).toContain('c.zoomBy(0.85)');
    expect(stageSource).toContain('Math.round(c.viewport.zoom * 100)');
    expect(stageSource).toContain('onDoubleClick={(event) => c.addWireVertexAt(event, wire.id)}');
    expect(stageSource).toContain('data-testid="wire-vertex"');
    expect(stageSource).toContain('data-testid="wire-hit"');
    expect(stageSource).toContain('data-testid="wire-endpoint"');
    expect(stageSource).toContain('workbench-wire-endpoint');
    expect(stageSource).toContain('c.removeWireVertexAt(wire.id, index)');
    expect(stageSource).toContain('event.detail >= 2');
    expect(stageSource).toContain('c.wireDraftVertices');
    expect(stageSource.indexOf('workbench-wire-overlay')).toBeGreaterThan(
      stageSource.indexOf('{orderedComponents'),
    );
    expect(stageSource.indexOf('workbench-wire-hit-layer')).toBeLessThan(
      stageSource.indexOf('{orderedComponents'),
    );
    expect(workbenchCss).toMatch(/\.workbench-wire\s*\{[^}]*pointer-events:\s*none;/s);
    expect(workbenchCss).toMatch(/\.workbench-wire-hit\s*\{[^}]*pointer-events:\s*stroke;/s);
    expect(stageSource).toContain('className="workbench-wire-selection"');
    expect(stageSource).toContain('data-testid="schematic-wire"');
    expect(stageSource).toContain('vectorEffect="non-scaling-stroke"');
    const controllerSource = readFileSync(
      resolve(electronicsRoot, 'use-electronics-workbench.ts'),
      'utf8',
    );
    expect(controllerSource).toContain('catalogPlacement');
    expect(controllerSource).toContain('actuatorPressRef');
    expect(controllerSource).toContain('lockOrthogonalPoint');
    expect(controllerSource).toContain('magneticWirePoint');
    expect(controllerSource).toContain('orthogonalWireMode || event.shiftKey');
    expect(controllerSource).toContain(
      'orthogonalWireMode || event.shiftKey ? lockOrthogonalPoint(anchor, world) : world',
    );
    expect(controllerSource).toContain('removeWireVertexAt');
    expect(controllerSource).toContain("selection.kind === 'wire' && selection.vertexIndex");
    expect(controllerSource).toContain('onEmptyCanvas && !event.shiftKey');
    expect(stageSource).toContain('onPointerDownCapture={c.placeCatalogComponent}');
  });

  it('uses compact inline properties and real schematic/BOM export actions', () => {
    expect(workbenchCss).toMatch(/\.workbench-inspector\s*\{[^}]*width:\s*300px;/s);
    expect(workbenchCss).toMatch(/\.workbench-inspector-body\s*\{[^}]*padding:\s*2px;/s);
    expect(sidebarSource).toContain('RESISTANCE_UNITS');
    expect(sidebarSource).toContain('workbench-inspector-help-popover');
    expect(sidebarSource).toContain('aria-label="Подключение выводов"');
    expect(sidebarSource).toContain('workbench-terminal-status');
    expect(sidebarSource).toContain('workbench-led-electrical-state');
    expect(editorSource).toContain('window.print()');
    expect(editorSource).toContain('text/csv;charset=utf-8');
    expect(editorSource).toContain('<th>Имя</th>');
    expect(editorSource).toContain('<th>Количество</th>');
    expect(editorSource).toContain('<th>Компонент</th>');
  });
});
