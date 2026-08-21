import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThreeDToolbar, type ThreeDToolbarProps } from '../ThreeDToolbar';

function props(overrides: Partial<ThreeDToolbarProps> = {}): ThreeDToolbarProps {
  const action = vi.fn();
  return {
    selectedCount: 2,
    editableSelectedCount: 2,
    hasClipboard: true,
    hasHiddenNodes: true,
    canUndo: true,
    canRedo: true,
    canBundle: true,
    canUngroup: true,
    canAlign: true,
    canCruise: true,
    alignmentActive: false,
    mirrorActive: false,
    cruiseActive: false,
    rulerActive: false,
    workplaneActive: false,
    onCopy: action,
    onPaste: action,
    onDuplicate: action,
    onDelete: action,
    onUndo: action,
    onRedo: action,
    onHideSelected: action,
    onShowAll: action,
    onBundle: action,
    onGroup: action,
    onUngroup: action,
    onToggleAlign: action,
    onToggleMirror: action,
    onMirror: action,
    onToggleCruise: action,
    onToggleRuler: action,
    onToggleWorkplane: action,
    onDrop: action,
    onImport: action,
    onExportStl: action,
    onExportJson: action,
    sendControl: createElement('button', { type: 'button' }, 'Отправить'),
    ...overrides,
  };
}

describe('ASA 3D toolbar parity contract', () => {
  it('keeps the Tinkercad command order and three file actions', () => {
    const markup = renderToStaticMarkup(createElement(ThreeDToolbar, props()));
    const commands = [
      'copy',
      'paste',
      'duplicate',
      'delete',
      'undo',
      'redo',
      'visibility',
      'bundle',
      'group',
      'ungroup',
      'align',
      'mirror',
      'cruise',
      'ruler',
      'workplane',
      'drop',
    ];
    let cursor = -1;
    for (const command of commands) {
      const index = markup.indexOf(`data-command="${command}"`);
      expect(index, command).toBeGreaterThan(cursor);
      cursor = index;
    }
    expect(markup).toContain('>Импорт<');
    expect(markup).toContain('>Экспорт<');
    expect(markup).toContain('>Отправить<');
  });

  it('disables selection commands without a selection but leaves ruler usable', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ThreeDToolbar,
        props({
          selectedCount: 0,
          editableSelectedCount: 0,
          hasClipboard: false,
          hasHiddenNodes: false,
          canBundle: false,
          canUngroup: false,
          canAlign: false,
          canCruise: false,
        }),
      ),
    );
    expect(markup).toContain('data-command="copy" disabled=""');
    expect(markup).toContain('data-command="drop" disabled=""');
    expect(markup).toContain('data-command="ruler"');
    expect(markup).not.toContain('data-command="ruler" disabled=""');
  });

  it('does not recreate the vertical scrollbar overflow combination', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/three-d/three-d.css'), 'utf8');
    const toolbarRule = css.match(/\.asa3d-toolbar\s*\{(?<body>[^}]*)\}/)?.groups?.['body'];
    expect(toolbarRule).toBeTruthy();
    expect(toolbarRule).not.toContain('overflow-x: auto');
    expect(toolbarRule).not.toContain('overflow-y: visible');
    expect(toolbarRule).toContain('overflow: visible');
  });
});
