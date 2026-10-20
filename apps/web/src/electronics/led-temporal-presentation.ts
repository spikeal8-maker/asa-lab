import type {
  ElectronicsArduinoIndicatorSample,
  ElectronicsArduinoIndicatorTemporal,
  ElectronicsLedTemporalComponent,
  ElectronicsLedTemporalObservation,
  ElectronicsLedTemporalSample,
} from '@asa-lab/electronics/engine';
import type { SolveResult } from '../api';

// A complete observation can be 25 ms apart. Two distinct phases must each fit
// the available cadence; the monitor's frame rate cannot restore omitted states.
export const LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS = 25_000;
// Two complete cycles plus the current phase, including near the cadence limit.
const HISTORY_MICROSECONDS = 5 * LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS;
const MAX_HISTORY_SAMPLES = 513;
// One deliberately shared classroom clock. Electrical instruction time is unchanged.
export const ELECTRONICS_CLASSROOM_PACE = 0.125;
// Keep the requested future window within 50 ms of wall time at the shared pace.
// This demand bound is separate from the unchanged optical phase classification.
export const ELECTRONICS_CLASSROOM_LOOKAHEAD_MICROSECONDS = 6_250;

export function classroomRequestedHorizon(
  hostOffsetMicroseconds: number,
  elapsedWallMicroseconds: number,
  presentedMicroseconds: number,
): number {
  return (
    hostOffsetMicroseconds +
    Math.min(
      Math.max(0, Math.floor(elapsedWallMicroseconds * ELECTRONICS_CLASSROOM_PACE)),
      Math.max(0, presentedMicroseconds) + ELECTRONICS_CLASSROOM_LOOKAHEAD_MICROSECONDS,
    )
  );
}

export interface LedPresentationFrame {
  readonly token: string;
  readonly atMicroseconds: number;
  readonly brightness: ReadonlyMap<string, number>;
  readonly arduinoLStates: ReadonlyMap<string, boolean>;
}

export interface LedNativeAssetFrame extends Omit<LedPresentationFrame, 'token'> {
  readonly generation: number;
}

function sameLedBrightness(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(([id, value]) => Math.round(value) === Math.round(right.get(id) ?? -1))
  );
}

export function sameOpticalFrame(left: LedPresentationFrame, right: LedPresentationFrame): boolean {
  return (
    sameLedBrightness(left.brightness, right.brightness) &&
    left.arduinoLStates.size === right.arduinoLStates.size &&
    [...left.arduinoLStates].every(([id, value]) => right.arduinoLStates.get(id) === value)
  );
}

type HeldPresentationSample = ElectronicsLedTemporalSample | ElectronicsArduinoIndicatorSample;

interface HeldHistory<T extends HeldPresentationSample> {
  readonly samples: readonly T[];
  readonly completeSince: number;
}

function heldValue(sample: HeldPresentationSample): number {
  return 'voltage' in sample ? sample.voltage : sample.brightness;
}

function sameState(left: HeldPresentationSample, right: HeldPresentationSample) {
  return (
    heldValue(left) === heldValue(right) &&
    ('current' in left ? left.current : undefined) ===
      ('current' in right ? right.current : undefined)
  );
}

function validArduinoIndicator(
  indicator: ElectronicsArduinoIndicatorTemporal,
  from: number,
  to: number,
): boolean {
  return (
    typeof indicator?.componentId === 'string' &&
    typeof indicator.truncated === 'boolean' &&
    Array.isArray(indicator.samples) &&
    indicator.samples.length > 0 &&
    indicator.samples.length <= MAX_HISTORY_SAMPLES &&
    (indicator.truncated || indicator.samples[0]?.atMicroseconds === from) &&
    indicator.samples.at(-1)?.atMicroseconds === to &&
    indicator.samples.every(
      (sample, index) =>
        sample !== null &&
        sample !== undefined &&
        Number.isSafeInteger(sample.atMicroseconds) &&
        sample.atMicroseconds >= from &&
        sample.atMicroseconds <= to &&
        Number.isFinite(sample.voltage) &&
        (index === 0 || sample.atMicroseconds > indicator.samples[index - 1]!.atMicroseconds),
    )
  );
}

