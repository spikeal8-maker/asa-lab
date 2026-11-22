import { useEffect, useState } from 'react';
import {
  createRoboticsWorldDocument,
  createRoboticsWorldV3Document,
  getRoboticsPhysicsMode,
  isRoboticsWorldV3,
  ROBOTICS_ACCURACY_PRESETS,
  ROBOTICS_FIELD_LIMITS,
  ROBOTICS_FIELD_PRESETS,
  ROBOTICS_FIELD_SURFACES,
  ROBOTICS_PHYSICS_PARAMETER_LIMITS,
  ROBOTICS_TILE_LIMITS,
  setRoboticsPhysicsMode,
  type RoboticsWorldDocument,
} from '@asa-lab/robotics/world-document';
import { resizeRoboticsTileField } from '@asa-lab/robotics/world-authoring';
import { RoboticsNumberField } from './RoboticsNumberField';

/** Metric geometry, tile layout and numerical settings remain separate controls. */
export function RobotFieldSettings({
  world,
  running,
  sourceSchemaVersion,
  onCommit,
  onUpgradeField,
  onPresetApplied,
  onError,
}: {
  world: RoboticsWorldDocument;
  running: boolean;
  sourceSchemaVersion: 2 | 3;
  onCommit: (world: RoboticsWorldDocument) => boolean;
  onUpgradeField: () => boolean;
  onPresetApplied: () => void;
  onError: (message: string) => void;
}) {
  const extended = isRoboticsWorldV3(world);
  const size = world.field.tiles?.sizeMeters ?? 0.3;
  const [columns, setColumns] = useState(Math.round(world.field.widthMeters / size));
  const [rows, setRows] = useState(Math.round(world.field.heightMeters / size));
  const [tileInputsValid, setTileInputsValid] = useState({ size: true, columns: true, rows: true });
  useEffect(() => {
    setColumns(Math.round(world.field.widthMeters / size));
    setRows(Math.round(world.field.heightMeters / size));
    setTileInputsValid({ size: true, columns: true, rows: true });
  }, [world.field.widthMeters, world.field.heightMeters, size]);
  const preset = ROBOTICS_FIELD_PRESETS.find(
    (item) =>
      item.widthMeters === world.field.widthMeters &&
      item.heightMeters === world.field.heightMeters,
  );
  function centeredStart(next: RoboticsWorldDocument): RoboticsWorldDocument {
    return {
      ...next,
      initialPose: {
        ...next.initialPose,
        xMeters: next.field.widthMeters / 2,
        yMeters: next.field.heightMeters / 2,
      },
    };
  }
  function attempt(make: () => RoboticsWorldDocument) {
    try {
      return onCommit(make());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Не удалось изменить поле.');
      return false;
    }
  }
  return (
    <>
      <details className="robotics-settings-group" open>
        <summary>Размеры и учебная сцена</summary>
        <label className="robotics-select-field">
          Учебная сцена
          <select
            aria-label="Учебная сцена"
            value={preset?.id ?? ''}
            disabled={running}
            onChange={(event) => {
              const chosen = ROBOTICS_FIELD_PRESETS.find((item) => item.id === event.target.value);
              if (
                !chosen ||
                !window.confirm(
                  'Заменить предметы и старт робота учебной сценой? Схема, программа и назначение компонентов сохранятся.',
                )
              )
                return;
              const next = extended
                ? createRoboticsWorldV3Document(chosen.id, getRoboticsPhysicsMode(world))
                : createRoboticsWorldDocument(chosen.id);
              if (onCommit({ ...world, field: next.field, initialPose: next.initialPose }))
                onPresetApplied();
            }}
          >
            {!preset ? <option value="">Свой размер</option> : null}
            {ROBOTICS_FIELD_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="robotics-form-grid">
          {(['widthMeters', 'heightMeters', 'gridMeters'] as const).map((property, index) => (
            <RoboticsNumberField
              key={property}
              label={['Ширина поля', 'Высота поля', 'Шаг сетки'][index]!}
              unit="м"
              value={world.field[property]}
              {...ROBOTICS_FIELD_LIMITS[property]}
              disabled={running}
              onValidationReset={() => onError('')}
              onCommit={(value) => {
                const next = { ...world, field: { ...world.field, [property]: value } };
                return onCommit(property === 'gridMeters' ? next : centeredStart(next));
              }}
            />
          ))}
        </div>
        <div className="robotics-field-center-action">
          <span>
            Старт робота: {world.initialPose.xMeters.toLocaleString('ru-RU')} м ×{' '}
            {world.initialPose.yMeters.toLocaleString('ru-RU')} м
          </span>
          <button
            type="button"
            className="robotics-button"
            aria-label="Поместить робота в центр поля"
            disabled={
              running ||
              (Math.abs(world.initialPose.xMeters - world.field.widthMeters / 2) < 1e-8 &&
                Math.abs(world.initialPose.yMeters - world.field.heightMeters / 2) < 1e-8)
            }
            onClick={() => onCommit(centeredStart(world))}
          >
            По центру
          </button>
        </div>
        <p className="robotics-help">
          Размеры — в метрах. При изменении поля старт робота пересчитывается в центр. Ранее
          сохранённый проект можно центрировать отдельной кнопкой.
        </p>
      </details>
      {!extended || sourceSchemaVersion === 2 ? (
        <section className="robotics-field-upgrade robotics-settings-group">
          <h3>Сохранённая модель поля</h3>
          <p className="robotics-help">
            Этот проект работает с прежней физикой. Расширенное поле добавит банки, бруски, плитки и
            новые режимы движения.
          </p>
          <button
            className="robotics-button"
            type="button"
            disabled={running}
            onClick={() => {
              if (!onUpgradeField())
                onError('Не удалось включить расширенное поле. Сохранённая работа не изменена.');
            }}
          >
            Включить расширенное поле
          </button>
          <p className="robotics-help">
            Программа и расположение предметов сохранятся. Результат движения может измениться.
          </p>
        </section>
      ) : (
        <>
          <details className="robotics-settings-group">
            <summary>Плитки и размер поля</summary>
            <label className="robotics-grid-toggle robotics-setting-checkbox">
              <input
                type="checkbox"
                aria-label="Показывать плитки"
                checked={world.field.tiles.enabled}
                disabled={running}
                onChange={(event) =>
                  onCommit({
                    ...world,
                    field: {
                      ...world.field,
                      tiles: { ...world.field.tiles, enabled: event.target.checked },
                    },
                  })
                }
              />
              Показывать плитки
            </label>
            <div className="robotics-form-grid">
              <RoboticsNumberField
                label="Сторона плитки"
                unit="м"
                value={size}
                onValidityChange={(valid) =>
                  setTileInputsValid((previous) => ({ ...previous, size: valid }))
                }
                {...ROBOTICS_TILE_LIMITS.sizeMeters}
                disabled={running}
                onValidationReset={() => onError('')}
                onCommit={(value) =>
                  onCommit({
                    ...world,
                    field: { ...world.field, tiles: { ...world.field.tiles, sizeMeters: value } },
                  })
                }
              />
              <RoboticsNumberField
                label="Плиток по ширине"
                value={columns}
                onValidityChange={(valid) =>
                  setTileInputsValid((previous) => ({ ...previous, columns: valid }))
                }
                {...ROBOTICS_TILE_LIMITS.columns}
                step={1}
                integer
                disabled={running}
                onValidationReset={() => onError('')}
                onCommit={(value) => {
                  setColumns(value);
                  return true;
                }}
              />
              <RoboticsNumberField
                label="Плиток по высоте"
                value={rows}
                onValidityChange={(valid) =>
                  setTileInputsValid((previous) => ({ ...previous, rows: valid }))
                }
                {...ROBOTICS_TILE_LIMITS.rows}
                step={1}
                integer
                disabled={running}
                onValidationReset={() => onError('')}
                onCommit={(value) => {
                  setRows(value);
                  return true;
                }}
              />
            </div>
            <p className="robotics-help">
              {columns} × {rows} плиток по {Math.round(size * 100)} см →{' '}
              {(columns * size).toFixed(2)} × {(rows * size).toFixed(2)} м.
            </p>
            <button
              type="button"
              className="robotics-button"
              disabled={running || !Object.values(tileInputsValid).every(Boolean)}
              onClick={() =>
                attempt(() => centeredStart(resizeRoboticsTileField(world, columns, rows)))
              }
            >
              Применить размер по плиткам
            </button>
            <p className="robotics-help">
              Предметы сохраняют координаты. Сначала переместите их, если новое поле меньше.
            </p>
          </details>
          <details className="robotics-settings-group" open>
            <summary>Физика поля</summary>
            <label className="robotics-select-field">
              Режим физики
              <select
                aria-label="Режим физики"
                value={getRoboticsPhysicsMode(world)}
                disabled={running}
                onChange={(event) => {
                  if (event.target.value === 'educational' || event.target.value === 'dynamic')
                    attempt(() =>
                      setRoboticsPhysicsMode(
                        world,
                        event.target.value as 'educational' | 'dynamic',
                      ),
                    );
                }}
              >
                <option value="dynamic">Динамика 2D</option>
                <option value="educational">Учебный</option>
              </select>
            </label>
            <p className="robotics-help">
              {getRoboticsPhysicsMode(world) === 'dynamic'
                ? 'Масса, тяга колёс, сцепление и столкновения влияют на разгон и движение робота.'
                : 'Скорость робота задаётся моторами напрямую. Предметы сохраняют массу, трение и столкновения.'}
            </p>
            <label className="robotics-select-field">
              Точность расчёта
              <select
                aria-label="Точность расчёта"
                value={world.physics.accuracy}
                disabled={running}
                onChange={(event) => {
                  const accuracy = ROBOTICS_ACCURACY_PRESETS.find(
                    (item) => item.id === event.target.value,
                  )?.id;
                  if (accuracy) onCommit({ ...world, physics: { ...world.physics, accuracy } });
                }}
              >
                {ROBOTICS_ACCURACY_PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="robotics-select-field">
              Покрытие поля
              <select
                aria-label="Покрытие поля"
                value={world.field.surface}
                disabled={running}
                onChange={(event) => {
                  const surface = ROBOTICS_FIELD_SURFACES.find(
                    (item) => item.id === event.target.value,
                  )?.id;
                  if (surface) onCommit({ ...world, field: { ...world.field, surface } });
                }}
              >
                {ROBOTICS_FIELD_SURFACES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <details className="robotics-settings-group">
              <summary>Механические параметры робота</summary>
              <div className="robotics-form-grid">
                {(['robotMassKg', 'maxWheelForceNewton', 'tireFrictionCoefficient'] as const).map(
                  (property, index) => (
                    <RoboticsNumberField
                      key={property}
                      label={['Масса робота', 'Тяга одного колеса', 'Сцепление шин'][index]!}
                      unit={['кг', 'Н', ''][index]}
                      value={world.physics[property]}
                      {...ROBOTICS_PHYSICS_PARAMETER_LIMITS[property]}
                      disabled={running}
                      onValidationReset={() => onError('')}
                      onCommit={(value) =>
                        onCommit({ ...world, physics: { ...world.physics, [property]: value } })
                      }
                    />
                  ),
                )}
              </div>
              <p className="robotics-help">
                Действуют в режиме «Динамика 2D». Тяга — механическая оценка; ток мотора при упоре
                здесь не рассчитывается.
              </p>
            </details>
            <p className="robotics-help">
              Учебные оценки материалов. Плоское движение без прыжков и опрокидывания. Повышенная
              точность увеличивает объём расчёта.
            </p>
          </details>
        </>
      )}
    </>
  );
}
