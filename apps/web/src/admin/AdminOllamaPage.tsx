import { useEffect, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import './ai-ollama.css';

interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  revision: number;
  updatedAt: string | null;
}
interface OllamaModel { name: string; size: number }
interface OllamaTest { model: string; elapsedMs: number; testedAt: string; revision: number }

export function AdminOllamaPage({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [saved, setSaved] = useState<OllamaConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [models, setModels] = useState<readonly OllamaModel[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState<OllamaTest | null>(null);
  const [busy, setBusy] = useState<'load' | 'discover' | 'save' | 'test' | null>('load');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setBusy('load');
    void call<OllamaConfig>('/api/admin/v1/ai/ollama').then((result) => {
      if (!active) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onAccessDenied();
        setError(result.error.message || 'Не удалось загрузить Ollama.');
        return;
      }
      setSaved(result.data);
      setBaseUrl(result.data.baseUrl);
      setModel(result.data.model);
      setEnabled(result.data.enabled);
      setError('');
    }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [onAccessDenied, reload]);

  const dirty = !!saved && (
    saved.enabled !== enabled || saved.baseUrl !== baseUrl.trim() || saved.model !== model.trim()
  );

  async function discover(): Promise<void> {
    if (busy) return;
    setBusy('discover'); setError(''); setNotice(''); setTestResult(null); setModels([]);
    try {
      const result = await call<{ models: OllamaModel[] }>('/api/admin/v1/ai/ollama/models', {
        method: 'POST', body: JSON.stringify({ baseUrl: baseUrl.trim() }),
      });
      if (!result.ok) { setError(result.error.message); return; }
      setModels(result.data.models);
      setNotice(result.data.models.length
        ? 'Ollama доступна. Найдено моделей: ' + result.data.models.length
        : 'Ollama доступна, но на ней не установлены модели.');
    } finally { setBusy(null); }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!saved || !dirty || busy) return;
    setBusy('save'); setError(''); setNotice(''); setTestResult(null);
    try {
      const result = await call<OllamaConfig>('/api/admin/v1/ai/ollama', {
        method: 'PUT',
        body: JSON.stringify({
          enabled, baseUrl: baseUrl.trim(), model: model.trim(), revision: saved.revision,
        }),
      });
      if (!result.ok) { setError(result.error.message); return; }
      setSaved(result.data);
      setBaseUrl(result.data.baseUrl);
      setModel(result.data.model);
      setEnabled(result.data.enabled);
      setNotice('Настройки Ollama сохранены. Проверка фактического ответа выполняется отдельно.');
    } finally { setBusy(null); }
  }

  async function test(): Promise<void> {
    if (!saved || dirty || busy) return;
    setBusy('test'); setError(''); setNotice(''); setTestResult(null);
    try {
      const result = await call<OllamaTest>('/api/admin/v1/ai/ollama/test', {
        method: 'POST', body: JSON.stringify({ revision: saved.revision }),
      });
      if (!result.ok) { setError(result.error.message); return; }
      setTestResult(result.data);
    } finally { setBusy(null); }
  }
  return (
    <section className="asa-ai-ollama" aria-labelledby="asa-ai-ollama-title" aria-busy={!!busy}>
      <div className="admin-section-heading">
        <div>
          <h2 id="asa-ai-ollama-title">Ollama — локальные и сетевые модели</h2>
          <p>ASA Lab обращается к Ollama с сервера API. Ученикам сетевой адрес не раскрывается.</p>
        </div>
      </div>
      {error ? <p className="admin-inline-error" role="alert">{error} <button type="button" onClick={() => setReload(v => v + 1)} disabled={!!busy}>Перезагрузить</button></p> : null}
      {notice ? <p role="status" className="asa-ai-ollama-success">{notice}</p> : null}
      {busy === 'load' ? <p role="status">Загрузка настроек Ollama…</p> : null}
      {saved ? (
        <form onSubmit={(event) => void save(event)} className="asa-ai-ollama-form">
          <label className="asa-ai-ollama-field">
            <strong>Адрес Ollama</strong>
            <input aria-label="Адрес Ollama" type="url" spellCheck={false}
              value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setModels([]); setTestResult(null); }}
              placeholder="http://192.168.1.20:11434" maxLength={256} required disabled={!!busy} />
            <small>Например: http://192.168.1.20:11434 для другого компьютера в LAN; http://127.0.0.1:11434 для API на том же хосте; host.docker.internal для Docker host-gateway. Разрешены только частные сетевые адреса.</small>
          </label>
          <div className="asa-ai-ollama-discovery">
            <button className="btn-secondary" type="button" onClick={() => void discover()} disabled={!!busy || !baseUrl.trim()}>
              {busy === 'discover' ? 'Проверяем сеть…' : 'Найти установленные модели'}
            </button>
            {models.length ? <span role="status">Доступно: {models.length}</span> : null}
          </div>
          <label className="asa-ai-ollama-field">
            <strong>Модель по умолчанию</strong>
            <input type="text" aria-label="Модель Ollama" value={model} maxLength={100} spellCheck={false} required
              onChange={event => { setModel(event.target.value); setTestResult(null); }} disabled={!!busy}
              list="asa-ai-ollama-models" placeholder="gemma4:12b" />
            <datalist id="asa-ai-ollama-models">{models.map(item => <option key={item.name} value={item.name} />)}</datalist>
            <small>Модель должна быть установлена на выбранном компьютере. Загрузка моделей из админки намеренно отключена.</small>
          </label>
          <label className="asa-ai-ollama-toggle">
            <input type="checkbox" checked={enabled} disabled={!!busy}
              onChange={event => setEnabled(event.target.checked)} />
            <span>Разрешить ответы через Ollama пользователям ASA Lab</span>
          </label>
          <div className="asa-ai-ollama-actions">
            <button type="submit" disabled={!!busy || !dirty}> {busy === 'save' ? 'Сохраняем…' : 'Сохранить настройки'} </button>
            <button className="btn-secondary" type="button" onClick={() => void test()}
              disabled={!!busy || dirty}>{busy === 'test' ? 'Получаем ответ…' : 'Проверить реальный ответ модели'}</button>
          </div>
          <p className="asa-ai-ollama-footnote">Локальные вызовы не требуют API-ключа и не расходуют квоту платных внешних запросов. Остаются в силе ограничения пользователя, школьные разрешения и политика хранения переписки. Проверка модели может занять GPU.</p>
          {testResult ? <p className="asa-ai-ollama-success" role="status">
            Модель {testResult.model} ответила за {(testResult.elapsedMs / 1000).toFixed(1)} с · {new Date(testResult.testedAt).toLocaleString('ru-RU')}.
          </p> : null}
        </form>
      ) : null}
    </section>
  );
}