function validComponent(
  component: ElectronicsLedTemporalComponent,
  from: number,
  to: number,
): boolean {
  const duration = to - from;
  if (
    typeof component?.componentId !== 'string' ||
    typeof component.truncated !== 'boolean' ||
    !Number.isFinite(component.brightnessIntegral) ||
    component.brightnessIntegral < 0 ||
    component.brightnessIntegral > 100 * duration + 1e-6 ||
    !Number.isSafeInteger(component.litDurationMicroseconds) ||
    component.litDurationMicroseconds < 0 ||
    component.litDurationMicroseconds > duration ||
    !Number.isSafeInteger(component.transitionCount) ||
    component.transitionCount < 0 ||
    !Array.isArray(component.samples) ||
    component.samples.length < 1 ||
    component.samples.length > MAX_HISTORY_SAMPLES
  )
    return false;
  let integral = 0;
  let litDuration = 0;
  let transitions = 0;
  for (let index = 0; index < component.samples.length; index++) {
    const sample = component.samples[index]!;
    if (
      !sample ||
      !Number.isSafeInteger(sample.atMicroseconds) ||
      sample.atMicroseconds < from ||
      sample.atMicroseconds > to ||
      !Number.isFinite(sample.brightness) ||
      sample.brightness < 0 ||
      sample.brightness > 100 ||
      !Number.isFinite(sample.current) ||
      (sample.brightness > 0 && sample.current <= 0)
    )
      return false;
    const previous = component.samples[index - 1];
    if (previous) {
      const elapsed = sample.atMicroseconds - previous.atMicroseconds;
      if (elapsed <= 0) return false;
      integral += previous.brightness * elapsed;
      if (previous.brightness > 0) litDuration += elapsed;
      if (previous.brightness !== sample.brightness) transitions++;
    }
  }
  if (component.samples.at(-1)!.atMicroseconds !== to) return false;
  const tolerance = Math.max(1, component.brightnessIntegral) * 1e-9;
  return component.truncated
    ? integral <= component.brightnessIntegral + tolerance &&
        litDuration <= component.litDurationMicroseconds &&
        transitions <= component.transitionCount
    : component.samples[0]!.atMicroseconds === from &&
        Math.abs(integral - component.brightnessIntegral) <= tolerance &&
        litDuration === component.litDurationMicroseconds &&
        transitions === component.transitionCount;
}

function retainHistory<T extends HeldPresentationSample>(
  previous: HeldHistory<T> | undefined,
  component: { readonly samples: readonly T[]; readonly truncated: boolean },
  from: number,
  to: number,
  cursor = to,
): HeldHistory<T> {
  const first = component.samples[0]!;
  const previousEnd = previous?.samples.at(-1);
  const continuous =
    !component.truncated &&
    previousEnd?.atMicroseconds === first.atMicroseconds &&
    sameState(previousEnd, first);
  const combined = continuous
    ? [...previous!.samples.slice(0, -1), ...component.samples]
    : [...component.samples];
  const samples: T[] = [];
  for (let index = 0; index < combined.length; index++) {
    const sample = combined[index]!;
    const last = samples.at(-1);
    if (last && sameState(last, sample) && index !== combined.length - 1) continue;
    samples.push(sample);
  }
  const firstRecent = samples.findIndex(
    (sample) => sample.atMicroseconds >= cursor - HISTORY_MICROSECONDS,
  );
  return {
    samples: samples.slice(Math.max(0, firstRecent - 1, samples.length - MAX_HISTORY_SAMPLES)),
    completeSince: component.truncated ? to : continuous ? previous!.completeSince : from,
  };
}

function fastCycleBrightness(samples: readonly ElectronicsLedTemporalSample[], to: number) {
  const edges: number[] = [];
  for (let index = 1; index < samples.length; index++) {
    if (samples[index - 1]!.brightness > 0 !== samples[index]!.brightness > 0)
      edges.push(samples[index]!.atMicroseconds);
  }
  // Five alternating edges delimit two fully observed optical cycles. Nothing
  // about the programme, GPIO level or host timer supplies a missing edge.
  if (edges.length < 5) return undefined;
  const recent = edges.slice(-5);
  if (to - recent[4]! >= LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS) return undefined;
  for (let index = 1; index < recent.length; index++) {
    const phase = recent[index]! - recent[index - 1]!;
    if (phase <= 0 || phase >= LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS) return undefined;
  }
  const start = recent[0]!;
  const end = recent[4]!;
  let integral = 0;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1]!;
    const duration =
      Math.min(end, samples[index]!.atMicroseconds) - Math.max(start, previous.atMicroseconds);
    if (duration > 0) integral += previous.brightness * duration;
  }
  return integral / (end - start);
}

