import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';

/** Personal authors use the existing canonical Activity API, never roster APIs. */
export function AuthoredMaterialsPage(): JSX.Element {
  const [items, setItems] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [opened, setOpened] = useState<{
    id: string;
    title: string;
    draft: { instructions: string | null };
  } | null>(null);
  const request = useRef<{ title: string; instructions: string; id: string } | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await api.authoredActivities();
    if (result.ok) setItems(result.data.items);
    else setError(result.error.message || 'Материалы временно недоступны.');
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function open(id: string) {
    setBusy(true);
    const result = await api.authoredActivity(id);
    if (result.ok) setOpened(result.data);
    else setError(result.error.message || 'Материал недоступен.');
    setBusy(false);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    if (
      !request.current ||
      request.current.title !== title ||
      request.current.instructions !== instructions
    ) {
      request.current = { title, instructions, id: crypto.randomUUID() };
    }
    const result = await api.createAuthoredActivity(title, instructions, request.current.id);
    if (result.ok) {
      request.current = null;
      setTitle('');
      setInstructions('');
      await refresh();
      await open(result.data.id);
    } else setError(result.error.message || 'Не удалось сохранить материал. Повторите попытку.');
    setBusy(false);
  }
  return (
    <main id="main-content" className="portal-content" tabIndex={-1}>
      <h1>Курсы и задания</h1>
      <p>Личные материалы. Создание черновика не публикует его и не открывает доступ к ученикам.</p>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void refresh()}>
            Повторить
          </button>
        </p>
      ) : null}
      <form className="account-profile-form" onSubmit={(event) => void create(event)}>
        <label>
          Название материала
          <input
            required
            maxLength={255}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Содержание
          <textarea
            maxLength={12000}
            rows={4}
            value={instructions}
            disabled={busy}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
          {busy ? 'Сохраняем…' : 'Создать материал'}
        </button>
      </form>
      {loading ? (
        <p role="status">Загружаем материалы…</p>
      ) : items.length === 0 && !error ? (
        <p>Пока нет личных материалов.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="account-inline-action"
                disabled={busy}
                onClick={() => void open(item.id)}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {opened ? (
        <section aria-label="Открытый материал">
          <h2>{opened.title}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>
            {opened.draft.instructions || 'Содержание не добавлено.'}
          </p>
          <span>Личный черновик</span>
        </section>
      ) : null}
    </main>
  );
}
