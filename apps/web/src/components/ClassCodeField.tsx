import { VisibilityField } from './VisibilityField';

interface ClassCodeFieldProps {
  readonly id: string;
  readonly value: string;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly autoFocus?: boolean;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
  readonly onVisibilityChange: (visible: boolean) => void;
}

export function ClassCodeField({
  id,
  value,
  visible,
  disabled,
  autoFocus,
  maxLength,
  onChange,
  onVisibilityChange,
}: ClassCodeFieldProps): JSX.Element {
  return (
    <VisibilityField
      id={id}
      fieldLabel="код класса"
      visible={visible}
      onVisibilityChange={onVisibilityChange}
      autoFocus={autoFocus}
      autoComplete="one-time-code"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      inputMode="text"
      value={value}
      maxLength={maxLength}
      disabled={disabled}
      placeholder="ABC DEF 234"
      onChange={(event) => onChange(event.target.value.toUpperCase())}
    />
  );
}