/** Only accepted optical observations are retained; electrical results stay untouched. */
export class LedTemporalPresentation {
  private committed: number | null = null;
  private histories = new Map<string, HeldHistory<ElectronicsLedTemporalSample>>();
  private indicatorHistories = new Map<string, HeldHistory<ElectronicsArduinoIndicatorSample>>();
  private cursor: number | null = null;
  private sampledAt: number | null = null;
  private frameSequence = 0;
  private generation = 0;
  private animationFrame = 0;
  private committedAnimationFrame = -3;
  private presentedFrame: LedPresentationFrame | null = null;
  private pendingFrame: LedPresentationFrame | null = null;
  private snapshot: Omit<LedPresentationFrame, 'token'> | null = null;
  private reanchors = 0;

  /** A discontinuity is observable evidence, never successful phase preservation. */
  get reanchorCount(): number {
    return this.reanchors;
  }

  /** The cap follows acknowledged display, never a prepared future asset. */
  get presentedMicroseconds(): number {
    return this.presentedFrame?.atMicroseconds ?? 0;
  }

  get preparedFrame(): LedPresentationFrame | null {
    return this.pendingFrame;
  }

  get displayedFrame(): LedPresentationFrame | null {
    return this.presentedFrame;
  }

  /**
   * Read the nearest native resource need in already accepted history. This is
   * not a display frame: it has no ACK token and cannot advance the cursor or
   * count a RAF. In particular, an intermediate HIGH must not be skipped just
   * because the accepted endpoint has returned LOW before the next paint.
   */
  get nextNativeAssetFrame(): LedNativeAssetFrame | null {
    if (this.cursor === null || this.committed === null) return null;
    const times = new Set([this.cursor, this.committed]);
    if (!this.snapshot) {
      for (const { samples } of this.histories.values()) {
        for (const sample of samples) {
          // Native brightness can change at a solved sample or when the
          // existing fast-cycle policy expires into the real held state.
          for (const time of [
            sample.atMicroseconds,
            sample.atMicroseconds + LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS,
          ])
            if (time > this.cursor && time < this.committed) times.add(time);
        }
      }
    }
    let last: LedNativeAssetFrame | null = null;
    for (const time of [...times].sort((left, right) => left - right)) {
      const frame = this.frameAt(time);
      if (!frame) return null;
      last = { ...frame, generation: this.generation };
      if (
        !this.presentedFrame ||
        !sameLedBrightness(frame.brightness, this.presentedFrame.brightness)
      )
        return last;
    }
    return last;
  }

  get canPublishDistinctFrame(): boolean {
    return this.presentedFrame === null || this.animationFrame - this.committedAnimationFrame > 0;
  }

  reset(): void {
    this.committed = null;
    this.histories.clear();
    this.indicatorHistories.clear();
    this.cursor = null;
    this.sampledAt = null;
    this.pendingFrame = null;
    this.presentedFrame = null;
    this.snapshot = null;
    this.animationFrame = 0;
    this.committedAnimationFrame = -3;
    this.generation++;
  }

