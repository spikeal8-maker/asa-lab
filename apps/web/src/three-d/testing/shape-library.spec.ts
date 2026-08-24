import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShapeLibrary } from '../ShapeLibrary';

describe('ASA 3D basic shape catalog', () => {
  it('shows the 18 enabled Tinkercad basic solids and defers sketch generators', () => {
    const markup = renderToStaticMarkup(
      createElement(ShapeLibrary, {
        onAdd: vi.fn(),
        onDragStateChange: vi.fn(),
        gridVisible: true,
        onToggleGrid: vi.fn(),
        onOpenGridSettings: vi.fn(),
        rulerVisible: false,
        onToggleRuler: vi.fn(),
      }),
    );

    expect(markup.match(/data-category="basic"/g)).toHaveLength(18);
    expect(markup).toContain('data-primitive="text"');
    expect(markup).toContain('data-primitive="round-roof"');
    expect(markup).toContain('data-primitive="ring"');
    expect(markup).toContain('data-primitive="icosahedron"');
    expect(markup).not.toContain('data-primitive="extrude-sketch"');
    expect(markup).not.toContain('data-primitive="revolve-sketch"');
    expect(markup).not.toContain('data-primitive="scribble"');
  });
});
