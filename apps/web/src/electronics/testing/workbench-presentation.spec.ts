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
const workbenchCss = readFileSync(resolve(electronicsRoot, 'workbench.css'), 'utf8');

describe('owner-reference Electronics presentation contract', () => {
  it('keeps idle terminals and breadboard overlays invisible until an active target state', () => {
    expect(stageSource).not.toContain('workbench-snap-link');
    expect(stageSource).toContain('className="workbench-terminal-dot" r="3"');
    expect(stageSource).toContain("? ' wiring' : ''");
    expect(workbenchCss).toMatch(/\.workbench-terminal-dot\s*\{[^}]*opacity:\s*0;/s);
    expect(workbenchCss).toContain('.workbench-canvas.wiring .workbench-terminal-dot');
    expect(workbenchCss).toMatch(/\.workbench-breadboard-hole\s*\{[^}]*opacity:\s*0;/s);
    expect(stageSource).toContain('hoveredBreadboardNet.groupId === hole.groupId');
    expect(stageSource).toContain('workbench-breadboard-net-ring');
    expect(workbenchCss).toContain('.workbench-breadboard-terminal.connected');
  });

  it('uses one three-column shelf and a meaningful detailed list', () => {
    expect(existsSync(resolve(electronicsRoot, 'workbench-tinkercad-parity.css'))).toBe(false);
    expect(workbenchCss).toContain('--wb-library-width: 276px');
    expect(workbenchCss).toContain('grid-template-columns: repeat(3, 76px)');
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
  });

  it('matches the compact editor chrome and shape-following selection contract', () => {
    expect(workbenchCss).toContain('--wb-header-height: 48px');
    expect(workbenchCss).toContain('--wb-toolbar-height: 48px');
    expect(stageSource).not.toContain('workbench-selection-box');
    expect(stageSource).toContain("workbench-part${selected ? ' selected' : ''}");
    expect(productionVisualSource).toContain('workbench-selection-silhouette');
    expect(productionVisualSource).toContain('maskImage: `url("${asset}")`');
    expect(workbenchCss).toContain('border: 1px solid #3b8ed7');
    expect(sidebarSource).not.toContain('owner-provenance');
    expect(sidebarSource).not.toContain('workbench-inspector-preview');
    expect(headerSource).toContain('Копировать (Ctrl+C)');
    expect(headerSource).toContain('Вставить (Ctrl+V)');
    expect(headerSource).toContain("onViewChange('schematic')");
    expect(headerSource).toContain("onViewChange('bom')");
  });

  it('shows stage diagnostics only for a selected error while simulation is running', () => {
    expect(stageSource).toContain('c.simulationRunning &&');
    expect(stageSource).toContain('c.errorDiagnosticComponentIds.has(component.id)');
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
    expect(stageSource).not.toContain('e.detail === 2');
    const controllerSource = readFileSync(
      resolve(electronicsRoot, 'use-electronics-workbench.ts'),
      'utf8',
    );
    expect(controllerSource).toContain('catalogPlacement');
    expect(controllerSource).toContain('actuatorPressRef');
    expect(controllerSource).toContain('onEmptyCanvas && !event.shiftKey');
    expect(stageSource).toContain('onPointerDownCapture={c.placeCatalogComponent}');
  });

  it('uses compact inline properties and real schematic/BOM export actions', () => {
    expect(workbenchCss).toMatch(/\.workbench-inspector\s*\{[^}]*width:\s*256px;/s);
    expect(workbenchCss).toMatch(/\.workbench-inspector-body\s*\{[^}]*padding:\s*2px;/s);
    expect(sidebarSource).toContain('c.simulationRunning ? (');
    expect(editorSource).toContain('window.print()');
    expect(editorSource).toContain('text/csv;charset=utf-8');
    expect(editorSource).toContain('<th>Имя</th>');
    expect(editorSource).toContain('<th>Количество</th>');
    expect(editorSource).toContain('<th>Компонент</th>');
  });
});
