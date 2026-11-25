import { afterEach, expect, it, vi } from 'vitest';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';
import { ElectronicsLiveSimulationWorkerController } from '../../electronics/live-simulation-worker-controller';
import {
  ElectronicsSimulationWorkerClient,
  type ElectronicsSimulationWorkerLike,
} from '../../electronics/simulation-worker-client';
import { evaluateSimulationWorkerRequest } from '../../electronics/simulation-worker-evaluator';
import { toRoboticsWebProject } from '../robotics-project';
import { startRoboticsPreview } from '../robotics-preview-playback';
import type { RoboticsWorldState } from '../world';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('drives the saved field from its own Arduino worker observations, without updating the saved document', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 1));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const project = toRoboticsWebProject(createInitialRoboticsProject());
  const saved = JSON.stringify(project);
  const inputs: string[] = [];
  const terminate = vi.fn();
  let closed = false;
  const transport: ElectronicsSimulationWorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: () => {
      closed = true;
      terminate();
    },
    postMessage(request) {
      if (request.kind === 'cancel-generation') return;
      if (request.projectSessionId !== 'classroom-robot:project:4')
        throw Error('Unexpected version');
      if (request.kind === 'advance') {
        for (const event of request.inputEvents ?? []) inputs.push(event.operation);
      }
      setTimeout(() => {
        if (!closed)
          transport.onmessage?.({ data: evaluateSimulationWorkerRequest(request) } as MessageEvent);
      }, 0);
    },
  };
  const worker = new ElectronicsLiveSimulationWorkerController(
    new ElectronicsSimulationWorkerClient(() => transport),
  );
  const stopped = vi.fn();
  const seen: RoboticsWorldState[] = [];
  const playback = startRoboticsPreview(
    project,
    'classroom-robot:project:4',
    (frame) => seen.push(frame),
    stopped,
    worker,
  );
  try {
    await vi.waitFor(
      () => {
        expect(stopped.mock.calls).toEqual([]);
        expect(
          seen.some(
            (frame) =>
              frame.atMicroseconds > 150_000 &&
              (frame.pose.xMeters !== project.world.initialPose.xMeters ||
                frame.pose.yMeters !== project.world.initialPose.yMeters),
          ),
        ).toBe(true);
      },
      { timeout: 15000 },
    );
    playback.sendSerial('S');
    await vi.waitFor(() => expect(inputs).toContain('serialRx'), { timeout: 5000 });
    expect(inputs).toContain('distanceMeters');
    expect(JSON.stringify(project)).toBe(saved);
  } finally {
    playback.dispose();
  }
  expect(terminate).toHaveBeenCalledOnce();
  const count = seen.length;
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(seen).toHaveLength(count);
}, 25_000);
