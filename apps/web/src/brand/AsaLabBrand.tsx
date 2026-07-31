export interface AsaLabMarkProps {
  readonly className?: string;
  readonly title?: string;
}

export function AsaLabMark({ className, title }: AsaLabMarkProps): JSX.Element {
  const labelled = Boolean(title);
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? title : undefined}
      focusable="false"
    >
      <rect x="2" y="2" width="44" height="44" rx="12" fill="#0B3558" />
      <path
        d="M18 10h12M21 10v8.2L12.7 34.7A3.8 3.8 0 0 0 16.1 40h15.8a3.8 3.8 0 0 0 3.4-5.3L27 18.2V10"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.3 31.2h15.4l2.2 4.6c.5 1.1-.3 2.4-1.5 2.4H15.6c-1.2 0-2-1.3-1.5-2.4l2.2-4.6Z"
        fill="#0AA4C8"
      />
      <path d="M19.1 27.2h9.8" stroke="#8EE4F2" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="8.5" r="2.7" fill="#F2A51A" stroke="#0B3558" strokeWidth="1.3" />
      <circle cx="13.1" cy="35.1" r="2.5" fill="#F2A51A" stroke="#0B3558" strokeWidth="1.3" />
      <circle cx="34.9" cy="35.1" r="2.5" fill="#F2A51A" stroke="#0B3558" strokeWidth="1.3" />
    </svg>
  );
}

export function AsaLabWordmark({ compact = false }: { readonly compact?: boolean }): JSX.Element {
  return (
    <span className={compact ? 'asa-brand-lockup compact' : 'asa-brand-lockup'}>
      <AsaLabMark className="asa-brand-mark" />
      <span className="asa-brand-copy" aria-label="ASA Lab">
        <strong>ASA</strong>
        <span>Lab</span>
      </span>
    </span>
  );
}
