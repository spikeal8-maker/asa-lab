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
  readonly disabled?: boolean;
}

export interface SystemTabsProps<T extends string> {
  readonly items: readonly SystemTab<T>[];
  readonly active: T;
  readonly onChange: (next: T) => void;
  readonly label: string;
  readonly className?: string;
  readonly vertical?: boolean;
}

export function SystemTabs<T extends string>({
  items,
  active,
  onChange,
  label,
  className,
  vertical = false,
}: SystemTabsProps<T>): JSX.Element {
  return (
    <nav
      aria-label={label}
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
          aria-current={item.id === active ? 'page' : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
