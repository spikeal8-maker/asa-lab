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
// Optical averaging is separate from the complete-observation producer cadence.
// A 20 ms held phase is visible at 60 Hz; genuinely sub-frame cycles retain
// their integrated brightness from actual complete electrical history.
const FAST_PHASE_MICROSECONDS = 16_667;
// Two complete cycles plus the current phase, including near the cadence limit.
const HISTORY_MICROSECONDS = 5 * LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS;
const MAX_HISTORY_SAMPLES = 513;
// One wall microsecond advances one physical microsecond; instruction time is unchanged.
export const ELECTRONICS_CLASSROOM_PACE = 1;
// Keep the requested future window within 50 ms of wall time at the shared pace.
// This demand bound is separate from the unchanged optical phase classification.
export const ELECTRONICS_CLASSROOM_LOOKAHEAD_MICROSECONDS = 50_000;

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
  if (to - recent[4]! >= FAST_PHASE_MICROSECONDS) return undefined;
  for (let index = 1; index < recent.length; index++) {
    const phase = recent[index]! - recent[index - 1]!;
    if (phase <= 0 || phase >= FAST_PHASE_MICROSECONDS) return undefined;
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
  private a: number | null = null;
  private b = new Map<string, HeldHistory<ElectronicsLedTemporalSample>>();
  private c = new Map<string, HeldHistory<ElectronicsArduinoIndicatorSample>>();
  private d: number | null = null;
  private e: { w: number; m: number } | null = null;
  private f = 0;
  private g = 0;
  private h = 0;
  private i = -3;
  private j: LedPresentationFrame | null = null;
  private k: LedPresentationFrame | null = null;
  private l: Omit<LedPresentationFrame, 'token'> | null = null;
  private m = 0;

  /** A discontinuity is observable evidence, never successful phase preservation. */
  get reanchorCount(): number {
    return this.m;
  }

  /** The cap follows acknowledged display, never a prepared future asset. */
  get presentedMicroseconds(): number {
    return this.j?.atMicroseconds ?? 0;
  }

  get preparedFrame(): LedPresentationFrame | null {
    return this.k;
  }

  get displayedFrame(): LedPresentationFrame | null {
    return this.j;
  }

  /**
   * Read the nearest native resource need in already accepted history. This is
   * not a display frame: it has no ACK token and cannot advance the cursor or
   * count a RAF. In particular, an intermediate HIGH must not be skipped just
   * because the accepted endpoint has returned LOW before the next paint.
   */
  get nextNativeAssetFrame(): LedNativeAssetFrame | null {
    return this.nextNativeAssetFrameAt();
  }

  /** Resource demand can follow wall time without preparing or acknowledging a frame. */
  nextNativeAssetFrameAt(wallMicroseconds?: number): LedNativeAssetFrame | null {
    if (this.d === null || this.a === null) return null;
    const target =
      wallMicroseconds === undefined || this.e === null
        ? this.d
        : Math.min(
            this.a,
            Math.max(
              this.d,
              this.e.m +
                Math.floor(Math.max(0, wallMicroseconds - this.e.w)),
            ),
          );
    const times = new Set([target, this.a]);
    if (!this.l) {
      for (const { samples } of this.b.values()) {
        for (const sample of samples) {
          // Native brightness can change at a solved sample or when the
          // existing fast-cycle policy expires into the real held state.
          for (const time of [
            sample.atMicroseconds,
            sample.atMicroseconds + FAST_PHASE_MICROSECONDS,
          ])
            if (time > target && time < this.a) times.add(time);
        }
      }
    }
    let last: LedNativeAssetFrame | null = null;
    for (const time of [...times].sort((left, right) => left - right)) {
      const frame = this.o(time);
      if (!frame) return null;
      last = { ...frame, generation: this.g };
      if (!this.j || !sameLedBrightness(frame.brightness, this.j.brightness)) return last;
    }
    return last;
  }

  get canPublishDistinctFrame(): boolean {
    return this.j === null || this.h - this.i > 0;
  }

  reset(): void {
    this.a = null;
    this.b.clear();
    this.c.clear();
    this.d = null;
    this.e = null;
    this.k = null;
    this.j = null;
    this.l = null;
    this.h = 0;
    this.i = -3;
    this.g++;
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
    if (this.a !== observation.fromMicroseconds) {
      if (this.a !== null) this.m++;
      this.reset();
    }
    if (wallMicroseconds !== undefined && this.d === null) {
      this.d = observation.fromMicroseconds;
      this.e = { w: wallMicroseconds, m: observation.fromMicroseconds };
    }
    const next = new Map<string, HeldHistory<ElectronicsLedTemporalSample>>();
    for (const component of observation.components) {
      const electrical = result.components.find(
        (entry) => entry.componentId === component.componentId,
      );
      const final = component.samples.at(-1)!;
      const previous = this.b.get(component.componentId);
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
        this.d ?? observation.toMicroseconds,
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
          this.c.get(indicator.componentId),
          indicator,
          observation.fromMicroseconds,
          observation.toMicroseconds,
          this.d ?? observation.toMicroseconds,
        ),
      );
    }
    this.c = nextIndicators;
    this.a = observation.toMicroseconds;
    this.b = next;
    if (this.k && [...this.k.brightness.keys()].some((id) => !next.has(id))) this.k = null;
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
      (this.a !== null && atMicroseconds < this.a)
    ) {
      this.reset();
      return;
    }
    if (this.b.size || this.c.size) this.reset();
    this.l = {
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
    this.a = atMicroseconds;
    if (this.d === null) this.d = atMicroseconds;
  }

  /**
   * Bootstrap only a complete, entirely dark H0 that can reuse an actual native
   * OFF vector. This is not an animation-frame tick or a presentation ACK.
   */
  prepareInitialFrame(): LedPresentationFrame | null {
    if (this.j || this.k || this.d !== 0 || this.a !== 0 || this.l) return null;
    const values = this.o(0);
    if (
      !values ||
      values.brightness.size === 0 ||
      [...values.brightness.values()].some((value) => value !== 0) ||
      [...values.arduinoLStates.values()].some(Boolean)
    )
      return null;
    const frame = { ...values, token: `${this.g}:${++this.f}` };
    this.k = frame;
    return frame;
  }

  /**
   * Prepare one frame from accepted history on the shared animation-frame path.
   * The caller must acknowledge its actual joint DOM commit. A pending native
   * asset or React commit freezes this exact frame. The monotonic wall origin
   * remains unchanged; after ACK only complete accepted history can catch up.
   */
  prepareFrame(wallMicroseconds: number): LedPresentationFrame | null {
    this.h++;
    const elapsed = this.e === null ? 0 : Math.max(0, wallMicroseconds - this.e.w);
    if (this.k) return this.k;
    if (this.d === null || this.a === null) return null;
    const target = this.l
      ? this.l.atMicroseconds
      : this.j === null
        ? this.d
        : Math.min(
            this.a,
            (this.e?.m ?? this.d) +
              Math.floor(elapsed * ELECTRONICS_CLASSROOM_PACE),
          );
    const values = this.o(target);
    if (!values) {
      // Missing/truncated coverage cannot establish a displayable frame. Report
      // the discontinuity and forget it; never jump across unpresented phases.
      this.m++;
      this.reset();
      return null;
    }
    const frame: LedPresentationFrame = {
      ...values,
      token: `${this.g}:${++this.f}`,
    };
    if (this.j && !sameOpticalFrame(this.j, frame) && !this.canPublishDistinctFrame) return null;
    this.k = frame;
    return frame;
  }

  /** The only cursor commit. A native load callback alone must never call this. */
  acknowledgeFrame(
    frame: LedPresentationFrame,
    wallMicroseconds: number,
    distinctOpticalCommit = false,
  ): boolean {
    if (this.k !== frame) return false;
    const changed = distinctOpticalCommit || this.j === null || !sameOpticalFrame(this.j, frame);
    this.d = frame.atMicroseconds;
    this.j = frame;
    this.k = null;
    this.e ??= { w: wallMicroseconds, m: frame.atMicroseconds };
    if (changed) this.i = this.h;
    return true;
  }

  /** A read of the last acknowledged vector; it cannot advance model time. */
  sample(): ReadonlyMap<string, number> {
    return this.j?.brightness ?? new Map();
  }

  private n<T extends HeldPresentationSample>(samples: readonly T[], time: number) {
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
    return this.j?.arduinoLStates ?? new Map();
  }

  /** Both preparation paths sample the same complete LED/L vector. */
  private o(atMicroseconds: number): Omit<LedPresentationFrame, 'token'> | null {
    if (this.l) return this.l;
    const brightness = this.q(atMicroseconds);
    const voltages = this.p(atMicroseconds);
    if (brightness.size !== this.b.size || voltages.size !== this.c.size) return null;
    return {
      atMicroseconds,
      brightness,
      arduinoLStates: new Map([...voltages].map(([id, voltage]) => [id, voltage >= 2.5])),
    };
  }

  private p(time: number): ReadonlyMap<string, number> {
    const voltages = new Map<string, number>();
    for (const [id, { samples, completeSince }] of this.c) {
      if (completeSince > time) continue;
      const last = this.n(samples, time).at(-1);
      if (last) voltages.set(id, last.voltage);
    }
    return voltages;
  }

  private q(time: number): ReadonlyMap<string, number> {
    const brightness = new Map<string, number>();
    for (const [id, { samples, completeSince }] of this.b) {
      if (completeSince > time) continue;
      const prefix = this.n(samples, time);
      const last = prefix.at(-1);
      if (!last) continue;
      brightness.set(id, fastCycleBrightness(prefix, time) ?? last.brightness);
    }
    return brightness;
  }
}
