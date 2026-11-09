/** The only package entry importing Planck. No world state lives in React/render clocks. */
import { isRoboticsWorldV3, type RoboticsWorldDocument } from './world-document.js';
import {
  advanceRoboticsWorld,
  createRoboticsWorldState,
  parseRoboticsWorldDocument,
  ROBOTICS_PHYSICS_LIMITS,
  ROBOTICS_RUN_LIMIT_MICROSECONDS,
  type RoboticsDriveFrame,
  type RoboticsWorldState,
} from './world.js';
import { createPlanckRoboticsPhysics } from './world-physics-planck.js';

export interface RoboticsRuntime {
  read(): RoboticsWorldState;
  advance(frame: RoboticsDriveFrame): RoboticsWorldState;
}
export function createRoboticsRuntime(input: RoboticsWorldDocument): RoboticsRuntime {
  const parsed = parseRoboticsWorldDocument(input);
  if (!parsed.ok) throw new Error(parsed.message);
  const world = parsed.world;
  let state = createRoboticsWorldState(world);
  const read = (): RoboticsWorldState => structuredClone(state);
  if (!isRoboticsWorldV3(world))
    return {
      read,
      advance: (frame) => {
        state = advanceRoboticsWorld(world, state, frame);
        return read();
      },
    };
  const physics = createPlanckRoboticsPhysics(world);
  const complete = 'Завершены 40 секунд модельного времени. Для нового опыта нажмите «Сбросить».';
  const fail = (message: string): RoboticsWorldState => {
    state = { ...state, haltReason: message };
    return read();
  };
  return {
    read,
    advance: (frame) => {
      if (state.haltReason) return read();
      if (
        !Number.isSafeInteger(frame.atMicroseconds) ||
        frame.atMicroseconds < state.atMicroseconds
      )
        return fail('Время электроники изменилось. Сбросьте запуск робота.');
      if (!Number.isFinite(frame.leftRpm) || !Number.isFinite(frame.rightRpm))
        return fail('Ядро не предоставило корректные обороты обоих моторов.');
      if (frame.atMicroseconds > ROBOTICS_RUN_LIMIT_MICROSECONDS) return fail(complete);
      const metresPerRpmSecond = (2 * Math.PI * world.robot.wheelRadiusMeters) / 60;
      if (
        [frame.leftRpm, frame.rightRpm].some(
          (rpm) =>
            Math.abs(rpm * metresPerRpmSecond) > ROBOTICS_PHYSICS_LIMITS.wheelSpeedMetersPerSecond,
        )
      )
        return fail(
          'Обороты моторов превышают предел скорости физического профиля (5 м/с на колесе).',
        );
      if (frame.atMicroseconds === state.atMicroseconds) {
        if (state.atMicroseconds === 0)
          state = { ...state, leftRpm: frame.leftRpm, rightRpm: frame.rightRpm };
        return read();
      }
      const start = state;
      const duration = frame.atMicroseconds - start.atMicroseconds;
      const tick = ROBOTICS_PHYSICS_LIMITS.stepMicroseconds;
      let cursor = start.atMicroseconds;
      let pendingLeft = start.pendingLeftMeters,
        pendingRight = start.pendingRightMeters;
      while (cursor < frame.atMicroseconds) {
        const end = Math.min(frame.atMicroseconds, state.physicsAtMicroseconds + tick);
        const fraction = ((cursor + end) / 2 - start.atMicroseconds) / duration;
        const seconds = (end - cursor) / 1_000_000;
        pendingLeft +=
          (start.leftRpm + (frame.leftRpm - start.leftRpm) * fraction) *
          metresPerRpmSecond *
          seconds;
        pendingRight +=
          (start.rightRpm + (frame.rightRpm - start.rightRpm) * fraction) *
          metresPerRpmSecond *
          seconds;
        cursor = end;
        if (cursor !== state.physicsAtMicroseconds + tick) continue;
        try {
          // New-profile quantization removes observation-partition summation roundoff, not physical noise.
          const command = (travel: number): number =>
            Math.round((travel / (tick / 1_000_000)) * 1e12) / 1e12;
          const snapshot = physics.step(command(pendingLeft), command(pendingRight));
          const trail = [...state.trail];
          const last = trail[trail.length - 1]!;
          if (
            Math.hypot(
              snapshot.pose.xMeters - last.xMeters,
              snapshot.pose.yMeters - last.yMeters,
            ) >= 0.005
          ) {
            trail.push(snapshot.pose);
            if (trail.length > 800) trail.shift();
          }
          state = { ...state, ...snapshot, physicsAtMicroseconds: end, trail };
          pendingLeft = 0;
          pendingRight = 0;
        } catch (error) {
          // Engine internals are discarded on Reset; the last complete visible tick remains authoritative.
          state = {
            ...state,
            atMicroseconds: state.physicsAtMicroseconds,
            pendingLeftMeters: 0,
            pendingRightMeters: 0,
          };
          return fail(
            error instanceof Error
              ? error.message
              : 'Не удалось рассчитать контакт. Нажмите «Сбросить».',
          );
        }
      }
      state = {
        ...state,
        atMicroseconds: frame.atMicroseconds,
        pendingLeftMeters: pendingLeft,
        pendingRightMeters: pendingRight,
        leftRpm: frame.leftRpm,
        rightRpm: frame.rightRpm,
        haltReason: frame.atMicroseconds === ROBOTICS_RUN_LIMIT_MICROSECONDS ? complete : null,
      };
      return read();
    },
  };
}
