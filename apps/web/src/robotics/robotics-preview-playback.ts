import { createRoboticsRuntime } from '@asa-lab/robotics/runtime';
import {
  measureRoboticsDistance,
  ROBOTICS_RUN_LIMIT_MICROSECONDS,
  ROBOTICS_SENSOR_INTERVAL_MICROSECONDS,
  type RoboticsWorldState,
} from './world';
import { ElectronicsLiveSimulationWorkerController } from '../electronics/live-simulation-worker-controller';
import { ElectronicsSimulationWorkerClient } from '../electronics/simulation-worker-client';
import { classroomRequestedHorizon } from '../electronics/led-temporal-presentation';
import { simulationFailureMessage } from '../electronics/simulation-failure';
import type { RoboticsProject } from './robotics-project';

/** Run the saved Arduino circuit and feed its committed motor speeds into the field physics.
 * Operator inputs and sonar samples live only in this worker generation. */
export function startRoboticsPreview(
  project: RoboticsProject,
  sessionId: string,
  onFrame: (state: RoboticsWorldState) => void,
  onStopped: (message: string) => void,
  worker = new ElectronicsLiveSimulationWorkerController(
    new ElectronicsSimulationWorkerClient(undefined, 4000),
  ),
) {
  const physics = createRoboticsRuntime(project.world);
  const { bindings } = project.world;
  let circuit = project.circuit;
  let active = true;
  let started = performance.now();
  let ready = false;
  let offset = 0;
  let horizon = 0;
  let lastSensor = 0;
  let frame = 0;
  const demand = () =>
    offset +
    Math.min(
      ROBOTICS_RUN_LIMIT_MICROSECONDS,
      classroomRequestedHorizon(0, (performance.now() - started) * 1000, horizon),
    );
  function dispose() {
    active = false;
    cancelAnimationFrame(frame);
    worker.dispose();
  }
  function finish(message: string) {
    if (!active) return;
    dispose();
    onStopped(message);
  }
  function tick() {
    if (!active) return;
    if (performance.now() - started >= 300_000) {
      finish('Время просмотра истекло.');
      return;
    }
    if (ready) worker.update(circuit, demand());
    if (active) frame = requestAnimationFrame(tick);
  }
  worker.start(sessionId, circuit, {
    inputEventLimit: 1000,
    onInitialReady: (hostOffset) => {
      offset = hostOffset;
      ready = true;
      started = performance.now();
    },
    onCommittedHorizon: (committed) => {
      horizon = committed;
    },
    readHostHorizonMicroseconds: () => (active && ready ? demand() : null),
    onFailure: (reason) => finish(simulationFailureMessage(reason).text),
    onResult: (result) => {
      if (!active) return;
      if (!result.solved || result.status !== 'solved' || result.quality?.passed !== true) {
        finish('Не удалось рассчитать схему робота.');
        return;
      }
      const rpm = (id: string) =>
        result.components.find((part) => part.componentId === id)?.outputRpm;
      const leftRpm = rpm(bindings.leftMotorId);
      const rightRpm = rpm(bindings.rightMotorId);
      if (
        leftRpm === undefined ||
        rightRpm === undefined ||
        !Number.isFinite(leftRpm) ||
        !Number.isFinite(rightRpm)
      ) {
        finish('Не удалось определить обороты двигателей.');
        return;
      }
      const state = physics.advance({ atMicroseconds: horizon, leftRpm, rightRpm });
      onFrame(state);
      if (horizon >= ROBOTICS_RUN_LIMIT_MICROSECONDS || state.haltReason) {
        finish(
          horizon >= ROBOTICS_RUN_LIMIT_MICROSECONDS
            ? 'Завершены 40 секунд моделирования.'
            : state.haltReason!,
        );
        return;
      }
      if (horizon - lastSensor < ROBOTICS_SENSOR_INTERVAL_MICROSECONDS) return;
      lastSensor = horizon;
      const measurement = measureRoboticsDistance(
        project.world,
        state.pose,
        state.balls,
        state.bodies,
      );
      if (
        measurement.status !== 'ok' &&
        (measurement.status !== 'no-echo' || project.schemaVersion !== 3)
      ) {
        finish(measurement.message);
        return;
      }
      const echo =
        measurement.status === 'ok'
          ? { distanceMeters: measurement.distanceMeters, echoAvailable: true }
          : { echoAvailable: false };
      circuit = {
        ...circuit,
        components: circuit.components.map((component) =>
          component.id === bindings.distanceSensorId
            ? { ...component, stateProperties: { ...component.stateProperties, ...echo } }
            : component,
        ),
      };
    },
  });
  if (active) frame = requestAnimationFrame(tick);
  return {
    dispose,
    sendSerial(command: string) {
      if (active && ready) worker.sendSerialRx(bindings.boardId, command, demand());
    },
  };
}
