import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ModulePreviewFigure } from '@asa-lab/module-sdk';
import { ProjectPreview, isDrawableFigure } from '../ProjectPreviewFigure';
import type { Project } from '../../api';

const FIGURE: ModulePreviewFigure = {
  viewBox: { width: 40, height: 30 },
  background: '#f4f6f7',
  shapes: [
    { shape: 'rect', x: 2, y: 2, width: 10, height: 10, fill: '#3f6f8f', stroke: '#22475c' },
    { shape: 'circle', cx: 30, cy: 20, r: 5, fill: '#c2453f' },
    { shape: 'line', x1: 12, y1: 7, x2: 25, y2: 20, stroke: '#c2453f', width: 2 },
  ],
};

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    scope: 'personal',
    classroomId: null,
    moduleKey: 'electronics',
    title: 'Светодиод',
    status: 'active',
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
    preview: {
      digest: 'abcd1234',
      descriptor: { kind: 'schematic', summary: '3 компонентов', figure: FIGURE },
    },
    snapshotRevision: null,
    ...overrides,
  };
}

function render(value: Project): string {
  return renderToStaticMarkup(
    createElement(ProjectPreview, {
      project: value,
      fallback: createElement('span', { 'data-testid': 'fallback' }, 'глиф'),
    }),
  );
}

describe('ProjectPreview', () => {
  it('draws the stored figure', () => {
    const html = render(project());
    expect(html).toContain('viewBox="0 0 40 30"');
    expect(html).toContain('<rect');
    expect(html).toContain('<circle');
    expect(html).toContain('<line');
    expect(html).not.toContain('data-testid="fallback"');
  });

  it('names the project and its summary for screen readers', () => {
    expect(render(project())).toContain('aria-label="Светодиод: electronics, 3 компонентов"');
  });

  it('falls back to the module glyph when the project has no preview', () => {
    expect(render(project({ preview: null }))).toContain('data-testid="fallback"');
  });

  it('falls back when the preview carries no figure', () => {
    const withoutFigure = project({
      preview: { digest: 'abcd1234', descriptor: { kind: 'schematic', summary: 'пусто' } },
    });
    expect(render(withoutFigure)).toContain('data-testid="fallback"');
  });

  it('falls back when the figure has no drawable shape', () => {
    const empty = project({
      preview: {
        digest: 'abcd1234',
        descriptor: {
          kind: 'schematic',
          figure: { viewBox: { width: 40, height: 30 }, shapes: [] },
        },
      },
    });
    expect(render(empty)).toContain('data-testid="fallback"');
  });

  /**
   * The figure is stored JSON, so a corrupted or hostile row can reach this
   * component. An SVG paint value may name an external resource, which would
   * turn a project card into a request made on the viewer's behalf; only
   * literal hex colours are drawn.
   */
  it('refuses paint values that are not literal colours', () => {
    const hostile = project({
      preview: {
        digest: 'abcd1234',
        descriptor: {
          kind: 'schematic',
          figure: {
            viewBox: { width: 40, height: 30 },
            background: 'url(https://example.invalid/x.png)',
            shapes: [
              {
                shape: 'rect',
                x: 1,
                y: 1,
                width: 8,
                height: 8,
                fill: 'url(https://example.invalid/y.png)',
                stroke: 'javascript:alert(1)',
              },
            ],
          },
        },
      },
    });
    const html = render(hostile);
    expect(html).not.toContain('example.invalid');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('fill="none"');
  });

  it('drops shapes whose coordinates are not finite numbers', () => {
    const broken = project({
      preview: {
        digest: 'abcd1234',
        descriptor: {
          kind: 'schematic',
          figure: {
            viewBox: { width: 40, height: 30 },
            shapes: [
              { shape: 'circle', cx: Number.NaN, cy: 5, r: 3, fill: '#c2453f' },
              { shape: 'circle', cx: 10, cy: 5, r: 3, fill: '#c2453f' },
            ],
          },
        },
      },
    });
    const html = render(broken);
    expect(html).not.toContain('NaN');
    expect(html.match(/<circle/g)).toHaveLength(1);
  });
});

describe('ProjectPreview with a captured snapshot', () => {
  /**
   * Once an editor has photographed the project, that picture outranks the
   * computed figure: it is what the learner actually saw on screen.
   */
  it('prefers the editor snapshot over the computed figure', () => {
    const html = render(project({ snapshotRevision: 7 }));
    expect(html).toContain('data-testid="project-preview-snapshot"');
    expect(html).not.toContain('data-testid="project-preview-figure"');
  });

  it('addresses the snapshot by revision so a card can be cached', () => {
    expect(render(project({ snapshotRevision: 7 }))).toContain(
      'src="/api/projects/p1/snapshot?rev=7"',
    );
  });

  it('loads snapshots lazily, because a list can hold dozens of cards', () => {
    expect(render(project({ snapshotRevision: 7 }))).toContain('loading="lazy"');
  });

  it('names the project on the image for screen readers', () => {
    expect(render(project({ snapshotRevision: 7 }))).toContain(
      'alt="Светодиод: electronics, 3 компонентов"',
    );
  });
});

describe('isDrawableFigure', () => {
  it('accepts a figure with at least one drawable shape', () => {
    expect(isDrawableFigure(FIGURE)).toBe(true);
  });

  it('rejects a missing figure', () => {
    expect(isDrawableFigure(undefined)).toBe(false);
  });

  it('rejects a viewBox with no area', () => {
    expect(isDrawableFigure({ ...FIGURE, viewBox: { width: 0, height: 30 } })).toBe(false);
  });
});