  accept(
    result: SolveResult,
    observation?: ElectronicsLedTemporalObservation,
    wallMicroseconds?: number,
  ): ReadonlyMap<string, number> {
    const brightness = new Map<string, number>();
    if (
      !observation ||
      observation.profile !== 'ordinary-led-held-v1' ||
      !Number.isSafeInteger(observation.fromMicroseconds) ||
      !Number.isSafeInteger(observation.toMicroseconds) ||
      observation.fromMicroseconds < 0 ||
      observation.toMicroseconds < observation.fromMicroseconds ||
      !Array.isArray(observation.components) ||
      (observation.arduinoIndicators !== undefined &&
        !Array.isArray(observation.arduinoIndicators)) ||
      !result.solved ||
      !result.quality?.passed
    ) {
      this.reset();
      return brightness;
    }
    const ids = new Set<string>();
    for (const component of observation.components) {
      if (
        !validComponent(component, observation.fromMicroseconds, observation.toMicroseconds) ||
        ids.has(component.componentId)
      ) {
        this.reset();
        return brightness;
      }
      ids.add(component.componentId);
    }
    const arduinoIndicators = observation.arduinoIndicators ?? [];
    for (const indicator of arduinoIndicators) {
      if (
        !validArduinoIndicator(
          indicator,
          observation.fromMicroseconds,
          observation.toMicroseconds,
        ) ||
        ids.has(indicator.componentId)
      ) {
        this.reset();
        return brightness;
      }
      ids.add(indicator.componentId);
    }
    if (this.committed !== observation.fromMicroseconds) {
      if (this.committed !== null) this.reanchors++;
      this.reset();
    }
    if (wallMicroseconds !== undefined && this.cursor === null)
      this.cursor = observation.fromMicroseconds;
    const next = new Map<string, HeldHistory<ElectronicsLedTemporalSample>>();
    for (const component of observation.components) {
      const electrical = result.components.find(
        (entry) => entry.componentId === component.componentId,
      );
      const final = component.samples.at(-1)!;
      const previous = this.histories.get(component.componentId);
      if (
        !electrical ||
        electrical.brightness !== final.brightness ||
        electrical.current !== final.current ||
        // A proved dark reverse channel remains part of the joint history. Dropping
        // it on HIGH and adding it back on LOW would make the older cursor appear
        // uncovered and prematurely move every indicator to the new LOW endpoint.
        (electrical.junctionState === 'reverse_blocking' &&
          (component.samples.some(
            (sample: ElectronicsLedTemporalSample) => sample.brightness !== 0 || sample.current > 0,
          ) ||
            previous?.samples.some((sample) => sample.brightness !== 0 || sample.current > 0))) ||
        electrical.presentationState === 'failed' ||
        electrical.deviceHealth === 'failed_open' ||
        electrical.damageState === 'failed'
      )
        continue;
      const history = retainHistory(
        previous,
        component,
        observation.fromMicroseconds,
        observation.toMicroseconds,
        this.cursor ?? observation.toMicroseconds,
      );
      next.set(component.componentId, history);
      const mean = fastCycleBrightness(history.samples, observation.toMicroseconds);
      if (mean !== undefined) brightness.set(component.componentId, mean);
    }
    const nextIndicators = new Map<string, HeldHistory<ElectronicsArduinoIndicatorSample>>();
    for (const indicator of arduinoIndicators) {
      const electrical = result.components.find(
        (entry) => entry.componentId === indicator.componentId,
      );
      const final = indicator.samples.at(-1)!;
      if (!electrical || electrical.terminalVoltages.d13 !== final.voltage) {
        this.reset();
        return new Map();
      }
      nextIndicators.set(
        indicator.componentId,
        retainHistory(
          this.indicatorHistories.get(indicator.componentId),
          indicator,
          observation.fromMicroseconds,
          observation.toMicroseconds,
          this.cursor ?? observation.toMicroseconds,
        ),
      );
    }
    this.indicatorHistories = nextIndicators;
    this.committed = observation.toMicroseconds;
    this.histories = next;
    if (this.pendingFrame && [...this.pendingFrame.brightness.keys()].some((id) => !next.has(id)))
      this.pendingFrame = null;
    // Ingestion never advances or publishes the optical cursor. In particular,
    // a burst of completed Worker windows cannot compress a later visible phase.
    return brightness;
  }

  /** A non-clocked circuit supplies a real endpoint, never an invented timeline. */
  acceptSnapshot(result: SolveResult, atMicroseconds: number): void {
    if (
      !result.solved ||
      !result.quality?.passed ||
      !Number.isSafeInteger(atMicroseconds) ||
      atMicroseconds < 0 ||
      (this.committed !== null && atMicroseconds < this.committed)
    ) {
      this.reset();
      return;
    }
    if (this.histories.size || this.indicatorHistories.size) this.reset();
    this.snapshot = {
      atMicroseconds,
      brightness: new Map(
        result.components.flatMap((component) =>
          Number.isFinite(component.brightness)
            ? [[component.componentId, component.brightness!] as const]
            : [],
        ),
      ),
      arduinoLStates: new Map(),
    };
    this.committed = atMicroseconds;
    if (this.cursor === null) this.cursor = atMicroseconds;
  }

