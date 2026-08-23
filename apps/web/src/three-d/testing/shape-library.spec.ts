import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShapeLibrary } from '../ShapeLibrary';

describe('ASA 3D basic shape catalog', () => {
  it('matches the 21 visible Tinkercad basic solids and includes editable text', () => {
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

    expect(markup.match(/data-category="basic"/g)).toHaveLength(21);
    expect(markup).toContain('data-primitive="text"');
    expect(markup).toContain('data-primitive="round-roof"');
    expect(markup).toContain('data-primitive="ring"');
    expect(markup).toContain('data-primitive="icosahedron"');
    expect(markup).toContain('data-primitive="extrude-sketch"');
    expect(markup).toContain('data-primitive="revolve-sketch"');
    expect(markup).toContain('data-primitive="scribble"');
  });
});
