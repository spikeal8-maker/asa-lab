import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const electronicsRoot = resolve(process.cwd(), 'apps/web/src/electronics');
const stageSource = readFileSync(resolve(electronicsRoot, 'WorkbenchStage.tsx'), 'utf8');
const sidebarSource = readFileSync(resolve(electronicsRoot, 'WorkbenchSidebars.tsx'), 'utf8');
const headerSource = readFileSync(resolve(electronicsRoot, 'WorkbenchHeader.tsx'), 'utf8');
const workbenchCss = readFileSync(resolve(electronicsRoot, 'workbench.css'), 'utf8');

describe('owner-reference Electronics presentation contract', () => {
  it('keeps idle terminals and breadboard overlays invisible until an active target state', () => {
    expect(stageSource).not.toContain('workbench-snap-link');
    expect(stageSource).toContain('className="workbench-terminal-dot" r="3"');
    expect(stageSource).toContain("? ' wiring' : ''");
    expect(workbenchCss).toMatch(/\.workbench-terminal-dot\s*\{[^}]*opacity:\s*0;/s);
    expect(workbenchCss).toContain('.workbench-canvas.wiring .workbench-terminal-dot');
    expect(workbenchCss).toMatch(/\.workbench-breadboard-hole\s*\{[^}]*opacity:\s*0;/s);
  });

  it('uses one three-column shelf implementation with image-and-name cards only', () => {
    expect(existsSync(resolve(electronicsRoot, 'workbench-tinkercad-parity.css'))).toBe(false);
    expect(workbenchCss).toContain('--wb-library-width: 276px');
    expect(workbenchCss).toContain('grid-template-columns: repeat(3, 76px)');
    expect(workbenchCss).toContain('column-gap: 5px');
    expect(workbenchCss).toContain('row-gap: 10px');
    expect(workbenchCss).toContain('height: 99px');
    expect(sidebarSource).not.toContain('workbench-family-variant-label');
    expect(sidebarSource).not.toContain('<small>В разработке</small>');
    expect(sidebarSource).not.toContain('workbench-catalog-blocked');
    expect(sidebarSource).toContain('workbench-variant-popover');
  });

  it('matches the compact editor chrome and shape-following selection contract', () => {
    expect(workbenchCss).toContain('--wb-header-height: 48px');
    expect(workbenchCss).toContain('--wb-toolbar-height: 48px');
    expect(stageSource).not.toContain('workbench-selection-box');
    expect(stageSource).toContain("workbench-part${selected ? ' selected' : ''}");
    expect(workbenchCss).toContain('.workbench-part.selected');
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
});
