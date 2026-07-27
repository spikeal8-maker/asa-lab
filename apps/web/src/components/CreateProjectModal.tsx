import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, type Project, type ProjectScope } from '../api';
import { CircuitIcon, CloseIcon } from '../electronics/workbench-icons';

const MODULES = [
  { key: 'electronics', title: 'Электроника', description: 'Схемы, компоненты, провода и моделирование.', enabled: true },
  { key: 'blocks', title: 'Блочное программирование', description: 'Scratch-подобные проекты.', enabled: false },
  { key: 'checkers', title: 'Шахматы и шашки', description: 'Позиции, задачи и партии.', enabled: false },
  { key: 'three-d', title: '3D-моделирование', description: 'Сцены и подготовка к печати.', enabled: false },
] as const;

export function CreateProjectModal({
  scope,
  classroomId,
  onClose,
  onCreated,
}: {
  scope: ProjectScope;
  classroomId?: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => {
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, []);

  function trap(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Введите название проекта.');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.createProject({
      scope,
      classroomId: scope === 'classroom' ? classroomId : null,
      title: trimmed,
      module: 'electronics',
      idempotencyKey: crypto.randomUUID(),
    });
    setBusy(false);
    if (result.ok) onCreated(result.data.project);
    else setError(result.error.message || 'Не удалось создать проект.');
  }

  return (
    <div className="modal-backdrop project-create-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        ref={dialogRef}
        className="project-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onKeyDown={trap}
      >
        <div className="project-create-heading">
          <div>
            <p className="project-create-eyebrow">Новый проект</p>
            <h2 id="create-project-title">Что вы хотите создать?</h2>
          </div>
          <button type="button" className="project-create-close" onClick={onClose} disabled={busy} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="project-title">Название проекта</label>
          <input
            ref={titleRef}
            id="project-title"
            value={title}
            maxLength={255}
            onChange={(event) => setTitle(event.target.value)}
          />
          <fieldset className="module-picker">
            <legend>Среда проекта</legend>
            <div className="module-picker-grid">
              {MODULES.map((module) => (
                <label key={module.key} className={module.enabled ? 'module-tile selected' : 'module-tile disabled'}>
                  <input
                    type="radio"
                    name="module"
                    value={module.key}
                    checked={module.key === 'electronics'}
                    disabled={!module.enabled}
                    readOnly
                  />
                  <span className="module-tile-icon"><CircuitIcon /></span>
                  <span className="module-tile-title">{module.title}</span>
                  <span className="module-tile-description">{module.description}</span>
                  {!module.enabled ? <span className="module-coming">Скоро</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="project-create-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Отмена</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Создаём…' : 'Создать проект'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
