import { useRef, useState } from 'react';
import { emailApi } from '../email-api';
import '../admin/email-settings.css';
declare global {
  interface Window {
    __asaTakeEmailProof?: () => string;
  }
}
// Capture and erase the fragment before diagnostics or the application initialize.
export function takeEmailProof(): string {
  const token = window.__asaTakeEmailProof?.() ?? window.location.hash.slice(1);
  window.history.replaceState(null, '', window.location.pathname);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}
export function EmailConfirmationPage({ token }: { token: string }) {
  const running = useRef(false);
  const proof = useRef(token),
    [state, setState] = useState<'ready' | 'busy' | 'done' | 'invalid'>(
      token ? 'ready' : 'invalid',
    ),
    [changed, setChanged] = useState(false);
  async function confirm() {
    if (state !== 'ready' || running.current) return;
    running.current = true;
    setState('busy');
    const value = proof.current;
    proof.current = '';
    const result = await emailApi.confirm(value);
    setChanged(result.changed === true);
    setState(result.confirmed ? 'done' : 'invalid');
  }
  return (
    <main className="login-card email-public-card">
      <p>ASA Lab · электронная почта</p>
      <h1>{state === 'done' ? 'Почта подтверждена' : 'Подтверждение адреса'}</h1>
      {state === 'ready' || state === 'busy' ? (
        <>
          <p>Подтвердите адрес, на который пришло письмо. Ссылка используется один раз.</p>
          <button
            type="button"
            className="btn-primary"
            disabled={state === 'busy'}
            onClick={() => void confirm()}
          >
            {state === 'busy' ? 'Подтверждаем…' : 'Подтвердить адрес'}
          </button>
        </>
      ) : state === 'done' ? (
        <p>
          {changed
            ? 'Адрес входа обновлён. Войдите заново с новой почтой.'
            : 'Ваш адрес подтверждён. Можно продолжить работу.'}
        </p>
      ) : (
        <p role="alert">
          Ссылка недействительна, уже использована или запрос не завершён. Проверьте состояние
          аккаунта и при необходимости запросите новое письмо.
        </p>
      )}
      <a href="/">Перейти в ASA Lab</a>
    </main>
  );
}
