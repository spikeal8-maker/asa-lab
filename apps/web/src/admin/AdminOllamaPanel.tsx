import { useEffect, useState, type FormEvent } from 'react';
import { call } from './admin-api';

interface OllamaSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly configurationVersion: number;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly updatedAt: string | null;
}
interface OllamaModel {
  readonly name: string;
  readonly size: number;
}

function isSettings(value: unknown): value is OllamaSettings {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['baseUrl'] === 'string' &&
    typeof record['model'] === 'string' &&
    typeof record['enabled'] === 'boolean' &&
    typeof record['active'] === 'boolean' &&
    Number.isSafeInteger(record['configurationVersion']);
}

export function AdminOllamaPanel({ onAccessDenied }: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [saved, setSaved] = useState<OllamaSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [busy, setBusy] = useState<'load' | 'discover' | 'save' | 'test' | null>('load');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmGpu, setConfirmGpu] = useState(false);
  const dirty = !saved || !saved.active ||
    baseUrl !== saved.baseUrl || model !== saved.model || enabled !== saved.enabled;

  useEffect(() => {
    let alive = true;
    void call<unknown>('/api/admin/v1/ai/ollama')
      .then((response) => {
        if (!alive) return;
        if (!response.ok) {
          if (response.status === 401) onAccessDenied();
          setError('Настройки Ollama недоступны. Проверьте обновление API и базы.');
        } else if (isSettings(response.data)) {
          setSaved(response.data);
          setBaseUrl(response.data.baseUrl);
          setModel(response.data.model);
          setEnabled(response.data.enabled);
        } else setError('Версии настроек Ollama на сервере и в браузере несовместимы.');
      })
      .catch(() => { if (alive) setError('Сервер Ollama недоступен.'); })
      .finally(() => { if (alive) setBusy(null); });
    return () => { alive = false; };
  }, [onAccessDenied]);

  async function discover(): Promise<void> {
    if (busy) return;
    setBusy('discover');
    setNotice('');
    setError('');
    setModels([]);
    try {
      const result = await call<{ models: OllamaModel[] }>('/api/admin/v1/ai/ollama/discover', {
        method: 'POST',
        body: JSON.stringify({ baseUrl }),
      });
      if (!result.ok) {
        if (result.status === 401) onAccessDenied();
        setError(result.error.message || 'Ollama не отвечает.');
      } else if (Array.isArray(result.data.models)) {
        const found = result.data.models.filter(
          (item) => item && typeof item.name === 'string' && typeof item.size === 'number',
        );
        setModels(found);
        if (!found.some((item) => item.name === model)) setModel(found[0]?.name ?? '');
        setNotice(found.length
          ? 'Ollama ответила. Выберите модель и сохраните конфигурацию.'
          : 'Ollama ответила, но установленные модели не обнаружены.');
      } else setError('Некорректный ответ каталога моделей Ollama.');
    } catch {
      setError('Не удалось получить список моделей.');
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!saved || busy || !model || !dirty) return;
    setBusy('save');
    setError('');
    setNotice('');
    setConfirmGpu(false);
    try {
      const result = await call<unknown>('/api/admin/v1/ai/ollama', {
        method: 'PUT',
        body: JSON.stringify({
          baseUrl, model, enabled,
          configurationVersion: saved.configurationVersion,
        }),
      });
      if (!result.ok) {
        if (result.status === 401) onAccessDenied();
        setError(result.error.message || 'Настройки Ollama не сохранены.');
      } else if (isSettings(result.data)) {
        setSaved(result.data);
        setBaseUrl(result.data.baseUrl);
        setModel(result.data.model);
        setEnabled(result.data.enabled);
        setNotice(result.data.enabled
          ? 'Модель Ollama выбрана как ответчик ИИ-чата.'
          : 'Настройки Ollama сохранены; генерация пока отключена.');
      } else setError('Ответ сервера не подтверждает сохранение.');
    } catch {
      setError('Результат сохранения неизвестен. Обновите страницу до повторной попытки.');
    } finally {
      setBusy(null);
    }
  }

  async function test(): Promise<void> {
    if (!saved || dirty || !confirmGpu || busy) return;
    setBusy('test');
    setError('');
    setNotice('');
    setConfirmGpu(false);
    try {
      const result = await call<{
        model: string; configurationVersion: number; elapsedMs: number; testedAt: string;
      }>('/api/admin/v1/ai/ollama/test', {
        method: 'POST',
        body: JSON.stringify({
          configurationVersion: saved.configurationVersion,
          acknowledgeGpuRequest: true,
        }),
      });
      if (result.ok && result.data.configurationVersion === saved.configurationVersion &&
          result.data.model === saved.model && Number.isFinite(result.data.elapsedMs)) {
        setNotice('Настоящий ответ модели получен за ' +
          (result.data.elapsedMs / 1000).toFixed(1) + ' с.');
      } else {
        if (!result.ok && result.status === 401) onAccessDenied();
        setError(result.ok
          ? 'Некорректное подтверждение теста.'
          : result.error.message || 'Не удалось проверить модель.');
      }
    } catch {
      setError('Результат GPU-теста неизвестен. Проверьте журнал Ollama.');
    } finally {
      setBusy(null);
    }
  }

  const options = models.some((item) => item.name === model) || !model
    ? models
    : [{ name: model, size: 0 }, ...models];
  return (
    <section className="asa-ai-admin-form" aria-label="Настройки Ollama" aria-busy={busy !== null}>
      <h3>Ollama · локальные модели</h3>
      <p>
        Сервер ASA Lab обращается к Ollama на этой машине или по частному IP другого
        компьютера в LAN/Tailscale. Ключ внешнего API не требуется.
      </p>
      <p className="asa-ai-admin-warning">
        127.0.0.1 в Docker — адрес самого API-контейнера, а не компьютера с GPU.
        Для сетевой Ollama используйте частный адрес компьютера и ограничьте
        доступ к порту 11434 локальной сетью.
      </p>
      {saved ? (
        <div className="asa-ai-ollama-status">
          <span>Активный маршрут: <strong>{saved.active ? 'Ollama' : 'Другой провайдер'}</strong></span>
          <span>Генерация: <strong>{saved.active && saved.enabled ? 'Включена' : 'Выключена'}</strong></span>
        </div>
      ) : null}
      {error ? <p className="asa-ai-admin-warning" role="alert">{error}</p> : null}
      {notice ? <p className="asa-ai-admin-success" role="status">{notice}</p> : null}
      <form className="asa-ai-ollama-form" onSubmit={(event) => void save(event)}>
        <label>
          Адрес сервера Ollama
          <input type="text" aria-label="Адрес Ollama" spellCheck={false}
            placeholder="http://192.168.1.20:11434" value={baseUrl}
            disabled={busy !== null}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setModels([]);
              setConfirmGpu(false);
            }} />
        </label>
        <div className="asa-ai-ollama-actions">
          <button type="button" className="btn-secondary" disabled={busy !== null}
            onClick={() => void discover()}>
            {busy === 'discover' ? 'Подключаемся…' : 'Найти модели'}
          </button>
          <small>Поиск моделей не запускает генерацию на GPU.</small>
        </div>
        <label>
          Модель ответчика
          <select value={model} aria-label="Модель Ollama" disabled={busy !== null}
            onChange={(event) => { setModel(event.target.value); setConfirmGpu(false); }}>
            <option value="">Выберите установленную модель</option>
            {options.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}
          </select>
        </label>
        <label className="asa-ai-admin-check">
          <input type="checkbox" checked={enabled} disabled={busy !== null}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setConfirmGpu(false);
            }} />
          <span>Разрешить ответы ИИ-чата через Ollama</span>
        </label>
        <p>
          Ключи OpenAI/DeepSeek сохраняются. Локальные запросы не расходуют общую
          квоту платного API, но лимит 30 сообщений на пользователя в час сохраняется.
        </p>
        <div className="asa-ai-ollama-actions">
          <button type="submit" className="btn-primary"
            disabled={!saved || !model || busy !== null || !dirty}>
            {busy === 'save' ? 'Сохраняем…' : 'Сохранить Ollama'}
          </button>
          <small>{dirty ? 'Изменения не сохранены.' : 'Настройки сохранены.'}</small>
        </div>
      </form>
      <div className="asa-ai-ollama-form">
        <h3>Проверка реального ответа</h3>
        <label className="asa-ai-admin-check">
          <input type="checkbox" checked={confirmGpu} disabled={!saved || dirty || busy !== null}
            onChange={(event) => setConfirmGpu(event.target.checked)} />
          <span>Подтверждаю один тестовый запуск локальной модели на GPU/CPU</span>
        </label>
        <button type="button" className="btn-secondary"
          disabled={!saved || dirty || busy !== null || !confirmGpu}
          onClick={() => void test()}>
          {busy === 'test' ? 'Ожидаем ответ…' : 'Проверить ответ модели'}
        </button>
      </div>
    </section>
  );
}
