import type {
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

function sameState(left: ElectronicsLedTemporalSample, right: ElectronicsLedTemporalSample) {
  return left.brightness === right.brightness && left.current === right.current;
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

function recentSamples(
  previous: readonly ElectronicsLedTemporalSample[] | undefined,
  component: ElectronicsLedTemporalComponent,
  to: number,
  cursor = to,
): readonly ElectronicsLedTemporalSample[] {
  const first = component.samples[0]!;
  const previousEnd = previous?.at(-1);
  const continuous =
    !component.truncated &&
    previousEnd?.atMicroseconds === first.atMicroseconds &&
    sameState(previousEnd, first);
  const combined = continuous
    ? [...previous!.slice(0, -1), ...component.samples]
    : [...component.samples];
  const samples: ElectronicsLedTemporalSample[] = [];
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
): boolean {
  const cursors: Array<{
    samples: readonly ElectronicsLedTemporalSample[];
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
  // Intersect actual held intervals. Every advance consumes a real sample;
  // values found at different times cannot establish a joint optical state.
  while (at <= to) {
    let next = at;
    for (const channel of cursors) {
      const { samples, value } = channel;
      while (channel.index + 1 < samples.length && samples[channel.index + 1]!.atMicroseconds <= at)
        channel.index++;
      while (channel.index < samples.length && samples[channel.index]!.brightness !== value)
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
  private cursor: number | null = null;
  private sampledAt: number | null = null;
  private desiredEpoch: { at: number; cursor: number; lookahead: number } | null = null;
  private buffered = false;
  private warming = true;
  private receipts: Array<{
    at: number;
    samples: ReadonlyMap<string, readonly ElectronicsLedTemporalSample[]>;
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
      if (
        !electrical ||
        electrical.brightness !== final.brightness ||
        electrical.current !== final.current ||
        electrical.junctionState === 'reverse_blocking' ||
        electrical.presentationState === 'failed' ||
        electrical.deviceHealth === 'failed_open' ||
        electrical.damageState === 'failed'
      )
        continue;
      const previous = this.histories.get(component.componentId);
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
      size: Math.max(1, ...observation.components.map((component) => component.samples.length)),
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
    let matching = this.receipts.length - 1;
    while (matching >= 0 && !containsJointState(this.receipts[matching]!.samples, joint))
      matching--;
    const witness = this.receipts[matching];
    const finalMatches =
      witness &&
      [...joint].every(([id, value]) => witness.samples.get(id)?.at(-1)?.brightness === value);
    // An intermediate state is already superseded by this receipt's different
    // closing vector. It must not acquire another50ms from a later receipt.
    const supersededAt = witness && !finalMatches ? witness.at : this.receipts[matching + 1]?.at;
    const expired =
      matching < 0 ||
      (supersededAt !== undefined &&
        wallMicroseconds - supersededAt >= MAX_SUPERSEDED_MICROSECONDS);
    if (brightness.size !== this.histories.size || expired) {
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
    if (!epoch || (!this.warming && !this.buffered) || !this.histories.size) return;
    const desired = epoch.cursor + Math.max(0, wallMicroseconds - epoch.at - epoch.lookahead);
    const target = Math.min(this.committed!, desired);
    if (target <= this.cursor!) return;
    // Recover only time spent in one proved joint hold. A matching final value
    // cannot hide an intervening edge, a current change or truncated coverage.
    for (const [id, samples] of this.histories) {
      if (
        (this.completeSince.get(id) ?? Infinity) > this.cursor! ||
        samples[0]!.atMicroseconds > this.cursor! ||
        samples.at(-1)!.atMicroseconds < target
      )
        return;
      let held: ElectronicsLedTemporalSample | undefined;
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

  private throughCursor(samples: readonly ElectronicsLedTemporalSample[]) {
    let end = samples.length - 1;
    while (end >= 0 && samples[end]!.atMicroseconds > this.cursor!) end--;
    if (end < 0) return [];
    const prefix = samples.slice(0, end + 1);
    const last = prefix.at(-1)!;
    if (last.atMicroseconds < this.cursor!) prefix.push({ ...last, atMicroseconds: this.cursor! });
    return prefix;
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
