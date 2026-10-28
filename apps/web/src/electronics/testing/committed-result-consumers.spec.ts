/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import { NativeOpticalProvider, ProductionComponentVisual } from '../NativeOpticalComponentVisual';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../native-optical-presentation';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { catalogEntry } from '../component-catalog';
import { unlockPiezoAudio, usePiezoAudio } from '../use-piezo-audio';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const schematic: SchematicDocument = {
  schemaVersion: 4,
  components: ['piezo-disc', 'piezo-passive-buzzer'].map((componentTypeId) => ({
    id: componentTypeId,
    componentTypeId,
    kind: 'piezo',
    value: 0,
    position: { x: 0, y: 0 },
  })),
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};
function observation(frequencyHz = 2300, soundLevel = 0.8): NativeOpticalObservation {
  return {
    result: {
      solved: true,
      status: 'solved',
      components: schematic.components.map((component) => ({
        componentId: component.id,
        terminalVoltages: {},
        frequencyHz,
        soundLevel,
        energized: soundLevel > 0,
      })),
    } as SolveResult,
    frame: {
      token: `${frequencyHz}:${soundLevel}`,
      atMicroseconds: 5621200,
      brightness: new Map(),
      arduinoLStates: new Map(),
    },
    ledAssets: new Map(),
  };
}
const oscillators: Array<{
  frequency: ReturnType<typeof parameter>;
  stop: ReturnType<typeof vi.fn>;
  type: string;
}> = [];
const gains: Array<{ gain: ReturnType<typeof parameter> }> = [];
function parameter() {
  return { value: 0, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
}
class AudioContextStub {
  state = 'running';
  currentTime = 0;
  destination = {};
  createOscillator() {
    const oscillator = {
      frequency: parameter(),
      stop: vi.fn(),
      start: vi.fn(),
      type: 'sine',
      connect: vi.fn((target) => target),
    };
    oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const gain = { gain: parameter(), connect: vi.fn() };
    gains.push(gain);
    return gain;
  }
}
let root: Root;
let host: HTMLDivElement;
let port: NativeOpticalPresentation;
let parentRenders: number;
function Probe({
  running = true,
  document = schematic,
  presentation = port,
}: {
  running?: boolean;
  document?: SchematicDocument;
  presentation?: NativeOpticalPresentation;
}) {
  parentRenders++;
  usePiezoAudio(document, presentation, running);
  return createElement(
    NativeOpticalProvider,
    { port: presentation },
    createElement(
      'svg',
      null,
      ...document.components.map((component) => {
        const entry = catalogEntry(component);
        if (!entry) throw new Error(`Missing fixture catalog entry: ${component.componentTypeId}`);
        return createElement(ProductionComponentVisual, {
          key: component.id,
          component,
          entry,
          width: 80,
          height: 80,
          visualState: 'default',
          simulationRunning: running,
        });
      }),
    ),
  );
}
beforeEach(async () => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'apps/web/public/assets/electronics/component-database/catalog.json',
        ),
        'utf8',
      ),
    ),
  );
  vi.stubGlobal('AudioContext', AudioContextStub);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  oscillators.length = 0;
  gains.length = 0;
  parentRenders = 0;
  port = new NativeOpticalPresentation();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await unlockPiezoAudio();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('committed piezo consumers without editor reconciliation', () => {
  it('delivers asynchronous commits to both real visuals and audio with bounded voices and subscriptions', async () => {
    const subscribe = vi.spyOn(port, 'subscribe');
    await act(async () => root.render(createElement(Probe)));
    const renders = parentRenders;
    const subscriptions = subscribe.mock.calls.length;
    const expectVisuals = (frequency: string, sounding: string) => {
      const visuals = host.querySelectorAll('[data-piezo-frequency]');
      expect(visuals).toHaveLength(2);
      for (const visual of visuals) {
        expect(visual.getAttribute('data-piezo-frequency')).toBe(frequency);
        expect(visual.getAttribute('data-piezo-sounding')).toBe(sounding);
      }
    };
    expectVisuals('0', 'false');
    const next = observation();
    await act(async () => port.setObservation(next, true));
    expectVisuals('0', 'false');
    expect(oscillators).toHaveLength(0);
    await act(async () => port.commit(next));
    expectVisuals('2300', 'true');
    expect(oscillators).toHaveLength(2);
    for (const oscillator of oscillators)
      expect(oscillator.frequency.setTargetAtTime).toHaveBeenCalledWith(2300, 0, 0.008);
    for (let i = 0; i < 100; i++) await act(async () => port.setObservation(observation()));
    expect(parentRenders).toBe(renders);
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
    expect(oscillators).toHaveLength(2);
    for (const oscillator of oscillators)
      expect(oscillator.frequency.setTargetAtTime).toHaveBeenCalledTimes(1);
    for (const gain of gains) expect(gain.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    await act(async () => port.setObservation(observation(2300, 0)));
    expectVisuals('2300', 'false');
    for (const oscillator of oscillators) expect(oscillator.stop).toHaveBeenCalledTimes(1);
  });

  it('silences hidden, generation-pending, stopped and unmounted consumers and rejects obsolete commits', async () => {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => port.setObservation(observation()));
    const old = observation(440);
    await act(async () => port.setObservation(old, true));
    await act(async () => port.setObservation(null));
    await act(async () => port.commit(old));
    expect(port.getSnapshot().committed).toBeNull();
    expect(host.querySelector('[data-piezo-sounding="true"]')).toBeNull();
    expect(oscillators).toHaveLength(2);
    for (const oscillator of oscillators) expect(oscillator.stop).toHaveBeenCalledTimes(1);
    await act(async () => port.setObservation(observation()));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    for (const oscillator of oscillators) expect(oscillator.stop).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => root.render(createElement(Probe, { running: false })));
    for (const oscillator of oscillators) expect(oscillator.stop).toHaveBeenCalledTimes(1);
    const count = oscillators.length;
    await act(async () => port.setObservation(observation()));
    expect(oscillators).toHaveLength(count);
    const replacement = new NativeOpticalPresentation();
    await act(async () =>
      root.render(
        createElement(Probe, {
          presentation: replacement,
          document: { ...schematic, components: [schematic.components[0]!] },
        }),
      ),
    );
    await act(async () => port.setObservation(observation()));
    expect(oscillators).toHaveLength(count);
    await act(async () => replacement.setObservation(observation()));
    expect(oscillators).toHaveLength(count + 1);
    await act(async () => root.unmount());
    expect(oscillators.at(-1)!.stop).toHaveBeenCalledTimes(1);
    await act(async () => replacement.setObservation(observation()));
    expect(oscillators).toHaveLength(count + 1);
  });
});
