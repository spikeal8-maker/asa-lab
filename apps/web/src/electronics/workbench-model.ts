import type { ReactNode } from 'react';
import type { SchematicComponent, SchematicDocument, Terminal } from '../api';
import { catalogEntry } from './component-catalog';
import { physicalToWorld } from './production-asset-contracts';
import type { Point, Viewport } from './workbench-geometry';

export const STAGE_WIDTH = 1600;
export const STAGE_HEIGHT = 980;
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** How far the canvas may be scaled.
 *
 * The ceiling used to be 3.2, which stopped while a 5mm LED was still a small
 * shape on screen — you could not get close enough to see which hole a leg was
 * in. Owner artwork is vector, so it stays sharp all the way up.
 *
 * The numbers are the domain contract's, not a preference: parseElectronicsDocument
 * rejects a viewport outside 0.1..8, so anything wider here produces a document
 * the server refuses to store. Raising the ceiling past 8 means changing that
 * contract first — a canvas that lets you reach a state which cannot be saved is
 * worse than one that stops.
 */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;

/** How close a dragged wire vertex has to be before it lines up with a neighbour.
 *
 * Measured on screen and divided by the zoom at the point of use, so the magnet
 * feels the same whatever the scale. As a world distance it grew with every step
 * of zoom until it swallowed the area the pointer was working in.
 */
export const MAGNET_SCREEN_UNITS = 10;
export const WIRE_COLORS = ['#e3212b', '#2a3035', '#149447', '#2c62c9', '#e7a400', '#8d45c7'];
export const DRAG_MIME = 'application/x-asa-electronics-component';

export type WorkbenchView = 'breadboard' | 'schematic' | 'bom';

export type Selection =
  | { kind: 'component'; id: string; ids: string[] }
  | { kind: 'wire'; id: string; vertexIndex?: number }
  | null;
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface TerminalRef {
  componentId: string;
  terminal: Terminal;
}

export interface ComponentDrag {
  componentId: string;
  componentIds: string[];
  pointerId: number;
  offset: Point;
  startedAt: Point;
  startedPositions: Record<string, Point>;
}

export interface CatalogPlacement {
  componentTypeId: string;
  point: Point | null;
}

export interface ActuatorPress {
  componentId: string;
  pointerId: number;
  kind: 'button' | 'switch';
}

export interface PotentiometerDrag {
  componentId: string;
  pointerId: number;
}

export interface PanDrag {
  pointerId: number;
  startClient: Point;
  startViewport: Viewport;
}

export interface MarqueeDrag {
  pointerId: number;
  start: Point;
  current: Point;
  additive: boolean;
}

export interface VertexDrag {
  pointerId: number;
  wireId: string;
  vertexIndex: number;
}

export interface EndpointDrag {
  pointerId: number;
  wireId: string;
  endpoint: 'from' | 'to';
}

export interface HistoryState {
  entries: SchematicDocument[];
  cursor: number;
}

export function selectedComponentIds(selection: Selection): string[] {
  return selection?.kind === 'component' ? selection.ids : [];
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

export function componentTransform(component: SchematicComponent): string {
  const entry = catalogEntry(component);
  if (!entry) return `translate(${component.position.x} ${component.position.y})`;
  const { width: baseWidth, height: baseHeight } = physicalToWorld(entry.physicalSizeMm);
  const rotation = component.rotation ?? 0;
  const renderedWidth = rotation % 180 === 0 ? baseWidth : baseHeight;
  const renderedHeight = rotation % 180 === 0 ? baseHeight : baseWidth;
  const mirrorX = component.stateProperties?.['mirrorX'] === true ? -1 : 1;
  const mirrorY = component.stateProperties?.['mirrorY'] === true ? -1 : 1;
  return [
    `translate(${component.position.x + renderedWidth / 2} ${component.position.y + renderedHeight / 2})`,
    `rotate(${rotation})`,
    `scale(${mirrorX} ${mirrorY})`,
    `translate(${-baseWidth / 2} ${-baseHeight / 2})`,
  ].join(' ');
}

export interface ToolButtonProps {
  label: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  onClick?: () => void;
  children: ReactNode;
}
