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
    expect(markup).not.toContain('Длина');
    expect(markup).not.toContain('Глубина');
    expect(markup).not.toContain('Высота');
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

  it('exposes both cone radii so the frustum can be reversed', () => {
    const node = createThreeDNode('cone', 'cone-1');
    const markup = renderToStaticMarkup(createElement(ShapeInspector, { node, execute: vi.fn() }));

    expect(markup).toContain('Верхний радиус');
    expect(markup).toContain('Радиус основания');
    expect(markup).toContain('Стороны');
    expect(markup).not.toContain('Глубина');
  });

  it('exposes the same cylinder generator controls as Tinkercad', () => {
    const node = createThreeDNode('cylinder', 'cylinder-1');
    const markup = renderToStaticMarkup(createElement(ShapeInspector, { node, execute: vi.fn() }));

    expect(markup).toContain('min="12" max="128"');
    expect(markup).toContain('Скос');
    expect(markup).toContain('min="1" max="10"');
    expect(markup).toContain('Сегменты');
    expect(markup).not.toContain('Ширина');
  });

  it('provides editable content and bevel controls for text', () => {
    const node = createThreeDNode('text', 'text-1');
    const markup = renderToStaticMarkup(createElement(ShapeInspector, { node, execute: vi.fn() }));

    expect(markup).toContain('value="TEXT"');
    expect(markup).toContain('Шрифт');
    expect(markup).toContain('Многоязычный');
    expect(markup).toContain('Скос');
    expect(markup).toContain('Высота');
    expect(markup).toContain('min="0" max="5"');
  });

  it('matches the confirmed Tinkercad parameter matrix for remaining generators', () => {
    const render = (primitive: Parameters<typeof createThreeDNode>[0]): string =>
      renderToStaticMarkup(
        createElement(ShapeInspector, {
          node: createThreeDNode(primitive, primitive),
          execute: vi.fn(),
        }),
      );

    expect(render('sphere')).toContain('Шаги');
    expect(render('torus')).toContain('Труба');
    expect(render('tube')).toContain('Толщина стенки');
    expect(render('tube')).toContain('Сегменты скоса');
    expect(render('polygon')).toContain('min="3" max="12"');
    expect(render('star')).toContain('Внутренний радиус (%)');
    expect(render('pyramid')).toContain('min="3" max="28"');
    expect(render('ring')).toContain('min="3" max="128"');
  });

  it('offers a persisted sketch editor for all three sketch generators', () => {
    for (const primitive of ['extrude-sketch', 'revolve-sketch', 'scribble'] as const) {
      const markup = renderToStaticMarkup(
        createElement(ShapeInspector, {
          node: createThreeDNode(primitive, primitive),
          execute: vi.fn(),
        }),
      );
      expect(markup).toContain('Редактировать эскиз');
    }
  });
});
