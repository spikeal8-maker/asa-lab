import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SeatAward } from '../api';
import { useSchoolTime } from './school-time';
import './seat-awards.css';

/**
 * Badges a teacher gives a learner.
 *
 * A verdict on a model says whether that model was good. A badge is about the
 * person and it lasts, which is why it is the thing a child comes back for. The
 * set is small and fixed so that "Помог другим" means the same in every class,
 * and every one of them is positive: this is a place to notice children doing
 * well, not a record of who was careless.
 *
 * The reason matters more than the icon, so a teacher can write one, and the
 * learner sees it. "За мост, который выдержал книгу" is what gets remembered.
 */

export const SEAT_AWARDS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly glyph: string;
  readonly hint: string;
}> = [
  { key: 'first-model', label: 'Первая работа', glyph: '🌱', hint: 'Сделал первую свою работу' },
  { key: 'bright-idea', label: 'Своя идея', glyph: '💡', hint: 'Придумал что-то своё' },
  { key: 'careful-work', label: 'Аккуратность', glyph: '✨', hint: 'Работа сделана чисто' },
  { key: 'precision', label: 'Точность', glyph: '📐', hint: 'Всё по размерам' },
  { key: 'perseverance', label: 'Довёл до конца', glyph: '🏔️', hint: 'Не бросил трудное' },
  { key: 'helper', label: 'Помощник', glyph: '🤝', hint: 'Помогал другим в классе' },
  { key: 'explorer', label: 'Исследователь', glyph: '🔭', hint: 'Пробует новое' },
  {
    key: 'editors-choice',
    label: 'Выбор преподавателя',
    glyph: '🏆',
    hint: 'Особенно понравилось',
  },
];

export function awardOf(key: string): (typeof SEAT_AWARDS)[number] | undefined {
  return SEAT_AWARDS.find((entry) => entry.key === key);
}

/** The badges themselves, as a row of marks. Used wherever a learner appears. */
export function SeatAwardRow({
  keys,
  size = 'normal',
}: {
  readonly keys: readonly string[];
  readonly size?: 'normal' | 'small';
}): JSX.Element | null {
  if (keys.length === 0) return null;
  return (
    <span className={`seat-award-row${size === 'small' ? ' is-small' : ''}`}>
      {keys.map((key) => {
        const award = awardOf(key);
        if (!award) return null;
        return (
          <span key={key} className="seat-award-chip" title={award.label}>
            <i aria-hidden="true">{award.glyph}</i>
            <span className="sr-only">{award.label}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Giving them. Every badge is on screen at once rather than behind a menu: a
 * teacher deciding what to notice should see the whole vocabulary, and giving
 * one should cost a single press during a lesson.
 */
export function SeatAwardPanel({
  classroomId,
  seatId,
  readOnly = false,
  onChanged,
  awardApi = api,
}: {
  readonly classroomId: string;
  readonly seatId: string;
  readonly readOnly?: boolean;
  readonly onChanged?: (keys: readonly string[]) => void;
  readonly awardApi?: Pick<typeof api, 'listSeatAwards' | 'setSeatAward'>;
}): JSX.Element {
  const [items, setItems] = useState<SeatAward[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const time = useSchoolTime();
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const token = ++generation.current;
    setError(null);
    const result = await awardApi.listSeatAwards(classroomId, seatId);
    if (token !== generation.current) return;
    if (result.ok) {
      setItems(result.data.items);
      onChanged?.(result.data.items.map((entry) => entry.awardKey));
    } else setError(result.error.message || 'Не удалось загрузить заслуги.');
  }, [classroomId, seatId, onChanged, awardApi]);

  useEffect(() => {
    setItems(null);
    setNoteFor(null);
    setNote('');
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);

  async function set(awardKey: string, granted: boolean, withNote: string | null): Promise<void> {
    const token = generation.current;
    setBusy(awardKey);
    setError(null);
    const result = await awardApi.setSeatAward(classroomId, seatId, awardKey, granted, withNote);
    if (token !== generation.current) return;
    setBusy(null);
    if (result.ok) {
      setNoteFor(null);
      setNote('');
      setItems(result.data.items);
      onChanged?.(result.data.items.map((entry) => entry.awardKey));
    } else setError(result.error.message || 'Не удалось сохранить заслугу.');
  }

  const held = new Map((items ?? []).map((entry) => [entry.awardKey, entry]));

  return (
    <section className="seat-awards" aria-labelledby="seat-awards-title">
      <h2 id="seat-awards-title">Значки</h2>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void reload()}>
            Повторить
          </button>
        </p>
      ) : null}
      {items === null && !error ? <p role="status">Загружаем заслуги…</p> : null}
      {readOnly ? null : (
        <p className="seat-awards-lead">
          Отметьте, что получилось у ученика. Можно добавить причину — её увидит он сам.
        </p>
      )}

      <ul className="seat-award-grid" data-testid="seat-award-grid">
        {SEAT_AWARDS.map((award) => {
          const given = held.get(award.key);
          return (
            <li key={award.key}>
              <button
                type="button"
                className={given ? 'is-given' : undefined}
                aria-pressed={Boolean(given)}
                disabled={readOnly || busy !== null || items === null || error !== null}
                title={award.hint}
                onClick={() => {
                  if (given) void set(award.key, false, null);
                  else setNoteFor(award.key);
                }}
              >
                <i aria-hidden="true">{award.glyph}</i>
                <strong>{award.label}</strong>
                {given?.note ? <small>{given.note}</small> : null}
                {given ? (
                  <em>
                    {given.awardedBy} · {time.date(given.createdAt)}
                  </em>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {noteFor ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Причина значка">
            <h2>{awardOf(noteFor)?.label}</h2>
            <p>За что вы даёте этот значок? Ученик это прочитает.</p>
            <label htmlFor="award-note">Причина</label>
            <input
              id="award-note"
              autoFocus
              maxLength={280}
              value={note}
              placeholder="За мост, который выдержал книгу"
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setNoteFor(null);
                  setNote('');
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null || readOnly}
                onClick={() => void set(noteFor, true, note.trim() || null)}
              >
                Выдать значок
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
