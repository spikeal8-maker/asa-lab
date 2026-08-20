import { useCallback, useEffect, useState, type JSX } from 'react';
import { api, VISIBILITY_OPTIONS, type ContentShare, type Visibility } from '../api';
import './share-dialog.css';

/**
 * Кому это видно.
 *
 * Один и тот же вопрос для задания и для курса, поэтому одно окно. Порядок по
 * возрастающей — только мне, названным коллегам, школе, всем — и каждый уровень
 * подписан тем, что он на самом деле значит: «школа» и «все» звучат похоже, а
 * разница между ними — выйдет ли работа за стены школы.
 *
 * Поимённый список появляется только на своём уровне: на остальных он ничего не
 * решает и только сбивает.
 */
export function ShareDialog({
  kind,
  subjectId,
  title,
  visibility,
  onClose,
  onChanged,
}: {
  readonly kind: 'assignment' | 'course';
  readonly subjectId: string;
  readonly title: string;
  readonly visibility: Visibility;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const [level, setLevel] = useState<Visibility>(visibility);
  const [shares, setShares] = useState<ContentShare[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await api.listShares(kind, subjectId);
    setShares(result.ok ? result.data.items : []);
  }, [kind, subjectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function choose(next: Visibility): Promise<void> {
    setBusy(true);
    const result = await api.setVisibility(kind, subjectId, next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось изменить доступ.');
      return;
    }
    setError(null);
    setLevel(next);
    onChanged();
  }

  async function invite(): Promise<void> {
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    const result = await api.addShare(kind, subjectId, address);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось открыть доступ.');
      return;
    }
    setError(null);
    setEmail('');
    await reload();
    // Открыть доступ поимённо и оставить уровень «только мне» — значит не
    // открыть его никому: подтягиваем уровень к тому, что человек сделал.
    if (level === 'private') await choose('teachers');
    onChanged();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal share-dialog" role="dialog" aria-modal="true" aria-label="Кому видно">
        <h2>Кому видно</h2>
        <p>«{title}»</p>

        <div className="share-levels" role="radiogroup" aria-label="Уровень доступа">
          {VISIBILITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={level === option.value}
              className={level === option.value ? 'is-active' : undefined}
              disabled={busy}
              onClick={() => void choose(option.value)}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>

        {level === 'teachers' ? (
          <section className="share-people">
            <label htmlFor="share-email">Почта преподавателя</label>
            <div className="share-invite">
              <input
                id="share-email"
                type="email"
                value={email}
                disabled={busy}
                placeholder="kolleg@school.ru"
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void invite()}
              >
                Открыть доступ
              </button>
            </div>
            {shares === null ? (
              <p role="status">Загружаем…</p>
            ) : shares.length === 0 ? (
              <p className="account-hint">Пока никому не открыто.</p>
            ) : (
              <ul data-testid="share-list">
                {shares.map((share) => (
                  <li key={share.accountId}>
                    <span>
                      <strong>{share.displayName}</strong>
                      <small>{share.email}</small>
                    </span>
                    <button
                      type="button"
                      className="assignment-remove"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await api.removeShare(kind, subjectId, share.accountId);
                        setBusy(false);
                        await reload();
                        onChanged();
                      }}
                    >
                      Убрать
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {level === 'public' ? (
          <p className="share-public-note">
            Работа попадёт в общий каталог. Любой преподаватель сможет посмотреть её и забрать себе
            копию — ваша останется вашей, и правки автора чужие уроки не тронут.
          </p>
        ) : null}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
