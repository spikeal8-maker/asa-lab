export function PirSensorControls({
  motionDetected,
  onChange,
}: {
  readonly motionDetected: boolean;
  readonly onChange: (motionDetected: boolean) => void;
}): JSX.Element {
  return (
    <fieldset>
      <legend>Движение</legend>
      <label className="workbench-toggle-property">
        <span>
          Имитировать движение
          <small>{motionDetected ? 'обнаружено' : 'нет'}</small>
        </span>
        <input
          type="checkbox"
          aria-label="Имитировать движение PIR"
          checked={motionDetected}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    </fieldset>
  );
}
