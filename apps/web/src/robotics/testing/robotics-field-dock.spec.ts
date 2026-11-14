import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editor = readFileSync(new URL('../RobotFieldEditor.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../robotics.css', import.meta.url), 'utf8');

describe('ROBOTICS-FIELD-DOCK-001 source invariants', () => {
  it('reuses exactly one inspector and one field settings component', () => {
    expect(editor.split('<RobotObjectInspector').length - 1).toBe(1);
    expect(editor.split('<RobotFieldSettings').length - 1).toBe(1);
    expect(editor).not.toContain('robotics-field-object-flyout');
    expect(editor).not.toContain('objectFlyout');
  });

  it('exposes three controlled dock tabs with a distinct field accessible name', () => {
    expect(editor).toContain('data-dock-tab="objects"');
    expect(editor).toContain('data-dock-tab="properties"');
    expect(editor).toContain('data-dock-tab="field"');
    expect(editor).toContain('aria-label="Настройки поля"');
    expect(editor).toContain("hidden={dockTab !== 'objects'}");
    expect(editor).toContain("hidden={dockTab !== 'properties'}");
    expect(editor).toContain('aria-label="Закрыть панель поля"');
    expect(editor).toContain("open={dockTab === 'field' || fieldSettingsOpen}");
  });

  it('uses a 300px desktop dock and a controlled smaller-screen drawer', () => {
    expect(stylesheet).toContain('ROBOTICS-FIELD-DOCK-001');
    expect(stylesheet).toContain('grid-template-columns: minmax(0, 1fr) 300px');
    expect(stylesheet).toContain('@media (max-width: 1279px)');
    expect(editor).toContain(
      "if (window.matchMedia('(max-width: 1279px)').matches) closeProperties()",
    );
  });

  it('retains the existing camera and document commit mechanisms', () => {
    expect(editor).toContain('const cameraControl = useFieldCamera(');
    expect(editor).toContain('if (!onCommit(parsed.world))');
    expect(editor).toContain('onClick={onUndo}');
  });
});
