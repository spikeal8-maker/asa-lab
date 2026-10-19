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
// Leave one 60 Hz paint handoff inside the existing 50 ms publication allowance.
const MAX_SUPERSEDED_MICROSECONDS = 50_000 - 1_000_000 / 60;

type HeldPresentationSample = ElectronicsLedTemporalSample | ElectronicsArduinoIndicatorSample;

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

function recentSamples<T extends HeldPresentationSample>(
  previous: readonly T[] | undefined,
  component: { readonly samples: readonly T[]; readonly truncated: boolean },
  to: number,
  cursor = to,
): readonly T[] {
  const first = component.samples[0]!;
  const previousEnd = previous?.at(-1);
  const continuous =
    !component.truncated &&
    previousEnd?.atMicroseconds === first.atMicroseconds &&
    sameState(previousEnd, first);
  const combined = continuous
    ? [...previous!.slice(0, -1), ...component.samples]
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
  return samples.slice(Math.max(0, firstRecent - 1, samples.length - MAX_HISTORY_SAMPLES));
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

function containsJointState(
  channels: ReadonlyMap<string, readonly ElectronicsLedTemporalSample[]>,
  brightness: ReadonlyMap<string, number>,
  indicators: ReadonlyMap<string, readonly ElectronicsArduinoIndicatorSample[]>,
  voltages: ReadonlyMap<string, number>,
): boolean {
  const cursors: Array<{
    samples: readonly HeldPresentationSample[];
    index: number;
    value: number;
  }> = [];
  let at = 0;
  let to = Infinity;
  for (const [id, value] of brightness) {
    const samples = channels.get(id);
    if (!samples?.length) return false;
    at = Math.max(at, samples[0]!.atMicroseconds);
    to = Math.min(to, samples.at(-1)!.atMicroseconds);
    cursors.push({ samples, index: 0, value });
  }
  for (const [id, value] of voltages) {
    const samples = indicators.get(id);
    if (!samples?.length) return false;
    at = Math.max(at, samples[0]!.atMicroseconds);
    to = Math.min(to, samples.at(-1)!.atMicroseconds);
    cursors.push({ samples, index: 0, value });
  }
  // Intersect actual held intervals. Every advance consumes a real sample;
  // values found at different times cannot establish a joint optical state.
  while (at <= to) {
    let next = at;
    for (const channel of cursors) {
      const { samples, value } = channel;
      while (channel.index + 1 < samples.length && samples[channel.index + 1]!.atMicroseconds <= at)
        channel.index++;
      while (channel.index < samples.length && heldValue(samples[channel.index]!) !== value)
        channel.index++;
      if (channel.index === samples.length) return false;
      next = Math.max(next, samples[channel.index]!.atMicroseconds);
    }
    if (next === at) return true;
    at = next;
  }
  return false;
}

/** Only accepted optical observations are retained; electrical results stay untouched. */
export class LedTemporalPresentation {
  private committed: number | null = null;
  private histories = new Map<string, readonly ElectronicsLedTemporalSample[]>();
  private completeSince = new Map<string, number>();
  private indicatorHistories = new Map<string, readonly ElectronicsArduinoIndicatorSample[]>();
  private indicatorCompleteSince = new Map<string, number>();
  private cursor: number | null = null;
  private sampledAt: number | null = null;
  private desiredEpoch: { at: number; cursor: number; lookahead: number } | null = null;
  private buffered = false;
  private warming = true;
  private receipts: Array<{
    at: number;
    samples: ReadonlyMap<string, readonly ElectronicsLedTemporalSample[]>;
    indicators: ReadonlyMap<string, readonly ElectronicsArduinoIndicatorSample[]>;
    size: number;
  }> = [];
  private reanchors = 0;
  private heldRecoveries = 0;
  private heldMicroseconds = 0;

  /** A discontinuity is observable evidence, never successful phase preservation. */
  get reanchorCount(): number {
    return this.reanchors;
  }

  /** Lifetime accounting, separate from genuine optical discontinuities. */
  get heldRecoveryCount(): number {
    return this.heldRecoveries;
  }

  get heldRecoveredMicroseconds(): number {
    return this.heldMicroseconds;
  }

  reset(): void {
    this.committed = null;
    this.histories.clear();
    this.completeSince.clear();
    this.indicatorHistories.clear();
    this.indicatorCompleteSince.clear();
    this.cursor = null;
    this.sampledAt = null;
    this.desiredEpoch = null;
    this.buffered = false;
    this.warming = true;
    this.receipts = [];
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
    if (this.committed !== observation.fromMicroseconds) this.reset();
    if (wallMicroseconds !== undefined && this.cursor === null) {
      this.cursor = observation.fromMicroseconds;
      this.sampledAt = wallMicroseconds;
      this.desiredEpoch = {
        at: wallMicroseconds,
        cursor: observation.fromMicroseconds,
        // A caller may begin with an already complete window rather than H0.
        lookahead: Math.max(
          0,
          LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS -
            (observation.toMicroseconds - observation.fromMicroseconds),
        ),
      };
    }
    const next = new Map<string, readonly ElectronicsLedTemporalSample[]>();
    const nextCompleteSince = new Map<string, number>();
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
            previous?.some((sample) => sample.brightness !== 0 || sample.current > 0))) ||
        electrical.presentationState === 'failed' ||
        electrical.deviceHealth === 'failed_open' ||
        electrical.damageState === 'failed'
      )
        continue;
      const previousEnd = previous?.at(-1);
      const first = component.samples[0]!;
      const continuous =
        previousEnd !== undefined &&
        previousEnd.atMicroseconds === first.atMicroseconds &&
        sameState(previousEnd, first);
      nextCompleteSince.set(
        component.componentId,
        component.truncated
          ? observation.toMicroseconds
          : continuous
            ? (this.completeSince.get(component.componentId) ?? observation.fromMicroseconds)
            : observation.fromMicroseconds,
      );
      const samples = recentSamples(
        previous,
        component,
        observation.toMicroseconds,
        this.cursor ?? observation.toMicroseconds,
      );
      next.set(component.componentId, samples);
      const mean = fastCycleBrightness(samples, observation.toMicroseconds);
      if (mean !== undefined) brightness.set(component.componentId, mean);
    }
    const nextIndicators = new Map<string, readonly ElectronicsArduinoIndicatorSample[]>();
    const nextIndicatorCompleteSince = new Map<string, number>();
    for (const indicator of arduinoIndicators) {
      const electrical = result.components.find(
        (entry) => entry.componentId === indicator.componentId,
      );
      const final = indicator.samples.at(-1)!;
      if (!electrical || electrical.terminalVoltages.d13 !== final.voltage) {
        this.reset();
        return new Map();
      }
      const previous = this.indicatorHistories.get(indicator.componentId);
      const previousEnd = previous?.at(-1);
      const first = indicator.samples[0]!;
      const continuous =
        previousEnd !== undefined &&
        previousEnd.atMicroseconds === first.atMicroseconds &&
        sameState(previousEnd, first);
      nextIndicatorCompleteSince.set(
        indicator.componentId,
        indicator.truncated
          ? observation.toMicroseconds
          : continuous
            ? (this.indicatorCompleteSince.get(indicator.componentId) ??
              observation.fromMicroseconds)
            : observation.fromMicroseconds,
      );
      nextIndicators.set(
        indicator.componentId,
        recentSamples(
          previous,
          indicator,
          observation.toMicroseconds,
          this.cursor ?? observation.toMicroseconds,
        ),
      );
    }
    this.indicatorHistories = nextIndicators;
    this.indicatorCompleteSince = nextIndicatorCompleteSince;
    this.committed = observation.toMicroseconds;
    this.histories = next;
    this.completeSince = nextCompleteSince;
    if (wallMicroseconds === undefined) return brightness;
    this.receipts.push({
      at: wallMicroseconds,
      samples: new Map(
        observation.components
          .filter((component) => next.has(component.componentId))
          .map((component) => [component.componentId, component.samples]),
      ),
      indicators: new Map(
        arduinoIndicators.map((indicator) => [indicator.componentId, indicator.samples]),
      ),
      size: Math.max(
        1,
        ...observation.components.map((component) => component.samples.length),
        ...arduinoIndicators.map((indicator) => indicator.samples.length),
      ),
    });
    // Across all receipts, retain at most513 samples per channel. Reuse only
    // accepted optical arrays, never a canonical result/continuation clone.
    let retained = 0;
    this.receipts = this.receipts
      .filter(
        (_, index, all) =>
          index === all.length - 1 || all[index + 1]!.at >= wallMicroseconds - 50_000,
      )
      .reverse()
      .filter((receipt) => (retained += receipt.size) <= MAX_HISTORY_SAMPLES)
      .reverse();
    return this.sample(wallMicroseconds);
  }

  /** Advance only the optical cursor; no host tick becomes a physical frame. */
  sample(wallMicroseconds: number): ReadonlyMap<string, number> {
    if (this.cursor === null || this.committed === null || this.sampledAt === null)
      return new Map();
    const elapsed = Math.max(0, wallMicroseconds - this.sampledAt);
    this.sampledAt = wallMicroseconds;
    if (this.buffered) this.cursor = Math.min(this.committed, this.cursor + elapsed);
    else if (this.committed - this.cursor >= LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS) {
      // Preserve the initial full-window lookahead at H0. If partial ready
      // data already advanced startup, do not discard elapsed time here.
      if (this.warming && this.cursor > 0)
        this.cursor = Math.min(this.committed, this.cursor + elapsed);
      this.buffered = true;
      this.warming = false;
    } else if (this.warming) {
      // A partial startup window is already complete physical data. Pace it
      // at 1x, clamped to ready, rather than holding a superseded H0 vector.
      this.cursor = Math.min(this.committed, this.cursor + elapsed);
    }
    if (!this.desiredEpoch && this.buffered) {
      // An actual reanchor starts a new segment only after the original rebuffer
      // hold. It cannot borrow elapsed time from the discarded segment.
      this.desiredEpoch = { at: wallMicroseconds, cursor: this.cursor, lookahead: 0 };
    }
    this.recoverHeldTime(wallMicroseconds);

    let brightness = this.atCursor();
    // A cycle mean keeps its existing policy; provenance refers to the actual
    // underlying joint electrical state at that same presentation cursor.
    const joint = this.atCursor(false);
    const voltages = this.indicatorVoltagesAtCursor();
    let matching = this.receipts.length - 1;
    while (
      matching >= 0 &&
      !containsJointState(
        this.receipts[matching]!.samples,
        joint,
        this.receipts[matching]!.indicators,
        voltages,
      )
    )
      matching--;
    const witness = this.receipts[matching];
    const finalMatches =
      witness &&
      [...joint].every(([id, value]) => witness.samples.get(id)?.at(-1)?.brightness === value) &&
      [...voltages].every(([id, value]) => witness.indicators.get(id)?.at(-1)?.voltage === value);
    // An intermediate state is already superseded by this receipt's different
    // closing vector. It must not acquire another50ms from a later receipt.
    const supersededAt = witness && !finalMatches ? witness.at : this.receipts[matching + 1]?.at;
    const expired =
      matching < 0 ||
      (supersededAt !== undefined &&
        wallMicroseconds - supersededAt >= MAX_SUPERSEDED_MICROSECONDS);
    if (
      brightness.size !== this.histories.size ||
      voltages.size !== this.indicatorHistories.size ||
      expired
    ) {
      // Starvation cannot be repaired by accelerating or stretching a waveform.
      // Discard this playout segment and resume from actual complete-ready data.
      this.cursor = this.committed;
      this.buffered = false;
      this.desiredEpoch = null;
      this.reanchors++;
      brightness = this.atCursor();
    }
    return brightness;
  }

  private recoverHeldTime(wallMicroseconds: number): void {
    const epoch = this.desiredEpoch;
    if (
      !epoch ||
      (!this.warming && !this.buffered) ||
      (!this.histories.size && !this.indicatorHistories.size)
    )
      return;
    const desired = epoch.cursor + Math.max(0, wallMicroseconds - epoch.at - epoch.lookahead);
    const target = Math.min(this.committed!, desired);
    if (target <= this.cursor!) return;
    // Recover only time spent in one proved joint hold. A matching final value
    // cannot hide an intervening edge, a current change or truncated coverage.
    const channels: Array<{ samples: readonly HeldPresentationSample[]; completeSince: number }> = [
      ...[...this.histories].map(([id, samples]) => ({
        samples,
        completeSince: this.completeSince.get(id) ?? Infinity,
      })),
      ...[...this.indicatorHistories].map(([id, samples]) => ({
        samples,
        completeSince: this.indicatorCompleteSince.get(id) ?? Infinity,
      })),
    ];
    for (const { samples, completeSince } of channels) {
      if (
        completeSince > this.cursor! ||
        samples[0]!.atMicroseconds > this.cursor! ||
        samples.at(-1)!.atMicroseconds < target
      )
        return;
      let held: HeldPresentationSample | undefined;
      for (const sample of samples) {
        if (sample.atMicroseconds <= this.cursor!) held = sample;
        else if (sample.atMicroseconds > target) break;
        else if (!held || !sameState(held, sample)) return;
      }
      if (!held) return;
    }
    this.heldMicroseconds += target - this.cursor!;
    this.heldRecoveries++;
    this.cursor = target;
  }

  private throughCursor<T extends HeldPresentationSample>(samples: readonly T[]) {
    let end = samples.length - 1;
    while (end >= 0 && samples[end]!.atMicroseconds > this.cursor!) end--;
    if (end < 0) return [];
    const prefix = samples.slice(0, end + 1);
    const last = prefix.at(-1)!;
    if (last.atMicroseconds < this.cursor!) prefix.push({ ...last, atMicroseconds: this.cursor! });
    return prefix;
  }

  /** Values for the renderer at the exact cursor used by sample(), not latest-ready GPIO. */
  arduinoLStates(): ReadonlyMap<string, boolean> {
    return new Map(
      [...this.indicatorVoltagesAtCursor()].map(([id, voltage]) => [id, voltage >= 2.5]),
    );
  }

  private indicatorVoltagesAtCursor(): ReadonlyMap<string, number> {
    const voltages = new Map<string, number>();
    if (this.cursor === null) return voltages;
    for (const [id, samples] of this.indicatorHistories) {
      const last = this.throughCursor(samples).at(-1);
      if (last) voltages.set(id, last.voltage);
    }
    return voltages;
  }

  private atCursor(average = true): ReadonlyMap<string, number> {
    const brightness = new Map<string, number>();
    for (const [id, samples] of this.histories) {
      const prefix = this.throughCursor(samples);
      const last = prefix.at(-1);
      if (!last) continue;
      brightness.set(
        id,
        (average ? fastCycleBrightness(prefix, this.cursor!) : undefined) ?? last.brightness,
      );
    }
    return brightness;
  }
}
