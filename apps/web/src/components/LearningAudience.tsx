import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type LearningAudience as Audience } from '../api';

export function LearningAudience({
  classroomId,
  assignmentId,
  courseRunId,
  onChanged,
}: {
  classroomId: string;
  assignmentId?: string;
  courseRunId?: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Audience | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const result = await api.learningAudience(
      classroomId,
      assignmentId ? { assignmentId } : courseRunId ? { courseRunId } : {},
    );
    if (result.ok) {
      setData(result.data.audience);
      setError(null);
    } else setError(result.error.message);
  }, [classroomId, assignmentId, courseRunId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function change(member: Audience['members'][number]) {
    if (!data || busy) return;
    const input = {
      include: !member.included,
      expectedIncluded: member.included,
      reason: reason.trim(),
    };
    const payload = JSON.stringify({ seat: member.seatId, ...input });
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    const result = await api.changeLearningAudienceMember(classroomId, data.id, member.seatId, {
      ...input,
      requestId: request.current.id,
    });
    setBusy(false);
    if (result.ok) {
      await load();
      setReason('');
      onChanged?.();
    } else setError(result.error.message);
  }
  if (!data && !error) return null;
  return (
    <details className="learning-conditions">
      <summary>Аудитория назначения</summary>
      {error ? (
        <p role="alert">
          {error}
          <button onClick={() => void load()}>Обновить аудиторию</button>
        </p>
      ) : null}
      {data?.type === 'whole_class' ? (
        <p>
          Весь класс: новые ученики включаются автоматически. Выход из класса не удаляет учебную
          историю.
        </p>
      ) : data ? (
        <>
          <p>
            {data.courseRunId
              ? 'Изменение относится ко всему этому курсу и его дочерним работам.'
              : 'Изменение относится только к этому назначению.'}{' '}
            Исключение прекращает доступ, но сохраняет сдачи и решения. Для повторной выдачи
            исключённому ученику нужно новое назначение.
          </p>
          <label>
            Причина изменения аудитории
            <input
              value={reason}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ul>
            {data.members.map((member) => (
              <li key={member.seatId}>
                {member.label} ·{' '}
                {member.withdrawn ? 'Исключён' : member.included ? 'Назначено' : 'Не назначено'}{' '}
                <button
                  type="button"
                  disabled={
                    busy ||
                    !reason.trim() ||
                    member.withdrawn ||
                    !['issued', 'active'].includes(member.status) ||
                    data.status !== 'active'
                  }
                  onClick={() => void change(member)}
                >
                  {member.included ? 'Исключить' : 'Добавить'} {member.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </details>
  );
}
