import { AsaLabWordmark } from '../brand/AsaLabBrand';

export function AuthHomeBrand({
  onHome,
  onBack,
}: {
  onHome: () => void;
  onBack?: () => void;
}): JSX.Element {
  return (
    <div className={onBack ? 'brand-heading auth-entry-heading' : 'brand-heading'}>
      {onBack ? (
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
      ) : null}
      <button
        type="button"
        className="auth-home-brand"
        data-testid="auth-home"
        aria-label="На главную ASA Lab"
        title="На главную"
        onClick={onHome}
      >
        <AsaLabWordmark />
      </button>
    </div>
  );
}
