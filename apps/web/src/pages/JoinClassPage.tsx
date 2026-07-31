import { AsaLabWordmark } from '../brand/AsaLabBrand';

export function JoinClassPage({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div className="page-center">
      <main className="login-card">
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="subtitle">Вход по коду класса</p>
        <div className="route-notice" role="status">
          <strong>Вход по коду класса временно закрыт.</strong>
          <span>Мы откроем его, когда подключение ученика будет полностью готово.</span>
        </div>
      </main>
    </div>
  );
}
