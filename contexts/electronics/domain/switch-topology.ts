import type { SchematicComponent, Terminal } from './document.js';

export type SpdtThrow = 'left' | 'right';

export const TACTILE_BUTTON_TERMINALS = ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'] as const;
export const SPDT_TERMINALS = ['throw-left', 'common', 'throw-right'] as const;

const BUTTON_SIDE_CONNECTIONS = [
  ['SW-A1', 'SW-A2'],
  ['SW-B1', 'SW-B2'],
] as const satisfies readonly (readonly [Terminal, Terminal])[];

/**
 * Physical 6x6 mm tactile button topology.
 *
 * The two pins on each side are permanently common. Pressing the actuator adds
 * one bridge between the sides; releasing it removes only that bridge.
 */
export function buttonContactPairs(pressed: boolean): readonly (readonly [Terminal, Terminal])[] {
  return pressed ? [...BUTTON_SIDE_CONNECTIONS, ['SW-A1', 'SW-B1']] : [...BUTTON_SIDE_CONNECTIONS];
}

export function spdtThrowFromState(state: boolean | undefined): SpdtThrow {
  return state === true ? 'right' : 'left';
}

export function spdtStateForThrow(selected: SpdtThrow): boolean {
  return selected === 'right';
}

/** A two-position SPDT always connects common to exactly one throw. */
export function spdtConnections(selected: SpdtThrow): readonly (readonly [Terminal, Terminal])[] {
  return [['common', selected === 'left' ? 'throw-left' : 'throw-right']];
}

export function spdtSelectedTerminal(state: boolean | undefined): Terminal {
  return spdtConnections(spdtThrowFromState(state))[0]?.[1] ?? 'throw-left';
}

/** Production SPDT always conducts; SPST closes only in the left position.
 * Keep the historical two-terminal generic switch (true = closed) unchanged.
 */
export function switchContactClosed(component: SchematicComponent): boolean {
  return component.componentTypeId === 'switch-spst'
    ? component.state !== true
    : component.componentTypeId
      ? true
      : component.state === true;
}

/** The open SPST still exposes the same left physical terminal. */
export function switchSelectedTerminal(component?: SchematicComponent | null): Terminal {
  return component?.componentTypeId === 'switch-spst'
    ? 'throw-left'
    : spdtSelectedTerminal(component?.state);
}
