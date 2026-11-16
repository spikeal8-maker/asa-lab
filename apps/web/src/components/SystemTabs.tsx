import type { KeyboardEvent } from 'react';

/**
 * Canonical ASA Lab section navigation.
 *
 * Keeps the established classroom contract: native buttons within a labelled
 * nav, with aria-current="page" for the selected section. These are not
 * automatically ARIA tabpanels; only surfaces with controlled tabpanel focus
 * semantics should use role="tablist".
 */
export interface SystemTab<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly compactLabel?: string;
  readonly disabled?: boolean;
}

export interface SystemTabsProps<T extends string> {
  readonly items: readonly SystemTab<T>[];
  readonly active: T;
  readonly onChange: (next: T) => void;
  readonly label: string;
  readonly className?: string;
  readonly vertical?: boolean;
  readonly selectedState?: 'current' | 'pressed';
  readonly fullLabelClassName?: string;
  readonly compactLabelClassName?: string;
}

export function SystemTabs<T extends string>({
  items,
  active,
  onChange,
  label,
  className,
  vertical = false,
  selectedState = 'current',
  fullLabelClassName,
  compactLabelClassName,
}: SystemTabsProps<T>): JSX.Element {
  const focusNeighbor = (event: KeyboardEvent<HTMLElement>): void => {
    const buttons = Array.from(event.currentTarget.children).filter(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement && !element.disabled,
    );
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const { key } = event;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    const previous = key === 'ArrowLeft' || key === 'ArrowUp';
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? buttons.length - 1
          : (current + (previous ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <nav
      aria-label={label}
      onKeyDown={focusNeighbor}
      onFocus={(event) => {
        if (event.target instanceof HTMLButtonElement)
          event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }}
      className={['asa-system-tabs', vertical ? 'asa-system-tabs--vertical' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={item.disabled}
          className={item.id === active ? 'active' : undefined}
          aria-label={item.compactLabel ? item.label : undefined}
          aria-current={selectedState === 'current' && item.id === active ? 'page' : undefined}
          aria-pressed={selectedState === 'pressed' ? item.id === active : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.compactLabel ? (
            <>
              <span
                className={['asa-system-tab-full', fullLabelClassName].filter(Boolean).join(' ')}
                aria-hidden="true"
              >
                {item.label}
              </span>
              <span
                className={['asa-system-tab-compact', compactLabelClassName]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              >
                {item.compactLabel}
              </span>
            </>
          ) : (
            item.label
          )}
        </button>
      ))}
    </nav>
  );
}
