import { useRef, useState } from 'react';
import { api, type ClassroomStudentSeat } from '../api';
import './student-access.css';

const STUDENT_CODE_PATTERN = /^[2346789ACDEFGHJKMNPQRTUVWXY]{6}$/;

function normalize(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^2346789ACDEFGHJKMNPQRTUVWXY]/g, '')
    .slice(0, 6);
}

export function StudentCodeDialog({
  classroomId,
  student,
  onClose,
  onSaved,
}: {
  classroomId: string;
  student: ClassroomStudentSeat;
  onClose: () => void;
  onSaved: (studentCode: string) => Promise<void> | void;
}): JSX.Element {
  const [value, setValue] = useState(student.studentCode);
  const [busy, setBusy] = useState<'save' | 'generate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);

  async function change(studentCode?: string): Promise<void> {
    const key = studentCode ?? '__generate__';
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    setBusy(studentCode ? 'save' : 'generate');
    setError(null);
    const result = await api.setStudentCode(classroomId, student.id, {
      ...(studentCode ? { studentCode } : {}),
      requestId: request.current.id,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось изменить код ученика.');
      return;
    }
    request.current = null;
    await onSaved(result.data.studentCode);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal student-code-dialog" role="dialog" aria-modal="true">
        <h2>Код ученика</h2>
        <p>
          {student.displayLabel}. Изменение кода завершит старые ученические входы, но не затронет
          работы, оценки и историю обучения.
        </p>
        <label htmlFor="student-code-value">Код ученика</label>
        <input
          id="student-code-value"
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          maxLength={6}
          disabled={busy !== null}
          onChange={(event) => setValue(normalize(event.target.value))}
        />
        <p className="field-hint">
          Ровно 6 символов. Похожие символы вроде O/0 и I/1 не используются.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="student-code-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={() => void change()}
          >
            {busy === 'generate' ? 'Генерируем…' : 'Сгенерировать новый'}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={
              busy !== null || !STUDENT_CODE_PATTERN.test(value) || value === student.studentCode
            }
            onClick={() => void change(value)}
          >
            {busy === 'save' ? 'Сохраняем…' : 'Сохранить код'}
          </button>
        </div>
      </section>
    </div>
  );
}
