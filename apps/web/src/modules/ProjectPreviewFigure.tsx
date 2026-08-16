import type { ReactNode } from 'react';
import type { ModulePreviewFigure, ModulePreviewShape } from '@asa-lab/module-sdk';
import { projectSnapshotUrl, type ModuleSummary, type Project } from '../api';
import './project-preview.css';

/**
 * Draws the figure a subject module produced, without knowing the subject.
 *
 * The alternative — asking each module to render its own thumbnail — would pull
 * the schematic editor, the board renderer and the 3D runtime into the project
 * list, the one screen every visitor loads. So the module ships primitives and
 * this component turns them into SVG.
 */

/** Rendering budget. The server already trims; this is the second lock. */
const SHAPE_LIMIT = 240;

/**
 * Only plain hex colours are drawn. The figure arrives as stored JSON, and an
 * SVG paint value can name an external resource (`url(...)`); refusing anything
 * that is not a literal colour keeps a project card from ever making a request
 * on behalf of whoever opened it.
 */
const COLOUR = /^#[0-9a-fA-F]{3,8}$/;

function colour(value: string | undefined, fallback: string | undefined): string | undefined {
  if (typeof value === 'string' && COLOUR.test(value)) return value;
  return fallback;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function drawable(shape: ModulePreviewShape): boolean {
  if (shape.shape === 'rect') {
    return (
      finite(shape.x) &&
      finite(shape.y) &&
      finite(shape.width) &&
      finite(shape.height) &&
      shape.width > 0 &&
      shape.height > 0
    );
  }
  if (shape.shape === 'circle') {
    return finite(shape.cx) && finite(shape.cy) && finite(shape.r) && shape.r > 0;
  }
  return finite(shape.x1) && finite(shape.y1) && finite(shape.x2) && finite(shape.y2);
}

function Shape({ shape }: { shape: ModulePreviewShape }): JSX.Element | null {
  if (shape.shape === 'rect') {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        rx={finite(shape.radius) ? shape.radius : undefined}
        fill={colour(shape.fill, 'none')}
        stroke={colour(shape.stroke, undefined)}
        strokeWidth={shape.stroke === undefined ? undefined : 0.5}
      />
    );
  }
  if (shape.shape === 'circle') {
    return (
      <circle
        cx={shape.cx}
        cy={shape.cy}
        r={shape.r}
        fill={colour(shape.fill, 'none')}
        stroke={colour(shape.stroke, undefined)}
        strokeWidth={shape.stroke === undefined ? undefined : 0.5}
      />
    );
  }
  const stroke = colour(shape.stroke, undefined);
  if (stroke === undefined) return null;
  return (
    <line
      x1={shape.x1}
      y1={shape.y1}
      x2={shape.x2}
      y2={shape.y2}
      stroke={stroke}
      strokeWidth={finite(shape.width) && shape.width > 0 ? shape.width : 1}
      strokeLinecap="round"
    />
  );
}

export function isDrawableFigure(figure: ModulePreviewFigure | undefined): boolean {
  if (!figure) return false;
  if (!finite(figure.viewBox.width) || !finite(figure.viewBox.height)) return false;
  if (figure.viewBox.width <= 0 || figure.viewBox.height <= 0) return false;
  return figure.shapes.some(drawable);
}

export function ProjectPreviewFigure({
  figure,
  label,
}: {
  figure: ModulePreviewFigure;
  label: string;
}): JSX.Element {
  const background = colour(figure.background, undefined);
  const shapes = figure.shapes.filter(drawable).slice(0, SHAPE_LIMIT);
  return (
    <svg
      className="project-preview-figure"
      viewBox={`0 0 ${figure.viewBox.width} ${figure.viewBox.height}`}
      // The card is a fixed rectangle and a figure is whatever shape the work
      // happens to be, so the drawing is centred and never distorted to fit.
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      data-testid="project-preview-figure"
    >
      {background === undefined ? null : (
        <rect
          x={0}
          y={0}
          width={figure.viewBox.width}
          height={figure.viewBox.height}
          fill={background}
        />
      )}
      {shapes.map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </svg>
  );
}

/**
 * The picture for a project card, in the order of how much it says about the
 * work:
 *
 *  1. the snapshot the editor took of its own canvas — what the learner saw;
 *  2. the figure the module computed from the document — always current, but a
 *     diagram of the work rather than a view of it;
 *  3. the module glyph, for a project nobody has opened yet.
 *
 * All three are ordinary states, not errors. The snapshot is missing for every
 * project until an editor has been open long enough to take one, and Tinkercad
 * — which has only the snapshot — leaves those cards blank; here the computed
 * figure covers the gap.
 */
export function ProjectPreview({
  project,
  module,
  fallback,
}: {
  project: Project;
  module?: ModuleSummary | undefined;
  fallback: ReactNode;
}): JSX.Element {
  const descriptor = project.preview?.descriptor;
  const subject = module?.displayName ?? project.moduleKey;
  const label = descriptor?.summary
    ? `${project.title}: ${subject}, ${descriptor.summary}`
    : `${project.title}: ${subject}`;

  const snapshot = projectSnapshotUrl(project);
  if (snapshot !== null) {
    return (
      <img
        className="project-preview-snapshot"
        src={snapshot}
        alt={label}
        // Below the fold a project list can hold dozens of cards; each image is
        // a separate request and only the visible ones are worth making.
        loading="lazy"
        decoding="async"
        draggable={false}
        data-testid="project-preview-snapshot"
      />
    );
  }

  const figure = descriptor?.figure;
  if (!figure || !isDrawableFigure(figure)) return <>{fallback}</>;
  return <ProjectPreviewFigure figure={figure} label={label} />;
}
