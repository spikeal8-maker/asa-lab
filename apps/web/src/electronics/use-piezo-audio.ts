import { useEffect } from 'react';
import type { SchematicDocument, SolveResult } from '../api';

interface PiezoVoice {
  readonly oscillator: OscillatorNode;
  readonly gain: GainNode;
  readonly waveform: OscillatorType;
}

let audioContext: AudioContext | null = null;
const voices = new Map<string, PiezoVoice>();

function stopVoice(componentId: string): void {
  const voice = voices.get(componentId);
  if (!voice) return;
  const context = audioContext;
  if (context) {
    voice.gain.gain.cancelScheduledValues(context.currentTime);
    voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.012);
    voice.oscillator.stop(context.currentTime + 0.06);
  } else {
    voice.oscillator.stop();
  }
  voices.delete(componentId);
}

function stopAllVoices(): void {
  for (const componentId of [...voices.keys()]) stopVoice(componentId);
}

/** Must be called from the simulation button gesture so browser audio policy is honoured. */
export async function unlockPiezoAudio(): Promise<void> {
  if (typeof window === 'undefined') return;
  audioContext ??= new window.AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
}

export function usePiezoAudio(
  document: SchematicDocument | null,
  result: SolveResult | null,
  simulationRunning: boolean,
): void {
  useEffect(() => {
    if (!simulationRunning || !document || !result?.solved || !audioContext) {
      stopAllVoices();
      return;
    }
    const resultByComponent = new Map(result.components.map((entry) => [entry.componentId, entry]));
    const activeIds = new Set<string>();
    for (const component of document.components) {
      if (component.kind !== 'piezo') continue;
      const componentResult = resultByComponent.get(component.id);
      const frequencyHz = Number(componentResult?.frequencyHz ?? 0);
      const soundLevel = Number(componentResult?.soundLevel ?? 0);
      if (
        componentResult?.energized !== true ||
        !Number.isFinite(frequencyHz) ||
        frequencyHz < 20 ||
        frequencyHz > 20_000 ||
        !Number.isFinite(soundLevel) ||
        soundLevel <= 0
      ) {
        stopVoice(component.id);
        continue;
      }
      activeIds.add(component.id);
      const waveform: OscillatorType =
        component.componentTypeId === 'piezo-disc' ? 'sine' : 'square';
      let voice = voices.get(component.id);
      if (!voice || voice.waveform !== waveform) {
        stopVoice(component.id);
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = waveform;
        gain.gain.value = 0;
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start();
        voice = { oscillator, gain, waveform };
        voices.set(component.id, voice);
      }
      const now = audioContext.currentTime;
      voice.oscillator.frequency.setTargetAtTime(frequencyHz, now, 0.008);
      // Educational preview volume is intentionally bounded; multiple buzzers
      // cannot each claim full speaker amplitude.
      const targetGain = Math.min(0.055, Math.max(0, soundLevel * 0.045));
      voice.gain.gain.setTargetAtTime(targetGain, now, 0.012);
    }
    for (const componentId of [...voices.keys()]) {
      if (!activeIds.has(componentId)) stopVoice(componentId);
    }
  }, [document, result, simulationRunning]);

  useEffect(() => () => stopAllVoices(), []);
}
