import type { ReactNode } from 'react';
import type { SchematicComponent, SchematicDocument } from '../api';
import { catalogEntry, renderedSize } from './component-catalog';
import type { Point, Viewport } from './workbench-geometry';
import { STAGE_HEIGHT_UNITS, STAGE_WIDTH_UNITS } from './workbench-scale';

export const STAGE_WIDTH = STAGE_WIDTH_UNITS;
export const STAGE_HEIGHT = STAGE_HEIGHT_UNITS;
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
export const WIRE_COLORS = ['#e3212b', '#2a3035', '#149447', '#2c62c9', '#e7a400', '#8d45c7'];
export const DRAG_MIME = 'application/x-asa-electronics-component';

export type Selection = { kind: 'component'; id: string } | { kind: 'wire'; id: string } | null;
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface TerminalRef {
  componentId: string;
  terminal: 'a' | 'b';
}

export interface ComponentDrag {
  componentId: string;
  pointerId: number;
  offset: Point;
  startedAt: Point;
}

export interface PanDrag {
  pointerId: number;
  startClient: Point;
  startViewport: Viewport;
}

export interface HistoryState {
  entries: SchematicDocument[];
  cursor: number;
}

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase());
  return letters.join('') || 'AS';
}

/**
 * SVG transform that keeps `component.position` as the top-left of the rotated
 * bounding box. Geometry and terminal calculations use the same render size.
 */
export function componentTransform(component: SchematicComponent): string {
  const entry = catalogEntry(component.kind);
  if (!entry) return `translate(${component.position.x} ${component.position.y})`;
  const base = renderedSize(entry, 0);
  const rotation = component.rotation ?? 0;
  if (rotation === 90)
    return `translate(${component.position.x + base.height} ${component.position.y}) rotate(90)`;
  if (rotation === 180)
    return `translate(${component.position.x + base.width} ${component.position.y + base.height}) rotate(180)`;
  if (rotation === 270)
    return `translate(${component.position.x} ${component.position.y + base.width}) rotate(270)`;
  return `translate(${component.position.x} ${component.position.y})`;
}

export interface ToolButtonProps {
  label: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  onClick?: () => void;
  children: ReactNode;
}
