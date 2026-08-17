import type { ClassroomActivityEntry } from '../api';
import { useSchoolTime } from './school-time';

/**
 * The class record, in words a teacher reads rather than event names.
 *
 * One entry can stand for several identical things that happened close together
 * — an editor autosaves while a learner thinks — so the count is shown when it
 * is more than one, and the line says how long the stretch lasted rather than
 * pretending it was a single moment.
 */

const ACTIONS: Readonly<Record<string, string>> = {
  'seat.signed_in': 'вошёл в класс',
  'seat.signed_out': 'вышел из класса',
  'project.created': 'создал',
  'project.renamed': 'переименовал',
  'project.saved': 'работал над',
  'project.checkpoint': 'сохранил версию',
  'project.archived': 'убрал в архив',
  'project.trashed': 'отправил в корзину',
  'project.active': 'вернул из архива',
};

export function ClassroomActivityList({
  entries,
  emptyText,
  showWho = false,
}: {
  readonly entries: readonly ClassroomActivityEntry[];
  readonly emptyText: string;
  /** The class feed names the learner; a learner's own page does not repeat it. */
  readonly showWho?: boolean;
}): JSX.Element {
  // Times in the record are read in the teacher's own zone, not the device's:
  // a register consulted from a phone abroad must still say school time.
  const time = useSchoolTime();
  if (entries.length === 0) {
    return <p className="classroom-activity-empty">{emptyText}</p>;
  }

  return (
    <ol className="classroom-activity" data-testid="classroom-activity">
      {entries.map((entry) => (
        <li key={entry.id} className="classroom-activity-item">
          <span className="classroom-activity-when">{time.dateTime(entry.at)}</span>
          <span className="classroom-activity-text">
            {showWho && entry.seatLabel ? <strong>{entry.seatLabel}</strong> : null}{' '}
            {entry.byTeacher ? <em className="classroom-activity-teacher">педагог</em> : null}{' '}
            {ACTIONS[entry.action] ?? entry.action}
            {entry.projectTitle ? <> «{entry.projectTitle}»</> : null}
            {entry.count > 1 ? (
              <span
                className="classroom-activity-count"
                title={`с ${time.dateTime(entry.firstAt)}`}
              >
                ×{entry.count}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
