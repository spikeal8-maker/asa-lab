import { useMemo, useState } from 'react';
import type { ClassroomStudentSeat } from '../api';
import { ClassJoinQr } from './ClassJoinQr';
import './student-access.css';

const PUBLIC_SITE_LABEL = 'Asolab.ru';
const PUBLIC_SITE_ORIGIN = 'https://asolab.ru';

export function StudentAccessCards({
  classroomTitle,
  classCode,
  students,
  initialStudentIds = [],
  onClose,
}: {
  classroomTitle: string;
  classCode: string | null;
  students: readonly ClassroomStudentSeat[];
  initialStudentIds?: readonly string[];
  onClose: () => void;
}): JSX.Element {
  const available = useMemo(
    () => students.filter((student) => student.status !== 'suspended'),
    [students],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        initialStudentIds.length > 0
          ? initialStudentIds.filter((id) => available.some((student) => student.id === id))
          : available.map((student) => student.id),
      ),
  );
  const selectedStudents = available.filter((student) => selected.has(student.id));
  const classJoinUrl = classCode
    ? `${PUBLIC_SITE_ORIGIN}/#/join-class?code=${encodeURIComponent(classCode)}`
    : `${PUBLIC_SITE_ORIGIN}/#/join-class`;

  function printCards(): void {
    if (!classCode || selectedStudents.length === 0) return;
    const className = 'student-access-printing';
    const cleanup = () => document.body.classList.remove(className);
    document.body.classList.add(className);
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1500);
  }

  return (
    <div className="modal-backdrop student-access-backdrop" role="presentation">
      <section
        className="modal student-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-access-title"
      >
        <header className="student-access-heading no-print">
          <div>
            <h2 id="student-access-title">Карточки доступа</h2>
            <p>
              {classroomTitle}. Карточки можно печатать повторно — печать не меняет коды и не
              завершает входы учеников.
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        {!classCode ? (
          <p className="form-error no-print">
            Вход в класс сейчас закрыт. Сначала выдайте новый код класса, затем распечатайте
            карточки.
          </p>
        ) : null}

        <div className="student-access-tools no-print">
          <span>
            Выбрано: {selectedStudents.length} из {available.length}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setSelected(new Set(available.map((student) => student.id)))}
          >
            Выбрать всех
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSelected(new Set())}>
            Снять выбор
          </button>
        </div>

        <div className="student-access-selector no-print" aria-label="Учащиеся для печати">
          {available.map((student) => (
            <label key={student.id}>
              <input
                type="checkbox"
                checked={selected.has(student.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(student.id);
                  else next.delete(student.id);
                  setSelected(next);
                }}
              />
              <span>{student.displayLabel}</span>
              <code>{student.studentCode}</code>
            </label>
          ))}
        </div>

        <div className="student-access-print-sheet" aria-label="Карточки доступа для печати">
          {selectedStudents.map((student) => (
            <article className="student-access-card" key={student.id} data-qr-url={classJoinUrl}>
              <div className="student-access-card-copy">
                <header>
                  <strong>ASA Lab</strong>
                  <span>{PUBLIC_SITE_LABEL}</span>
                </header>
                <h3>{student.displayLabel}</h3>
                <p className="student-access-class">{classroomTitle}</p>
                <div className="student-access-codes">
                  <div>
                    <span>Код класса</span>
                    <code>{classCode ?? '—'}</code>
                  </div>
                  <div className="student-access-student-code">
                    <span>Код ученика</span>
                    <code>{student.studentCode}</code>
                  </div>
                </div>
                <p className="student-access-instruction">
                  Вручную: {PUBLIC_SITE_LABEL} → код класса → код ученика.
                </p>
              </div>
              <aside className="student-access-qr" aria-label="QR для входа в класс">
                <ClassJoinQr url={classJoinUrl} label={`Войти в класс ${classroomTitle}`} />
                <strong>Войти в класс</strong>
              </aside>
            </article>
          ))}
        </div>

        <footer className="student-access-actions no-print">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Закрыть
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!classCode || selectedStudents.length === 0}
            onClick={printCards}
          >
            Распечатать {selectedStudents.length > 0 ? `(${selectedStudents.length})` : ''}
          </button>
        </footer>
      </section>
    </div>
  );
}
