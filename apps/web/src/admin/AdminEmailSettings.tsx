import { useEffect, useRef, useState, type FormEvent } from 'react';
import { emailApi, type SmtpConfig, type SmtpStatus } from '../email-api';
import './email-settings.css';
export function AdminEmailSettings({
  refreshKey,
  onAccessDenied,
}: {
  refreshKey: number;
  onAccessDenied: () => void;
}) {
  const [status, setStatus] = useState<SmtpStatus | null>(null),
    [config, setConfig] = useState<SmtpConfig>({
      enabled: false,
      host: '',
      port: 465,
      sender: '',
      username: '',
      siteOrigin: window.location.origin,
    });
  const [password, setPassword] = useState(''),
    [clear, setClear] = useState(false),
    [to, setTo] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(false),
    [dirty, setDirty] = useState(false);
  const seq = useRef(0),
    denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  function apply(value: SmtpStatus) {
    setStatus(value);
    setConfig({
      enabled: false,
      host: '',
      port: 465,
      sender: '',
      username: '',
      siteOrigin: window.location.origin,
      ...value.config,
    });
    setPassword('');
    setClear(false);
    setDirty(false);
  }
  useEffect(() => {
    const controller = new AbortController(),
      n = ++seq.current;
    setStatus(null);
    setBusy(false);
    setPassword('');
    setNotice('');
    void emailApi.config(controller.signal).then((r) => {
      if (n !== seq.current || controller.signal.aborted) return;
      if (r.ok) apply(r.data);
      else {
        setError(true);
        setNotice(r.error.message);
        if (r.status === 401 || r.status === 403) denied.current();
      }
    });
    return () => {
      seq.current++;
      controller.abort();
    };
  }, [refreshKey]);
  function field<K extends keyof SmtpConfig>(key: K, value: SmtpConfig[K]) {
    setConfig({ ...config, [key]: value });
    setDirty(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!status || busy) return;
    const n = seq.current;
    setBusy(true);
    setNotice('');
    const r = await emailApi.save(status.version, config, password, clear);
    if (n !== seq.current) return;
    setPassword('');
    setBusy(false);
    setError(!r.ok);
    if (r.ok) {
      apply(r.data);
      setNotice('Настройки сохранены. Проверьте подключение.');
    } else {
      setNotice(r.error.message);
      if (r.status === 401 || r.status === 403) denied.current();
    }
  }
  async function test(send: boolean) {
    if (!status || busy || dirty) return;
    const n = seq.current;
    setBusy(true);
    setNotice('');
    const r = await emailApi.test(status.version, send ? to : null);
    if (n !== seq.current) return;
    setBusy(false);
    setError(!r.ok);
    if (r.ok) {
      apply(r.data);
      setNotice(
        send
          ? 'Сервер принял проверочное письмо. Проверьте ящик, включая спам.'
          : 'Подключение и вход в почту проверены. Это ещё не проверка доставки в ящик.',
      );
    } else {
      setNotice(r.error.message);
      const fresh = await emailApi.config();
      if (n === seq.current && fresh.ok) apply(fresh.data);
      if (r.status === 401 || r.status === 403) denied.current();
    }
  }
  if (!status)
    return (
      <div className="mail-settings">
        <p role={notice ? 'alert' : 'status'}>{notice || 'Загружаем настройки почты…'}</p>
      </div>
    );
  const ready =
    status.config.enabled &&
    status.passwordConfigured &&
    status.testOk &&
    status.testedVersion === status.version;
  return (
    <section className="mail-settings" aria-labelledby="mail-settings-title">
      <div className="mail-heading">
        <div>
          <h3 id="mail-settings-title">Почта</h3>
          <p>Письма для подтверждения адреса и его безопасной смены.</p>
        </div>
        <span className={ready ? 'mail-status is-ready' : 'mail-status'}>
          {ready
            ? 'Подключение проверено'
            : status.config.enabled
              ? 'Требуется проверка'
              : 'Выключена'}
        </span>
      </div>
      {!status.encryptionReady ? (
        <p role="alert">
          Защита паролей недоступна. Восстановите ключ настроек установки перед подключением почты.
        </p>
      ) : null}
      <form onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy}>
          <label className="mail-switch">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => field('enabled', e.target.checked)}
            />
            Отправлять письма подтверждения
          </label>
          <div className="mail-fields">
            <label>
              Почтовый сервер
              <input
                required
                maxLength={253}
                placeholder="smtp.example.org"
                autoComplete="off"
                value={config.host}
                onChange={(e) => field('host', e.target.value)}
              />
            </label>
            <label>
              Защита подключения
              <select
                value={config.port}
                onChange={(e) => field('port', Number(e.target.value) as 465 | 587)}
              >
                <option value={465}>TLS · порт 465</option>
                <option value={587}>STARTTLS · порт 587</option>
              </select>
            </label>
            <label>
              Адрес отправителя
              <input
                required
                type="email"
                maxLength={254}
                value={config.sender}
                onChange={(e) => field('sender', e.target.value)}
              />
            </label>
            <label>
              Имя для входа в почту
              <input
                required
                maxLength={254}
                autoComplete="off"
                value={config.username}
                onChange={(e) => field('username', e.target.value)}
              />
            </label>
            <label>
              Пароль почты
              <input
                aria-label="Пароль почты"
                type="password"
                maxLength={1024}
                autoComplete="new-password"
                value={password}
                placeholder={
                  status.passwordConfigured
                    ? 'Сохранён · введите для замены'
                    : 'Введите пароль почты'
                }
                onChange={(e) => {
                  setPassword(e.target.value);
                  setDirty(true);
                  setClear(false);
                }}
              />
              <small>Сохранённый пароль не отображается.</small>
            </label>
            <label>
              Адрес сайта для ссылок
              <input
                aria-label="Адрес сайта для ссылок"
                required
                type="url"
                maxLength={2048}
                value={config.siteOrigin}
                onChange={(e) => field('siteOrigin', e.target.value)}
              />
              <small>
                Адрес, по которому пользователи открывают ASA Lab. Для внешнего доступа — HTTPS.
              </small>
            </label>
          </div>
          {status.passwordConfigured ? (
            <label className="mail-switch">
              <input
                type="checkbox"
                checked={clear}
                onChange={(e) => {
                  setClear(e.target.checked);
                  setPassword('');
                  setDirty(true);
                }}
              />
              Удалить сохранённый пароль
            </label>
          ) : null}
          <div className="mail-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={!dirty || (!status.encryptionReady && config.enabled)}
            >
              {busy ? 'Сохраняем…' : 'Сохранить почту'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={dirty || !config.enabled || !status.passwordConfigured}
              onClick={() => void test(false)}
            >
              Проверить подключение
            </button>
          </div>
        </fieldset>
      </form>
      <form
        className="mail-test"
        onSubmit={(e) => {
          e.preventDefault();
          void test(true);
        }}
      >
        <label>
          Получатель проверочного письма
          <input
            type="email"
            required
            maxLength={254}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn-secondary"
          disabled={busy || dirty || !config.enabled || !status.passwordConfigured}
        >
          Отправить проверочное письмо
        </button>
      </form>
      {dirty ? (
        <p className="mail-hint">Сначала сохраните изменения, затем проверяйте подключение.</p>
      ) : null}
      {notice ? <p role={error ? 'alert' : 'status'}>{notice}</p> : null}
      <p className="mail-hint">
        Почта станет обязательным способом только после успешного подтверждения адреса по письму.
        Общее правило входа настраивается выше.
      </p>
    </section>
  );
}
