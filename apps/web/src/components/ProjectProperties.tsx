import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, type Project } from '../api';
import './project-properties.css';

/**
 * Свойства работы.
 *
 * Имя, описание, теги, кому видно и под какой лицензией — в одном месте.
 * Публикация живёт здесь же и не является отдельным действием: работа не
 * «делится», она бывает частной, доступной по ссылке или общедоступной, и это
 * такое же её свойство, как имя.
 */

const LICENCES: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  {
    value: 'reserved',
    label: 'Все права сохранены',
    hint: 'Другие могут смотреть, но не использовать работу без вашего разрешения.',
  },
  {
    value: 'public-domain',
    label: 'Общественное достояние',
    hint: 'Работой можно пользоваться как угодно, в том числе в коммерческих целях.',
  },
  {
    value: 'cc-by',
    label: 'CC BY — с указанием автора',
    hint: 'Можно перерабатывать и использовать, если указан автор.',
  },
  {
    value: 'cc-by-sa',
    label: 'CC BY-SA — с указанием автора, на тех же условиях',
    hint: 'Как предыдущая, но переработки должны распространяться так же.',
  },
  {
    value: 'cc-by-nc',
    label: 'CC BY-NC — без коммерческого использования',
    hint: 'Можно перерабатывать с указанием автора, но не зарабатывать на этом.',
  },
];

const VISIBILITY: ReadonlyArray<{ value: 'private' | 'link' | 'public'; label: string; hint: string }> = [
  { value: 'private', label: 'Частная', hint: 'Видна только вам.' },
  {
    value: 'link',
    label: 'Доступна по ссылке',
    hint: 'В галерее не появляется, но откроется у любого, кому вы дали адрес.',
  },
  {
    value: 'public',
    label: 'Общедоступная',
    hint: 'Висит в галерее — её видят и могут взять за основу.',
  },
];

export function ProjectProperties({
  project,
  onClose,
  onSaved,
}: {
  readonly project: Project;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): JSX.Element {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? '');
  const [tags, setTags] = useState<readonly string[]>(project.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [license, setLicense] = useState(project.license ?? 'reserved');
  const [visibility, setVisibility] = useState<'private' | 'link' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.galleryState(project.id).then((result) => {
      if (!result.ok) return;
      setVisibility(
        result.data.published ? ((result.data.visibility ?? 'public') as 'link' | 'public') : 'private',
      );
    });
  }, [project.id]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function addTag(): void {
    const value = tagDraft.trim().toLowerCase().slice(0, 32);
    setTagDraft('');
    if (!value || tags.includes(value) || tags.length >= 10) return;
    setTags([...tags, value]);
  }

  function onTagKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag();
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setError('Введите имя проекта.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.saveProjectProperties(project.id, {
      title: title.trim(),
      description: description.trim() || null,
      tags: [...tags],
      license,
      visibility,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось сохранить свойства.');
      return;
    }
    onSaved();
  }

  const licenceHint = LICENCES.find((entry) => entry.value === license)?.hint ?? '';

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal project-properties"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-properties-title"
      >
        <header className="project-properties-head">
          <h2 id="project-properties-title">Свойства проекта</h2>
          <button type="button" className="project-properties-close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </header>

        <form onSubmit={(event) => void save(event)}>
          <label htmlFor="properties-title">Имя проекта</label>
          <input
            id="properties-title"
            value={title}
            maxLength={255}
            disabled={busy}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />

          <label htmlFor="properties-description">Описание проекта</label>
          <textarea
            id="properties-description"
            rows={4}
            maxLength={2000}
            value={description}
            disabled={busy}
            placeholder="Расскажите, что это и как сделано."
            onChange={(event) => setDescription(event.target.value)}
          />

          <label htmlFor="properties-tags">Теги</label>
          <p className="account-hint">
            Не более десяти. Добавить — Enter или запятая.
          </p>
          <div className="project-properties-tags">
            {tags.map((tag) => (
              <span key={tag}>
                {tag}
                <button
                  type="button"
                  aria-label={`Убрать тег ${tag}`}
                  onClick={() => setTags(tags.filter((entry) => entry !== tag))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            id="properties-tags"
            value={tagDraft}
            maxLength={32}
            disabled={busy || tags.length >= 10}
            placeholder={tags.length >= 10 ? 'Десять — предел' : 'Помогите найти вашу работу'}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={onTagKey}
            onBlur={addTag}
          />

          <span className="field-label">Кому видно</span>
          <div className="project-properties-choices" role="radiogroup" aria-label="Кому видно">
            {VISIBILITY.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="visibility"
                  value={option.value}
                  checked={visibility === option.value}
                  disabled={busy}
                  onChange={() => setVisibility(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.hint}
                </span>
              </label>
            ))}
          </div>

          <label htmlFor="properties-license">Лицензия</label>
          <select
            id="properties-license"
            value={license}
            disabled={busy}
            onChange={(event) => setLicense(event.target.value)}
          >
            {LICENCES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <p className="account-hint">{licenceHint}</p>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить изменения'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
