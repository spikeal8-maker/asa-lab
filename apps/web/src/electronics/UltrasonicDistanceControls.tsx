export type UltrasonicDistanceComponentTypeId = 'ultrasonic-sensor' | 'ultrasonic-hc-sr04';

export function UltrasonicDistanceControls({
  componentTypeId,
  distanceMeters,
  onChange,
}: {
  readonly componentTypeId: UltrasonicDistanceComponentTypeId;
  readonly distanceMeters: number;
  readonly onChange: (distanceMeters: number) => void;
}): JSX.Element {
  const maximumMeters = componentTypeId === 'ultrasonic-hc-sr04' ? 4 : 3;
  return (
    <label>
      <span>Расстояние, м</span>
      <input
        aria-label="Расстояние ультразвукового датчика, м"
        type="number"
        min="0.02"
        max={String(maximumMeters)}
        step="0.01"
        value={distanceMeters}
        onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value) && value >= 0.02 && value <= maximumMeters) onChange(value);
        }}
      />
    </label>
  );
}
