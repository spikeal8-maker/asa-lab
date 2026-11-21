import type { ComponentResult, SolveResult } from '../api';
import type { LedPresentationFrame } from './led-temporal-presentation';
import type { LedAssetReadiness } from './ProductionComponentVisual';

export interface NativeOpticalObservation {
  readonly result: SolveResult;
  readonly frame: LedPresentationFrame;
  readonly ledAssets: ReadonlyMap<string, LedAssetReadiness>;
}
export interface NativeOpticalSnapshot {
  readonly observation: NativeOpticalObservation | null;
  readonly committed: NativeOpticalObservation | null;
  readonly preparation: {
    readonly token: string;
    readonly assets: ReadonlyMap<string, string>;
  } | null;
  readonly rollback: ReadonlyMap<string, LedAssetReadiness> | null;
}
export const EMPTY_NATIVE_OPTICAL_SNAPSHOT: NativeOpticalSnapshot = {
  observation: null,
  committed: null,
  preparation: null,
  rollback: null,
};
/** A mounted workbench owns one port. It never owns electrical time or native leases. */
export class NativeOpticalPresentation {
  private u = 0;
  private ls = new Set<() => void>();
  readonly readClock = () => this.u;
  readonly subscribeClock = (listener: () => void) => {
    this.ls.add(listener);
    return () => {
      this.ls.delete(listener);
    };
  };
  setClock(value: number) {
    if (this.u === value) return;
    this.u = value;
    for (const listener of [...this.ls]) listener();
  }
  private snapshot: NativeOpticalSnapshot = EMPTY_NATIVE_OPTICAL_SNAPSHOT;
  private listeners = new Set<() => void>();
  private layouts = new Map<string, NativeOpticalSnapshot>();
  private resultMaps = new WeakMap<SolveResult, ReadonlyMap<string, ComponentResult>>();
  resultMap(observation = this.snapshot.committed): ReadonlyMap<string, ComponentResult> {
    if (!observation) return new Map();
    let map = this.resultMaps.get(observation.result);
    if (!map) {
      map = new Map(observation.result.components.map((c) => [c.componentId, c]));
      this.resultMaps.set(observation.result, map);
    }
    return map;
  }
  private barrier: ((snapshot: NativeOpticalSnapshot) => void) | null = null;
  readonly getSnapshot = () => this.snapshot;
  readonly getCommittedSnapshot = () => this.snapshot.committed;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<NativeOpticalSnapshot>) {
    if (
      Object.entries(patch).every(
        ([key, value]) => this.snapshot[key as keyof NativeOpticalSnapshot] === value,
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
  setObservation(observation: NativeOpticalObservation | null, proposed = false) {
    this.update({ observation, ...(proposed ? {} : { committed: observation }) });
  }
  setPreparation(preparation: NativeOpticalSnapshot['preparation']) {
    this.update({ preparation });
  }
  setRollback(rollback: NativeOpticalSnapshot['rollback']) {
    this.update({ rollback });
  }
  commit(observation: NativeOpticalObservation) {
    if (this.snapshot.observation === observation)
      this.update({ committed: observation, rollback: null });
  }
  setBarrier(barrier: ((snapshot: NativeOpticalSnapshot) => void) | null) {
    this.barrier = barrier;
  }
  rendered(componentId: string, snapshot: NativeOpticalSnapshot) {
    if (this.snapshot === snapshot) this.layouts.set(componentId, snapshot);
    return () => {
      if (this.layouts.get(componentId) === snapshot) this.layouts.delete(componentId);
    };
  }
  afterLayout(snapshot: NativeOpticalSnapshot) {
    if (this.snapshot !== snapshot) return;
    const frame = snapshot.observation?.frame;
    if (
      frame &&
      [
        ...snapshot.observation!.ledAssets.keys(),
        ...frame.arduinoLStates.keys(),
        ...(frame.sevenSegmentBrightness?.keys() ?? []),
      ].some((id) => this.layouts.get(id) !== snapshot)
    )
      return;
    this.barrier?.(snapshot);
  }
}
