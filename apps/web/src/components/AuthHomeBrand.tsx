import { AsaLabWordmark } from '../brand/AsaLabBrand';

export function AuthHomeBrand({ onHome }: { onHome: () => void }): JSX.Element {
  return (
    <div className="brand-heading">
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
