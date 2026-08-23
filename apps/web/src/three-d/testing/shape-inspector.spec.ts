import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createThreeDNode } from '@asa-lab/three-d';
import { describe, expect, it, vi } from 'vitest';
import { ShapeInspector } from '../ShapeInspector';

describe('ASA 3D compact shape inspector', () => {
  it('shows the parameters that belong to a box without verbose coordinates', () => {
    const node = createThreeDNode('box', 'box-1');
    const markup = renderToStaticMarkup(createElement(ShapeInspector, { node, execute: vi.fn() }));

    expect(markup).toContain('data-testid="asa3d-shape-inspector"');
    expect(markup).toContain('Радиус');
    expect(markup).toContain('Шаги');
    expect(markup).toContain('Длина');
    expect(markup).toContain('Глубина');
    expect(markup).toContain('Высота');
    expect(markup).not.toContain('Положение');
    expect(markup).not.toContain('Поворот');
  });

  it('renders an editable compact boolean group card', () => {
    const first = {
      ...createThreeDNode('box', 'box-a'),
      groupId: 'group-1',
      groupOperation: 'union' as const,
    };
    const second = {
      ...createThreeDNode('cylinder', 'cylinder-b'),
      groupId: 'group-1',
      groupOperation: 'union' as const,
    };
    const markup = renderToStaticMarkup(
      createElement(ShapeInspector, {
        group: {
          id: 'group-1',
          nodes: [first, second],
          operation: 'union',
          onOperationChange: vi.fn(),
        },
        execute: vi.fn(),
      }),
    );

    expect(markup).toContain('data-testid="asa3d-group-inspector"');
    expect(markup).toContain('Union');
    expect(markup).toContain('Объединение');
    expect(markup).toContain('Вычитание');
    expect(markup).toContain('Пересечение');
  });
});
