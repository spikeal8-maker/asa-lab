import { useState, type ReactNode } from 'react';
import type { SchematicDocument } from '../api';
import { RobotField } from './RobotField';
import { RoboticsNumberField } from './RobotFieldEditor';
import { validateRoboticsBindings, type RoboticsProject } from './robotics-project';
import {
  createRoboticsWorldState,
  measureRoboticsDistance,
  parseRoboticsWorldDocument,
  type RoboticsWorldDocument,
} from './world';

const ROLES = [
  { key: 'boardId', type: 'arduino-uno', label: 'Arduino Uno' },
  { key: 'leftMotorId', type: 'gearmotor', label: 'Левый мотор' },
  { key: 'rightMotorId', type: 'gearmotor', label: 'Правый мотор' },
  { key: 'distanceSensorId', type: 'ultrasonic-hc-sr04', label: 'Датчик HC-SR04' },
] as const;
const DIMENSIONS = [
  { key: 'bodyLengthMeters', label: 'Длина корпуса', min: 0.05, max: 0.5 },
  { key: 'bodyWidthMeters', label: 'Ширина корпуса', min: 0.05, max: 0.5 },
  { key: 'wheelRadiusMeters', label: 'Радиус колеса', min: 0.01, max: 0.1 },
  { key: 'wheelWidthMeters', label: 'Ширина колеса', min: 0.005, max: 0.1 },
  { key: 'wheelTrackMeters', label: 'Колея', min: 0.05, max: 0.5 },
] as const;

