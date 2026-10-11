import { useCallback, useEffect, useRef, useState } from 'react';
import {
  participantsApi,
  type ParticipantAssignment,
  type ParticipantAssignments,
} from '../classroom-participants-api';
import { useSchoolTime } from './school-time';
import { onSessionLoggedOut } from '../session-fetch';

export function participantAssignmentLabel(status: ParticipantAssignment['status']): string {
  switch (status) {
    case 'not_started':
      return 'Не начато';
    case 'in_progress':
      return 'В работе';
    case 'submitted':
    case 'waiting_review':
      return 'Ждёт проверки';
    case 'changes_requested':
      return 'На доработке';
    case 'completed':
      return 'Принято';
    case 'excused':
      return 'Освобождён';
    case 'invalidated':
      return 'Попытка отменена';
    case 'not_applicable':
      return 'Не назначено';
    default:
      return 'Статус недоступен';
  }
}
export function participantAssignmentHref(
  item: ParticipantAssignment,
  classroomId: string,
  seatId: string,
  learner: boolean,
): string {
  const query = new URLSearchParams();
  if (item.assignmentId) query.set('assignment', item.assignmentId);
  else if (item.courseRunId) {
    query.set('courseRun', item.courseRunId);
    query.set('lesson', item.id);
  }
  if (!learner && item.assignmentId) query.set('learner', seatId);
  return learner
    ? `#/learning?${query}`
    : `#/classrooms/${encodeURIComponent(classroomId)}?${query}`;
}

export function ParticipantAssignmentsList({
  classroomId,
  seatId,
  learner = false,
  seatSession = false,
  readOnly = false,
  onOpenProject,
}: {
  classroomId: string;
  seatId: string;
  learner?: boolean;
  seatSession?: boolean;
  readOnly?: boolean;
  onOpenProject?: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [page, setPage] = useState<ParticipantAssignments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const identity = `${classroomId}:${seatId}:${seatSession}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const time = useSchoolTime();
  const load = useCallback(
    async (offset = 0) => {
      const token = ++generation.current;
      setLoading(true);
      setError(null);
      if (offset === 0) setPage(null);
      const result = seatSession
        ? await participantsApi.seatAssignments(offset)
        : await participantsApi.assignments(classroomId, seatId, offset);
      if (token !== generation.current || identity !== currentIdentity.current) return;
      setLoading(false);
      setLoadedIdentity(identity);
      if (result.ok)
        setPage((old) =>
          offset && old
            ? {
                ...result.data,
                items: [...old.items, ...result.data.items].filter(
                  (item, index, all) => all.findIndex((other) => other.id === item.id) === index,
                ),
              }
            : result.data,
        );
      else {
        setPage(null);
        setError(result.error.message);
      }
    },
    [classroomId, seatId, seatSession, identity],
  );
  useEffect(() => {
    setPage(null);
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('focus', refresh);
    const unsubscribe = onSessionLoggedOut(() => {
      generation.current++;
      setPage(null);
      setError('Войдите, чтобы открыть задания.');
    });
    return () => {
      generation.current++;
      window.removeEventListener('focus', refresh);
      unsubscribe();
    };
  }, [load]);
  const visiblePage = loadedIdentity === identity ? page : null;
  return (
    <section className="participant-assignments" aria-label="Задания участника">
      <div className="participant-assignment-head">
        <h2>Задания</h2>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          Обновить задания
        </button>
      </div>
      {readOnly ? <p>Класс в архиве. Задания доступны для чтения.</p> : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </p>
      ) : null}
      {loading ? <p role="status">Загружаем задания…</p> : null}
      {visiblePage?.items.length === 0 && !loading && !error ? (
        <p>Назначенных заданий пока нет.</p>
      ) : null}
      <ul>
        {visiblePage?.items.map((item) => (
          <li key={item.id} data-assignment-id={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.kind === 'theory'
                  ? 'Теория курса'
                  : item.kind === 'quiz'
                    ? 'Тест'
                    : `Практическое задание${item.courseRunId ? ' курса' : ''}`}
              </span>
            </div>
            <span className="participant-assignment-status">
              {participantAssignmentLabel(item.status)}
            </span>
            <span>{item.dueAt ? `Срок: ${time.longDateTime(item.dueAt)}` : 'Без срока'}</span>
            <div className="participant-actions">
              <a
                className="btn-secondary"
                href={participantAssignmentHref(item, classroomId, seatId, learner)}
              >
                {learner || item.kind === 'theory' ? 'Открыть задание' : 'Открыть проверку'}
              </a>
              {item.projectId && item.moduleKey ? (
                <a
                  className="btn-secondary"
                  href={`#/projects/${encodeURIComponent(item.projectId)}`}
                  onClick={
                    onOpenProject
                      ? (event) => {
                          event.preventDefault();
                          onOpenProject(item.projectId!, item.moduleKey!);
                        }
                      : undefined
                  }
                >
                  Открыть проект
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {visiblePage?.nextOffset != null ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={() => void load(visiblePage.nextOffset!)}
        >
          Ещё задания
        </button>
      ) : null}
    </section>
  );
}
