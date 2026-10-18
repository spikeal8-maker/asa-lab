import type { ComponentResult } from './solver.js';

/** A held electrical state, obtained from the solver, never from a GPIO or a sketch. */
export interface ElectronicsLedTemporalSample {
  readonly atMicroseconds: number;
  readonly brightness: number;
  readonly current: number;
}

export interface ElectronicsLedTemporalComponent {
  readonly componentId: string;
  /** Integral of the model's nonlinear optical brightness, in percent * microseconds. */
  readonly brightnessIntegral: number;
  readonly litDurationMicroseconds: number;
  readonly transitionCount: number;
  /** Bounded, ordered tail; the last sample is the actual state at the ready horizon. */
  readonly samples: readonly ElectronicsLedTemporalSample[];
  readonly truncated: boolean;
}

/** Presentation metadata only. It is neither physical state nor a resumable continuation. */
export interface ElectronicsLedTemporalObservation {
  readonly profile: 'ordinary-led-held-v1';
  readonly fromMicroseconds: number;
  readonly toMicroseconds: number;
  readonly components: readonly ElectronicsLedTemporalComponent[];
}

export type LedElectricalObserver = (
  atMicroseconds: number,
  components: readonly ComponentResult[],
) => void;

const MAX_SAMPLES_PER_LED = 512;

interface LedHistory {
  readonly componentId: string;
  readonly samples: ElectronicsLedTemporalSample[];
  head: number;
  size: number;
  truncated: boolean;
  brightnessIntegral: number;
  litDurationMicroseconds: number;
  transitionCount: number;
}

function last(history: LedHistory, offset = 0): ElectronicsLedTemporalSample {
  return history.samples[(history.head + history.size - 1 - offset) % MAX_SAMPLES_PER_LED]!;
}

function sameState(left: ElectronicsLedTemporalSample, right: ElectronicsLedTemporalSample) {
  return left.brightness === right.brightness && left.current === right.current;
}

function append(history: LedHistory, sample: ElectronicsLedTemporalSample): void {
  if (history.size === MAX_SAMPLES_PER_LED) {
    history.samples[history.head] = sample;
    history.head = (history.head + 1) % MAX_SAMPLES_PER_LED;
    history.truncated = true;
  } else {
    history.samples[(history.head + history.size++) % MAX_SAMPLES_PER_LED] = sample;
  }
}

/** One request owns this collector across private scheduler yields and discards it on fault. */
export function createLedTemporalObservation(
  componentIds: readonly string[],
  fromMicroseconds: number,
) {
  const histories: LedHistory[] = componentIds.map((componentId) => ({
    componentId,
    samples: [],
    head: 0,
    size: 0,
    truncated: false,
    brightnessIntegral: 0,
    litDurationMicroseconds: 0,
    transitionCount: 0,
  }));
  let at: number | null = null;
  let valid = histories.length > 0 && new Set(componentIds).size === componentIds.length;

  const observe: LedElectricalObserver = (sampleTime, components) => {
    if (!valid) return;
    // The existing initial checkpoint observation describes the held state at C.
    // It must not contribute optical energy from before this request's interval.
    const time = Math.max(fromMicroseconds, sampleTime);
    if (!Number.isSafeInteger(time) || time < 0 || (at !== null && time < at)) {
      valid = false;
      return;
    }
    for (const history of histories) {
      const result = components.find((entry) => entry.componentId === history.componentId);
      if (
        !result ||
        !Number.isFinite(result.brightness) ||
        result.brightness! < 0 ||
        result.brightness! > 100 ||
        !Number.isFinite(result.current) ||
        (result.brightness! > 0 &&
          (!result.lit ||
            result.current <= 0 ||
            result.junctionState === 'reverse_blocking' ||
            result.presentationState === 'failed' ||
            result.deviceHealth === 'failed_open' ||
            result.damageState === 'failed'))
      ) {
        valid = false;
        return;
      }
      const sample: ElectronicsLedTemporalSample = {
        atMicroseconds: time,
        brightness: result.brightness!,
        current: result.current,
      };
      if (at === null) {
        append(history, sample);
        continue;
      }
      const previous = last(history);
      const duration = time - at;
      history.brightnessIntegral += previous.brightness * duration;
      if (previous.brightness > 0) history.litDurationMicroseconds += duration;
      if (sameState(previous, sample)) continue;
      if (previous.atMicroseconds === time) {
        // A barrier can settle old and new GPIO at the same time. Only its final
        // state has a duration; replace it, including a transition that reverts.
        const before = history.size > 1 ? last(history, 1) : null;
        if (before) {
          history.transitionCount +=
            Number(before.brightness !== sample.brightness) -
            Number(before.brightness !== previous.brightness);
        }
        history.samples[(history.head + history.size - 1) % MAX_SAMPLES_PER_LED] = sample;
        if (before && sameState(before, sample)) history.size--;
      } else {
        if (previous.brightness !== sample.brightness) history.transitionCount++;
        append(history, sample);
      }
    }
    at = time;
  };

  return {
    observe,
    finish(toMicroseconds: number): ElectronicsLedTemporalObservation | null {
      if (!valid || at !== toMicroseconds || toMicroseconds < fromMicroseconds) return null;
      return {
        profile: 'ordinary-led-held-v1',
        fromMicroseconds,
        toMicroseconds,
        components: histories.map((history) => {
          const samples = Array.from({ length: history.size }, (_, index) => ({
            ...history.samples[(history.head + index) % MAX_SAMPLES_PER_LED]!,
          }));
          const final = last(history);
          if (final.atMicroseconds !== toMicroseconds)
            samples.push({ ...final, atMicroseconds: toMicroseconds });
          return {
            componentId: history.componentId,
            brightnessIntegral: history.brightnessIntegral,
            litDurationMicroseconds: history.litDurationMicroseconds,
            transitionCount: history.transitionCount,
            samples,
            truncated: history.truncated,
          };
        }),
      };
    },
  };
}
