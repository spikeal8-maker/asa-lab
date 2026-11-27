import type { ComponentPropsWithoutRef } from 'react';
import './class-code-field.css';

type VisibilityFieldProps = Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'type'> & {
  readonly id: string;
  readonly visible: boolean;
  readonly fieldLabel: string;
  readonly onVisibilityChange: (visible: boolean) => void;
};

export function VisibilityField({
  id,
  visible,
  fieldLabel,
  onVisibilityChange,
  ...input
}: VisibilityFieldProps): JSX.Element {
  const action = `${visible ? 'Скрыть' : 'Показать'} ${fieldLabel}`;
  return (
    <div className="visibility-field">
      <input
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...input}
        id={id}
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        className="btn-ghost visibility-field-toggle"
        aria-controls={id}
        aria-label={action}
        title={action}
        onClick={() => onVisibilityChange(!visible)}
      >
        <span className="visibility-field-eye" aria-hidden="true" />
      </button>
    </div>
  );
}
