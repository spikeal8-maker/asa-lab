import { useEffect, useState } from 'react';

const rounded = (value: number) => Math.round(value * 10000) / 10000;

/** Incomplete input stays local; only a complete valid value reaches project history. */
export function RoboticsNumberField({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  disabled,
  integer = false,
  onCommit,
  onValidationReset,
  onValidityChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  integer?: boolean;
  onCommit: (value: number) => boolean;
  onValidationReset?: () => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [draft, setDraft] = useState(String(rounded(value)));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(String(rounded(value)));
    setError(null);
  }, [value]);
  function commit() {
    if (disabled) return;
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    if (
      !Number.isFinite(parsed) ||
      parsed < min ||
      parsed > max ||
      (integer && !Number.isInteger(parsed))
    ) {
      onValidityChange?.(false);
      setError(
        (integer ? 'Введите целое число' : 'Допустимо') +
          ' от ' +
          rounded(min) +
          ' до ' +
          rounded(max) +
          (unit ? ' ' + unit : '') +
          '.',
      );
      return;
    }
    if (Math.abs(parsed - value) < 1e-9) {
      setError(null);
      onValidityChange?.(true);
      return;
    }
    if (!onCommit(parsed)) {
      setError('Изменение не принято. Проверьте положение и размеры.');
      onValidityChange?.(false);
      return;
    }
    setError(null);
    onValidityChange?.(true);
  }
  return (
    <label className="robotics-number-field">
      <span>
        {label}
        {unit ? <small>{unit}</small> : null}
      </span>
      <input
        type="number"
        aria-label={label}
        aria-invalid={Boolean(error)}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          setError(null);
          const number = next.trim() === '' ? NaN : Number(next);
          onValidityChange?.(
            Number.isFinite(number) &&
              number >= min &&
              number <= max &&
              (!integer || Number.isInteger(number)),
          );
          onValidationReset?.();
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(String(rounded(value)));
            setError(null);
            onValidationReset?.();
            onValidityChange?.(true);
          }
        }}
      />
      {error ? (
        <small className="robotics-field-error" role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}
