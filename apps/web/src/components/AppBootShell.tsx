export function AppBootShell({ label = 'Открываем ASA Lab' }: { label?: string }): JSX.Element {
  return (
    <main className="app-boot-shell" role="status" aria-live="polite" aria-label={label}>
      <div className="app-boot-brand" aria-hidden="true">
        <img src="/asa-lab-mark.svg" width="52" height="52" alt="" />
        <span>
          ASA <strong>Lab</strong>
        </span>
      </div>
      <span className="sr-only">{label}</span>
    </main>
  );
}