  /**
   * Prepare one frame from accepted history on the shared animation-frame path.
   * The caller must acknowledge its actual joint DOM commit. A pending native
   * asset or React commit freezes this exact frame and discards elapsed wall
   * time; no saved waiting-time debt is repaid in a subsequent phase.
   */
  prepareFrame(wallMicroseconds: number): LedPresentationFrame | null {
    this.animationFrame++;
    const elapsed = this.sampledAt === null ? 0 : Math.max(0, wallMicroseconds - this.sampledAt);
    this.sampledAt = wallMicroseconds;
    if (this.pendingFrame) return this.pendingFrame;
    if (this.cursor === null || this.committed === null) return null;
    const target = this.snapshot
      ? this.snapshot.atMicroseconds
      : this.presentedFrame === null
        ? this.cursor
        : Math.min(this.committed, this.cursor + Math.floor(elapsed * ELECTRONICS_CLASSROOM_PACE));
    const values = this.frameAt(target);
    if (!values) {
      // Missing/truncated coverage cannot establish a displayable frame. Report
      // the discontinuity and forget it; never jump across unpresented phases.
      this.reanchors++;
      this.reset();
      return null;
    }
    const frame: LedPresentationFrame = {
      ...values,
      token: `${this.generation}:${++this.frameSequence}`,
    };
    if (
      this.presentedFrame &&
      !sameOpticalFrame(this.presentedFrame, frame) &&
      !this.canPublishDistinctFrame
    )
      return null;
    this.pendingFrame = frame;
    return frame;
  }

  /** The only cursor commit. A native load callback alone must never call this. */
  acknowledgeFrame(
    frame: LedPresentationFrame,
    wallMicroseconds: number,
    distinctOpticalCommit = false,
  ): boolean {
    if (this.pendingFrame !== frame) return false;
    const changed =
      distinctOpticalCommit ||
      this.presentedFrame === null ||
      !sameOpticalFrame(this.presentedFrame, frame);
    this.cursor = frame.atMicroseconds;
    this.presentedFrame = frame;
    this.pendingFrame = null;
    this.sampledAt = wallMicroseconds;
    if (changed) this.committedAnimationFrame = this.animationFrame;
    return true;
  }

  /** A read of the last acknowledged vector; it cannot advance model time. */
  sample(): ReadonlyMap<string, number> {
    return this.presentedFrame?.brightness ?? new Map();
  }

  private throughTime<T extends HeldPresentationSample>(samples: readonly T[], time: number) {
    let end = samples.length - 1;
    while (end >= 0 && samples[end]!.atMicroseconds > time) end--;
    if (end < 0) return [];
    const prefix = samples.slice(0, end + 1);
    const last = prefix.at(-1)!;
    if (last.atMicroseconds < time) prefix.push({ ...last, atMicroseconds: time });
    return prefix;
  }

  /** Arduino L and ordinary LED always refer to the same acknowledged frame. */
  arduinoLStates(): ReadonlyMap<string, boolean> {
    return this.presentedFrame?.arduinoLStates ?? new Map();
  }

  /** Both preparation paths sample the same complete LED/L vector. */
  private frameAt(atMicroseconds: number): Omit<LedPresentationFrame, 'token'> | null {
    if (this.snapshot) return this.snapshot;
    const brightness = this.atTime(atMicroseconds);
    const voltages = this.indicatorVoltagesAtTime(atMicroseconds);
    if (brightness.size !== this.histories.size || voltages.size !== this.indicatorHistories.size)
      return null;
    return {
      atMicroseconds,
      brightness,
      arduinoLStates: new Map([...voltages].map(([id, voltage]) => [id, voltage >= 2.5])),
    };
  }

  private indicatorVoltagesAtTime(time: number): ReadonlyMap<string, number> {
    const voltages = new Map<string, number>();
    for (const [id, { samples, completeSince }] of this.indicatorHistories) {
      if (completeSince > time) continue;
      const last = this.throughTime(samples, time).at(-1);
      if (last) voltages.set(id, last.voltage);
    }
    return voltages;
  }

  private atTime(time: number): ReadonlyMap<string, number> {
    const brightness = new Map<string, number>();
    for (const [id, { samples, completeSince }] of this.histories) {
      if (completeSince > time) continue;
      const prefix = this.throughTime(samples, time);
      const last = prefix.at(-1);
      if (!last) continue;
      brightness.set(id, fastCycleBrightness(prefix, time) ?? last.brightness);
    }
    return brightness;
  }
}
