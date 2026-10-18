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
    (sample) => sample.atMicroseconds >= to - HISTORY_MICROSECONDS,
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

/** Only accepted optical observations are retained; electrical results stay untouched. */
export class LedTemporalPresentation {
  private committed: number | null = null;
  private histories = new Map<string, readonly ElectronicsLedTemporalSample[]>();

  reset(): void {
    this.committed = null;
    this.histories.clear();
  }

  accept(
    result: SolveResult,
    observation?: ElectronicsLedTemporalObservation,
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
    const next = new Map<string, readonly ElectronicsLedTemporalSample[]>();
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
      const samples = recentSamples(
        this.histories.get(component.componentId),
        component,
        observation.toMicroseconds,
      );
      next.set(component.componentId, samples);
      const mean = fastCycleBrightness(samples, observation.toMicroseconds);
      if (mean !== undefined) brightness.set(component.componentId, mean);
    }
    this.committed = observation.toMicroseconds;
    this.histories = next;
    return brightness;
  }
}
