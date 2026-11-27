import type { ComponentResult, SchematicDocument, SolveResult } from '../api';
import { sameOpticalFrame, type LedPresentationFrame } from './led-temporal-presentation';
import type { LedAssetReadiness } from './ProductionComponentVisual';
import { catalogEntry, visualAsset } from './component-catalog';
import { ordinaryLedVisualState } from './component-result-presentation';
import { clamp } from './workbench-geometry';

export interface NativeOpticalObservation {
  readonly result: SolveResult;
  readonly frame: LedPresentationFrame;
  readonly ledAssets: ReadonlyMap<string, LedAssetReadiness>;
}
export interface PendingOpticalObservation {
  readonly frame: LedPresentationFrame;
  readonly result: SolveResult;
  readonly assets: ReadonlyMap<string, string>;
  readonly readiness: Map<string, LedAssetReadiness>;
  readonly canAcknowledge?: () => boolean;
}

export function opticalFrameAssets(
  frame: Pick<LedPresentationFrame, 'brightness'>,
  solved: SolveResult,
  document: SchematicDocument | null,
) {
  const assets = new Map<string, string>();
  for (const component of document?.components ?? []) {
    if (component.kind !== 'led') continue;
    const entry = catalogEntry(component);
    if (!entry || entry.key !== 'led-5mm') continue;
    const electrical = solved.components.find((value) => value.componentId === component.id);
    const brightness = Math.round(
      clamp(frame.brightness.get(component.id) ?? electrical?.brightness ?? 0, 0, 100),
    );
    const state = ordinaryLedVisualState(electrical);
    const visualState =
      state === 'off' || state === 'lit' ? (brightness > 0 ? 'lit' : 'off') : state;
    assets.set(
      component.id,
      visualAsset(
        entry,
        {
          ...component,
          stateProperties: { ...component.stateProperties, ledBrightness: brightness },
        },
        visualState,
      ),
    );
  }
  return assets;
}

export function createPendingOpticalObservation(
  frame: LedPresentationFrame,
  result: SolveResult,
  assets: ReadonlyMap<string, string>,
  canAcknowledge?: () => boolean,
): PendingOpticalObservation {
  return { frame, result, assets, readiness: new Map(), ...(canAcknowledge && { canAcknowledge }) };
}

export function recordOpticalAssetReadiness(
  pending: PendingOpticalObservation | null,
  event: LedAssetReadiness,
): boolean {
  if (
    !pending ||
    event.token !== pending.frame.token ||
    event.asset !== pending.assets.get(event.componentId)
  )
    return false;
  if (event.status === 'ready' && event.isCurrent())
    pending.readiness.set(event.componentId, event);
  else pending.readiness.delete(event.componentId);
  return true;
}

export function opticalAssetLeasesReady(
  pending: PendingOpticalObservation,
  active = false,
): boolean {
  return [...pending.assets].every(([componentId, asset]) => {
    const lease = pending.readiness.get(componentId);
    return (
      lease?.status === 'ready' &&
      lease.token === pending.frame.token &&
      lease.componentId === componentId &&
      lease.asset === asset &&
      lease.isCurrent() &&
      (!active || lease.isActive())
    );
  });
}

export function restorableOpticalObservation(
  previous: NativeOpticalObservation | null,
): NativeOpticalObservation | null {
  // A single stale native resource invalidates the whole joint rollback vector.
  return previous &&
    [...previous.ledAssets.values()].every((lease) => lease.status === 'ready' && lease.isCurrent())
    ? previous
    : null;
}

export function matchingOpticalValues(
  previous: NativeOpticalObservation,
  frame: LedPresentationFrame,
  assets: ReadonlyMap<string, string>,
): boolean {
  return (
    sameOpticalFrame(frame, previous.frame) &&
    matchingNativeAssets(previous.ledAssets, assets, true)
  );
}

export function matchingNativeAssets(
  leases: ReadonlyMap<string, LedAssetReadiness>,
  assets: ReadonlyMap<string, string>,
  active = false,
): boolean {
  return (
    leases.size === assets.size &&
    [...assets].every(([id, asset]) => {
      const lease = leases.get(id);
      return lease?.asset === asset && lease.isCurrent() && (!active || lease.isActive());
    })
  );
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
  private witnessedObservation: NativeOpticalObservation | null = null;
  private witnessTimer: number | null = null;

  private mountedVector(expected: NativeOpticalObservation): boolean {
    const { observation, committed } = this.snapshot;
    return (
      committed !== null &&
      observation === committed &&
      expected.ledAssets.size === committed.ledAssets.size &&
      sameOpticalFrame(expected.frame, committed.frame) &&
      [...expected.ledAssets].every(
        ([id, lease]) =>
          committed.ledAssets.get(id) === lease && lease.isCurrent() && lease.isActive(),
      )
    );
  }

  mountedAnimationFrame(): LedPresentationFrame | null {
    const committed = this.snapshot.committed;
    return committed?.ledAssets.size &&
      window.document.visibilityState === 'visible' &&
      this.mountedVector(committed)
      ? committed.frame
      : null;
  }

  hasRenderWitness(): boolean {
    return (
      this.witnessedObservation !== null &&
      window.document.visibilityState === 'visible' &&
      this.mountedVector(this.witnessedObservation)
    );
  }

  private cancelPendingWitness(): void {
    if (this.witnessTimer === null) return;
    window.clearTimeout(this.witnessTimer);
    this.witnessTimer = null;
  }

  clearRenderWitness(): void {
    this.cancelPendingWitness();
    this.witnessedObservation = null;
  }

  private scheduleRenderTask(run: () => void): void {
    const timer = window.setTimeout(() => {
      if (this.witnessTimer !== timer) return;
      this.witnessTimer = null;
      run();
    }, 0);
    this.witnessTimer = timer;
  }

  /** Call only at the end of the workbench's actual RAF callback. */
  witnessAfterAnimationFrame(
    retryDeferred?: () => void,
    isWaitingForWitness?: () => boolean,
  ): void {
    this.cancelPendingWitness();
    if (this.hasRenderWitness()) return;
    const previous = this.snapshot.committed;
    if (
      !previous?.ledAssets.size ||
      previous.frame.arduinoLStates.size !== 1 ||
      previous.frame.sevenSegmentBrightness?.size ||
      window.document.visibilityState !== 'visible'
    )
      return;
    // Observe the exact active native vector in a browser task after the RAF
    // batch. A later RAF cancels this task instead of crediting a missed slot.
    this.scheduleRenderTask(() => {
      if (window.document.visibilityState !== 'visible' || !this.mountedVector(previous)) return;
      this.witnessedObservation = previous;
      if (retryDeferred && isWaitingForWitness?.()) {
        // Tasks already queued by this frame can still observe the prior SVG.
        // Retry the already accepted data in a separate task for the next slot.
        this.scheduleRenderTask(() => {
          if (this.hasRenderWitness()) retryDeferred();
        });
      }
    });
  }
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
    if (!observation) this.clearRenderWitness();
    this.update({ observation, ...(proposed ? {} : { committed: observation }) });
  }
  setPreparation(preparation: NativeOpticalSnapshot['preparation']) {
    this.update({ preparation });
  }
  setRollback(rollback: NativeOpticalSnapshot['rollback']) {
    this.update({ rollback });
  }
  commit(observation: NativeOpticalObservation) {
    if (this.snapshot.observation === observation) {
      this.clearRenderWitness();
      this.update({ committed: observation, rollback: null });
    }
  }
  setBarrier(barrier: ((snapshot: NativeOpticalSnapshot) => void) | null) {
    if (!barrier) this.clearRenderWitness();
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