export function RobotAssemblyPanel({
  project,
  running,
  onCommit,
  onOpenElectronics,
  simulationControls,
}: {
  project: RoboticsProject;
  running: boolean;
  onCommit: (world: RoboticsWorldDocument) => boolean;
  onOpenElectronics: () => void;
  simulationControls?: ReactNode;
}) {
  const world = project.world;
  const [error, setError] = useState<string | null>(null);
  const bindingError = validateRoboticsBindings(project);
  function commit(next: RoboticsWorldDocument) {
    if (running) return false;
    const parsed = parseRoboticsWorldDocument(next);
    if (!parsed.ok) {
      setError(parsed.message);
      return false;
    }
    if (!onCommit(parsed.world)) {
      setError(
        'Назначение не принято. Выберите существующий HC-SR04 и проверьте положение датчика.',
      );
      return false;
    }
    setError(null);
    return true;
  }
  const start = createRoboticsWorldState(world);
  const labelOf = (component: SchematicDocument['components'][number]) =>
    component.name ? `${component.name} · ${component.id}` : component.id;
  return (
    <>
      <div className="robotics-panel-toolbar robotics-robot-toolbar">
        <div className="robotics-robot-toolbar-tools">
          <h2>Робот</h2>
          <button type="button" className="robotics-button" onClick={onOpenElectronics}>
            Добавить компонент
          </button>
        </div>
        {simulationControls}
      </div>
      {running ? (
        <p className="robotics-edit-hint">
          Остановите моделирование, чтобы изменить конструкцию или назначение компонентов.
        </p>
      ) : null}
      <div className="robotics-assembly-editor">
        <div className="robotics-assembly-view">
          <RobotField
            world={world}
            state={start}
            distance={measureRoboticsDistance(world, world.initialPose, start.balls)}
            showGrid={false}
            view="robot"
            testIdPrefix="robotics-assembly"
          />
          <p className="robotics-help">Вид сверху · реальные размеры в миллиметрах</p>
        </div>
        <div className="robotics-assembly-settings">
          {error || bindingError ? (
            <p role="alert" className="robotics-field-error robotics-scene-error">
              {error ?? bindingError}
            </p>
          ) : null}
          <section className="robotics-settings-group">
            <h3>Компоненты робота</h3>
            <p className="robotics-help">
              Выберите конкретные детали схемы. Добавленная деталь назначается только здесь.
            </p>
            {ROLES.map((role) => {
              const candidates = project.circuit.components.filter(
                (component) => component.componentTypeId === role.type,
              );
              const selected = candidates.find(
                (component) => component.id === world.bindings[role.key],
              );
              return (
                <label className="robotics-select-field" key={role.key}>
                  {role.label}
                  <select
                    aria-label={role.label}
                    aria-invalid={!selected}
                    disabled={running}
                    value={world.bindings[role.key]}
                    onChange={(event) =>
                      commit({
                        ...world,
                        bindings: { ...world.bindings, [role.key]: event.target.value },
                      })
                    }
                  >
                    {!selected ? (
                      <option value={world.bindings[role.key]}>
                        Не найден: {world.bindings[role.key]}
                      </option>
                    ) : null}
                    {candidates.map((component) => (
                      <option key={component.id} value={component.id}>
                        {labelOf(component)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            <button
              type="button"
              className="robotics-button"
              disabled={running}
              onClick={() =>
                commit({
                  ...world,
                  bindings: {
                    ...world.bindings,
                    leftMotorId: world.bindings.rightMotorId,
                    rightMotorId: world.bindings.leftMotorId,
                  },
                })
              }
            >
              Поменять моторы местами
            </button>
          </section>
          <section className="robotics-settings-group">
            <h3>Шасси и колёса</h3>
            <div className="robotics-form-grid">
              {DIMENSIONS.map((dimension) => (
                <RoboticsNumberField
                  key={dimension.key}
                  label={dimension.label}
                  value={world.robot[dimension.key] * 1000}
                  min={dimension.min * 1000}
                  max={dimension.max * 1000}
                  step={1}
                  unit="мм"
                  disabled={running}
                  onCommit={(value) =>
                    commit({ ...world, robot: { ...world.robot, [dimension.key]: value / 1000 } })
                  }
                />
              ))}
            </div>
          </section>
          <section className="robotics-settings-group">
            <h3>Крепление HC-SR04</h3>
            <div className="robotics-form-grid">
              <RoboticsNumberField
                label="Датчик: вперёд от центра"
                value={world.robot.sensorForwardMeters * 1000}
                min={-300}
                max={300}
                step={1}
                unit="мм"
                disabled={running}
                onCommit={(value) =>
                  commit({ ...world, robot: { ...world.robot, sensorForwardMeters: value / 1000 } })
                }
              />
              <RoboticsNumberField
                label="Датчик: влево от центра"
                value={world.robot.sensorLateralMeters * 1000}
                min={-300}
                max={300}
                step={1}
                unit="мм"
                disabled={running}
                onCommit={(value) =>
                  commit({ ...world, robot: { ...world.robot, sensorLateralMeters: value / 1000 } })
                }
              />
              <RoboticsNumberField
                label="Направление датчика"
                value={(world.robot.sensorHeadingRadians * 180) / Math.PI}
                min={-180}
                max={180}
                step={1}
                unit="°"
                disabled={running}
                onCommit={(value) =>
                  commit({
                    ...world,
                    robot: { ...world.robot, sensorHeadingRadians: (value * Math.PI) / 180 },
                  })
                }
              />
            </div>
          </section>
          <details className="robotics-settings-group">
            <summary>Схема и ограничения</summary>
            <p className="robotics-help">
              Учебные примеры рассчитаны на D5 — левый мотор, D6 — правый, D13 — Trig, D2 — Echo.
              Здесь назначаются детали, а соединения выводов изменяются в «Электронике». LOW
              отключает питание мотора и оставляет свободный выбег. Обратного хода и обратной
              нагрузки на мотор при контакте пока нет.
            </p>
          </details>
          <details className="robotics-settings-group">
            <summary>Arduino · будущие модули</summary>
            <ul className="robotics-future-modules">
              {['Драйвер с реверсом', 'Датчик цвета', 'Датчик линии', 'Энкодер'].map((label) => (
                <li key={label}>
                  <span className="robotics-module-placeholder" aria-hidden="true" />
                  <span>
                    {label}
                    <small>Модель ещё не подключена</small>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </>
  );
}
