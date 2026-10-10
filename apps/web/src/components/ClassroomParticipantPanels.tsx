import { useCallback, useEffect, useRef, useState } from 'react';
import {
  participantsApi,
  PARTICIPANT_FACTORS,
  type ParticipantSettings,
  type ParticipantMetrics,
  type ParticipantProfile,
  type ParticipantGrades,
  type ParticipantManualHistory,
  type ParticipantStaff,
  type ParticipantResultHistory,
} from '../classroom-participants-api';
import { newClientId } from '../client-id';
import { avatarFileError, createAvatarDataUrl } from '../creator-portal/avatar-file';
import { SEAT_AWARDS, SeatAwardRow } from './SeatAwards';
import './classroom-participants.css';

export const FACTOR_LABELS = {
  projects: 'Проекты',
  logins: 'Входы / занятия',
  days: 'Активные дни',
  time: 'Активное время',
  grades: 'Оценки',
};
export function ParticipantRating({
  metrics,
  settings,
}: {
  metrics: ParticipantMetrics;
  settings: ParticipantSettings;
}): JSX.Element {
  return (
    <details className="participant-rating">
      <summary>
        {metrics.score === null
          ? 'Рейтинг выключен'
          : `Рейтинг ${metrics.score} · место ${metrics.rank}`}
      </summary>
      <p>
        За {settings.periodDays} дней. Среднее включённых факторов, 0–100. Это не школьная оценка.
      </p>
      <ul>
        {PARTICIPANT_FACTORS.filter((key) => settings.factors[key]).map((key) => (
          <li key={key}>
            {FACTOR_LABELS[key]}: {Number(metrics.factors[key]).toFixed(1)} / 100{' '}
            <small>
              (
              {key === 'projects'
                ? `${metrics.sources[key]} из ${5 * Math.ceil(settings.periodDays / 7)} работ`
                : key === 'time'
                  ? `${(metrics.sources[key] / 60).toFixed(1)} из ${settings.periodDays * 10} минут`
                  : key === 'grades'
                    ? `${metrics.sources[key]} результатов, средний процент`
                    : `${metrics.sources[key]} из ${settings.periodDays} дней`}
              )
            </small>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ClassroomRatingSettings({
  classroomId,
  readOnly,
  onSaved,
}: {
  classroomId: string;
  readOnly: boolean;
  onSaved: () => void;
}): JSX.Element {
  const [settings, setSettings] = useState<ParticipantSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const receipt = useRef<{ payload: string; id: string } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const token = ++generation.current;
    setError(null);
    setSettings(null);
    const result = await participantsApi.roster(classroomId);
    if (token !== generation.current) return;
    if (result.ok) setSettings(result.data.settings);
    else setError(result.error.message);
  }, [classroomId]);
  useEffect(() => {
    setBusy(false);
    setNotice('');
    receipt.current = null;
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function save(): Promise<void> {
    if (!settings || busy) return;
    const input = {
      expectedRevision: settings.revision,
      periodDays: settings.periodDays,
      factors: settings.factors,
    };
    const payload = JSON.stringify(input);
    if (receipt.current?.payload !== payload) receipt.current = { payload, id: newClientId() };
    setBusy(true);
    setError(null);
    setNotice('');
    const token = generation.current;
    const result = await participantsApi.mutate<ParticipantSettings>(
      classroomId,
      'settings',
      input,
      receipt.current.id,
    );
    if (token !== generation.current) return;
    setBusy(false);
    if (result.ok) {
      setSettings(result.data);
      receipt.current = null;
      setNotice('Рейтинг сохранён');
      onSaved();
    } else setError(result.error.message);
  }
  return (
    <section className="participant-settings" aria-label="Настройки рейтинга">
      <h3>Рейтинг класса</h3>
      {!settings && !error ? <p role="status">Загружаем настройки…</p> : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Обновить
          </button>
        </p>
      ) : null}
      {settings ? (
        <>
          <fieldset disabled={readOnly || busy}>
            <legend className="sr-only">Факторы рейтинга</legend>
            <label>
              Период{' '}
              <select
                aria-label="Период рейтинга"
                value={settings.periodDays}
                onChange={(e) =>
                  setSettings({ ...settings, periodDays: Number(e.target.value) as 7 | 30 | 90 })
                }
              >
                {[7, 30, 90].map((days) => (
                  <option key={days} value={days}>
                    {days} дней
                  </option>
                ))}
              </select>
            </label>
            {PARTICIPANT_FACTORS.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={settings.factors[key]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      factors: { ...settings.factors, [key]: e.target.checked },
                    })
                  }
                />
                {FACTOR_LABELS[key]}
              </label>
            ))}
          </fieldset>
          <details>
            <summary>Формула и пределы</summary>
            <p>
              Каждый фактор ограничен 0–100; балл — среднее только выбранных факторов, округлённое
              до сотых. Без данных фактор равен 0. Равные баллы получают одинаковое место.
            </p>
            <ul>
              <li>
                Проекты: новые работы без корзины и игр, максимум 5 × округлённое вверх число
                недель. Архив учитывается.
              </li>
              <li>
                Входы / занятия: дни с успешным входом (UTC), максимум один вклад за день. Повторные
                входы баллы не накапливают.
              </li>
              <li>Активные дни: дни с реальным изменением документа (UTC).</li>
              <li>
                Время: подтверждённые интервалы аналитики с реальным изменением документа внутри
                интервала или в пределах 90 секунд от его границ, без пересечений вкладок; до часа в
                день. 100 баллов за {settings.periodDays * 10} минут. Просто открытая вкладка баллы
                не даёт.
              </li>
              <li>
                Оценки: средний процент актуальных результатов по дате публикации и последних ручных
                оценок по дате занятия в периоде. Шкала каждой ручной оценки закреплена: 0–5, 0–100,
                3–5 или пять символов. Отзыв оценки исключает её; ноль учитывается.
              </li>
            </ul>
            <p>
              Активность до включения регистрации изменений документа не восстанавливается. Scratch
              учитывается в проектах и днях; активное время доступно только для редакторов с
              аналитикой.
            </p>
          </details>
          {PARTICIPANT_FACTORS.every((key) => !settings.factors[key]) ? (
            <p>Рейтинг выключен</p>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            disabled={readOnly || busy}
            onClick={() => void save()}
          >
            {busy ? 'Сохраняем…' : 'Сохранить рейтинг'}
          </button>
          {notice ? <p role="status">{notice}</p> : null}
        </>
      ) : null}
    </section>
  );
}

/** PNG conversion reuses the current bitmap decoding/cropping pipeline. The
 * API independently decodes and re-encodes; this is convenience, not trust. */
async function avatarPng(file: File): Promise<string> {
  const invalid = avatarFileError(file);
  if (invalid) throw new Error(invalid);
  const normalized = await createAvatarDataUrl(file);
  const raw = atob(normalized.slice(normalized.indexOf(',') + 1));
  const bitmap = await createImageBitmap(
    new Blob([Uint8Array.from(raw, (char) => char.charCodeAt(0))], { type: 'image/webp' }),
  );
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить изображение.');
    context.drawImage(bitmap, 0, 0);
    const data = canvas.toDataURL('image/png');
    if (data.length > 293_360)
      throw new Error('После уменьшения аватар больше 220 КБ. Выберите более простое изображение.');
    return data;
  } finally {
    bitmap.close();
  }
}

export function ParticipantMeritsAndAvatars({
  classroomId,
  seatId,
  profile,
  onChanged,
  readOnly = false,
  accountLearner = false,
}: {
  classroomId: string;
  seatId: string;
  profile: ParticipantProfile;
  onChanged: () => Promise<void>;
  readOnly?: boolean;
  accountLearner?: boolean;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [avatarTitle, setAvatarTitle] = useState('');
  const [secret, setSecret] = useState(false);
  const [achievement, setAchievement] = useState('');
  const [uploads, setUploads] = useState<Array<{ title: string; dataUrl: string; id: string }>>([]);
  const [choice, setChoice] = useState<string | null>(
    profile.avatars.find((a) => a.selected && a.available)?.id ?? null,
  );
  const receipt = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    setChoice(profile.avatars.find((a) => a.selected && a.available)?.id ?? null);
  }, [profile]);
  const scope = useRef(0);
  useEffect(() => {
    setError(null);
    setBusy(false);
    setUploads([]);
    receipt.current = null;
    return () => {
      scope.current++;
    };
  }, [classroomId, seatId]);
  const archived = profile.status !== 'active';
  const locked = busy || archived;
  async function mutate(
    action: string,
    input: Record<string, unknown>,
    requestId?: string,
  ): Promise<boolean> {
    const token = scope.current;
    const payload = JSON.stringify({ action, input });
    if (!requestId && receipt.current?.payload !== payload)
      receipt.current = { payload, id: newClientId() };
    const result = await participantsApi.mutate(
      classroomId,
      action,
      input,
      requestId ?? receipt.current!.id,
    );
    if (token !== scope.current) return false;
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    receipt.current = null;
    return true;
  }
  async function action(kind: string, input: Record<string, unknown>): Promise<void> {
    const token = scope.current;
    if (locked) return;
    setBusy(true);
    setError(null);
    try {
      if (await mutate(kind, input)) await onChanged();
    } finally {
      if (token === scope.current) setBusy(false);
    }
  }
  async function upload(): Promise<void> {
    if (locked || uploads.length === 0) return;
    setBusy(true);
    setError(null);
    const token = scope.current;
    try {
      for (const file of uploads) {
        const input = {
          title: file.title,
          dataUrl: file.dataUrl,
          secret,
          meritId: achievement.startsWith('custom:') ? achievement.slice(7) : null,
          builtinAward: achievement.startsWith('builtin:') ? achievement.slice(8) : null,
        };
        if (!(await mutate('avatar', input, file.id))) break;
        setUploads((current) => current.filter((item) => item.id !== file.id));
      }
      if (token === scope.current) await onChanged();
    } finally {
      if (token === scope.current) setBusy(false);
    }
  }
  return (
    <div className="participant-recognition">
      {error ? <p role="alert">{error}</p> : null}
      {profile.metrics.role === 'helper' ? (
        <p>
          Помощник помогает с организацией занятий в этом классе. Эта роль не даёт доступа к чужим
          работам, оценкам, управлению классом или учительскому API.
        </p>
      ) : null}
      <section>
        <h3>Заслуги преподавателя</h3>
        {profile.merits.length === 0 ? <p>Собственных заслуг пока нет.</p> : null}
        <ul className="participant-merits">
          {profile.merits.map((merit) => (
            <li key={merit.id}>
              <strong>{merit.title}</strong>
              <p>{merit.description}</p>
              {readOnly ? (
                merit.granted ? (
                  <span>Выдана</span>
                ) : null
              ) : (
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={merit.granted}
                  onClick={() =>
                    void action('merit_grant', { seatId, id: merit.id, granted: !merit.granted })
                  }
                >
                  {merit.granted ? 'Отозвать' : 'Выдать'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!locked) {
                setBusy(true);
                setError(null);
                void mutate('merit', { title, description })
                  .then(async (ok) => {
                    if (ok) {
                      setTitle('');
                      setDescription('');
                      await onChanged();
                    }
                  })
                  .finally(() => setBusy(false));
              }
            }}
          >
            <fieldset disabled={locked || profile.merits.length >= 24}>
              <legend>Новая заслуга · до 24 на класс</legend>
              <label>
                Название заслуги
                <input
                  required
                  maxLength={60}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Описание
                <textarea
                  maxLength={240}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <button type="submit">Создать заслугу</button>
            </fieldset>
          </form>
        ) : null}
      </section>
      <section>
        <h3>Аватары класса</h3>
        <p>Выбор относится к этому классу и сохраняет личный аватар аккаунта.</p>
        {profile.avatars.length === 0 ? <p>Аватаров класса пока нет.</p> : null}
        <div className="participant-avatar-grid">
          {profile.avatars.map((avatar) => (
            <div key={avatar.id}>
              <button
                type="button"
                disabled={locked || !avatar.available}
                aria-pressed={choice === avatar.id}
                aria-label={`Выбрать ${avatar.title}`}
                onClick={() => setChoice(avatar.id)}
              >
                <img src={avatar.url} alt="" width={64} height={64} />
                <span>{avatar.title}</span>
              </button>
              {avatar.secret ? (
                <small>{avatar.available ? 'Секретный · открыт' : 'Секретный · закрыт'}</small>
              ) : null}
              {!readOnly && avatar.secret ? (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    void action('avatar_grant', {
                      seatId,
                      id: avatar.id,
                      granted: !avatar.permitted,
                    })
                  }
                >
                  {avatar.permitted
                    ? `Отозвать доступ: ${avatar.title}`
                    : `Разрешить: ${avatar.title}`}
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="participant-actions">
          <button type="button" disabled={locked} onClick={() => setChoice(null)}>
            Обычный аватар
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              if (readOnly) {
                const token = scope.current;
                setBusy(true);
                setError(null);
                void (
                  accountLearner
                    ? participantsApi.mutate(
                        classroomId,
                        'avatar_choose',
                        { seatId, id: choice },
                        newClientId(),
                      )
                    : participantsApi.seatAvatar(choice, newClientId())
                )
                  .then(async (result) => {
                    if (token !== scope.current) return;
                    if (result.ok) await onChanged();
                    else setError(result.error.message);
                  })
                  .finally(() => {
                    if (token === scope.current) setBusy(false);
                  });
              } else void action('avatar_choose', { seatId, id: choice });
            }}
          >
            Сохранить аватар
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setChoice(profile.avatars.find((a) => a.selected && a.available)?.id ?? null)
            }
          >
            Отмена выбора
          </button>
        </div>
        {!readOnly ? (
          <fieldset disabled={locked || profile.avatars.length >= 24}>
            <legend>Загрузить аватары · до 24 на класс</legend>
            <p>
              PNG, JPEG, WebP до 8 МБ исходный файл; 320×320 после уменьшения, до 220 КБ. SVG и HTML
              запрещены.
            </p>
            <label>
              Название аватара
              <input
                maxLength={60}
                value={avatarTitle}
                onChange={(e) => setAvatarTitle(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={secret}
                onChange={(e) => setSecret(e.target.checked)}
              />
              Секретный аватар
            </label>
            {secret ? (
              <label>
                Открыть при достижении
                <select value={achievement} onChange={(e) => setAchievement(e.target.value)}>
                  <option value="">Только по выдаче доступа</option>
                  {SEAT_AWARDS.map((award) => (
                    <option key={award.key} value={`builtin:${award.key}`}>
                      {award.label}
                    </option>
                  ))}
                  {profile.merits.map((merit) => (
                    <option key={merit.id} value={`custom:${merit.id}`}>
                      {merit.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Файлы аватаров
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = '';
                  setError(null);
                  if (files.length + profile.avatars.length > 24) {
                    setError('В классе разрешено до 24 аватаров.');
                    return;
                  }
                  setBusy(true);
                  const token = scope.current;
                  void Promise.all(
                    files.map(async (file, i) => ({
                      title:
                        (avatarTitle.trim() || file.name.replace(/\.[^.]+$/, '')).slice(0, 55) +
                        (files.length > 1 ? ` ${i + 1}` : ''),
                      dataUrl: await avatarPng(file),
                      id: newClientId(),
                    })),
                  )
                    .then((files) => {
                      if (token === scope.current) setUploads(files);
                    })
                    .catch((problem: unknown) => {
                      if (token === scope.current)
                        setError(
                          problem instanceof Error
                            ? problem.message
                            : 'Не удалось подготовить аватар.',
                        );
                    })
                    .finally(() => {
                      if (token === scope.current) setBusy(false);
                    });
                }}
              />
            </label>
            {uploads.length > 0 ? (
              <>
                <div className="participant-avatar-grid">
                  {uploads.map((file) => (
                    <img key={file.id} src={file.dataUrl} alt={file.title} width={64} height={64} />
                  ))}
                </div>
                <button type="button" onClick={() => void upload()}>
                  Загрузить {uploads.length}
                </button>
                <button type="button" onClick={() => setUploads([])}>
                  Отмена загрузки
                </button>
              </>
            ) : null}
          </fieldset>
        ) : null}
      </section>
    </div>
  );
}

export function ParticipantGradeHistory({
  classroomId,
  seatId,
}: {
  classroomId: string;
  seatId: string;
}): JSX.Element {
  const [data, setData] = useState<ParticipantGrades | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ParticipantManualHistory | null>(null);
  const [historyColumn, setHistoryColumn] = useState<string | null>(null);
  const [resultHistory, setResultHistory] = useState<ParticipantResultHistory | null>(null);
  const [historyAssignment, setHistoryAssignment] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const historyGeneration = useRef(0);
  async function showResultHistory(assignmentId: string, offset = 0): Promise<void> {
    const scope = generation.current;
    const token = ++historyGeneration.current;
    if (!offset) setResultHistory(null);
    setError(null);
    setHistory(null);
    setHistoryAssignment(assignmentId);
    setHistoryLoading(true);
    const r = await participantsApi.resultHistory(classroomId, seatId, assignmentId, offset);
    if (scope !== generation.current || token !== historyGeneration.current) return;
    setHistoryLoading(false);
    if (r.ok)
      setResultHistory((old) =>
        offset && old ? { ...r.data, items: [...old.items, ...r.data.items] } : r.data,
      );
    else setError(r.error.message);
  }
  async function showManualHistory(columnId: string, beforeRevision?: number): Promise<void> {
    const scope = generation.current;
    const token = ++historyGeneration.current;
    if (!beforeRevision) setHistory(null);
    setError(null);
    setResultHistory(null);
    setHistoryColumn(columnId);
    setHistoryLoading(true);
    const r = await participantsApi.history(classroomId, seatId, columnId, beforeRevision);
    if (scope !== generation.current || token !== historyGeneration.current) return;
    setHistoryLoading(false);
    if (r.ok)
      setHistory((old) =>
        beforeRevision && old ? { ...r.data, items: [...old.items, ...r.data.items] } : r.data,
      );
    else setError(r.error.message);
  }
  const load = useCallback(
    async (offset = 0, resultOffset = 0) => {
      const token = ++generation.current;
      setError(null);
      setLoading(true);
      const result = await participantsApi.grades(classroomId, seatId, offset, resultOffset);
      if (token !== generation.current) return;
      setLoading(false);
      if (result.ok)
        setData((old) =>
          (offset || resultOffset) && old
            ? {
                ...result.data,
                journal: {
                  ...result.data.journal,
                  columns: [...old.journal.columns, ...result.data.journal.columns].filter(
                    (c, i, all) => all.findIndex((other) => other.id === c.id) === i,
                  ),
                  grades: [...old.journal.grades, ...result.data.journal.grades].filter(
                    (g, i, all) => all.findIndex((other) => other.id === g.id) === i,
                  ),
                },
                results: [...old.results, ...result.data.results].filter(
                  (r, i, all) =>
                    all.findIndex((other) => other.assignment_id === r.assignment_id) === i,
                ),
              }
            : result.data,
        );
      else {
        setData(null);
        setError(result.error.message);
      }
    },
    [classroomId, seatId],
  );
  useEffect(() => {
    setData(null);
    setHistory(null);
    setResultHistory(null);
    setHistoryLoading(false);
    void load();
    return () => {
      generation.current++;
      historyGeneration.current++;
    };
  }, [load]);
  return (
    <section className="participant-grades">
      <h2>Оценки и история</h2>
      {error ? (
        <p role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            Повторить
          </button>
        </p>
      ) : null}
      {loading ? <p role="status">Загружаем оценки…</p> : null}
      {data ? (
        <>
          <ul>
            {data.journal.grades.map((grade) => {
              const column = data.journal.columns.find((c) => c.id === grade.columnId);
              const value =
                grade.value === null
                  ? 'Отозвана'
                  : column?.preset === 'smileys'
                    ? ['😞', '😕', '😐', '🙂', '😃'][grade.value - 1]
                    : column?.preset === 'symbols'
                      ? ['●', '◆', '▲', '★', '🏆'][grade.value - 1]
                      : String(grade.value);
              return (
                <li key={grade.id}>
                  {column?.date} · {column?.category} <strong>{value}</strong>{' '}
                  <small>{grade.authorName}</small>
                  <button
                    type="button"
                    disabled={historyLoading}
                    onClick={() => void showManualHistory(grade.columnId)}
                  >
                    История
                  </button>
                </li>
              );
            })}
          </ul>
          <ul>
            {data.results.map((result) => (
              <li key={result.assignment_id}>
                {result.assignment_title}{' '}
                <strong>
                  {result.display_grade ??
                    (result.raw_points === null
                      ? 'Без балла'
                      : `${result.raw_points} / ${result.max_points}`)}
                </strong>
                {result.feedback ? <p>{result.feedback}</p> : null}
                <button
                  type="button"
                  disabled={historyLoading}
                  onClick={() => void showResultHistory(result.assignment_id)}
                >
                  История результата
                </button>
              </li>
            ))}
          </ul>
          {data.journal.grades.length + data.results.length === 0 ? <p>Оценок пока нет.</p> : null}
        </>
      ) : null}
      {data?.journal.nextOffset != null ? (
        <button
          type="button"
          disabled={loading || historyLoading}
          onClick={() => void load(data.journal.nextOffset!, data.resultOffset)}
        >
          Ещё ручные оценки
        </button>
      ) : null}
      {data?.nextResultOffset != null ? (
        <button
          type="button"
          disabled={loading || historyLoading}
          onClick={() => void load(data.journal.offset, data.nextResultOffset!)}
        >
          Ещё результаты
        </button>
      ) : null}
      {history ? (
        <div>
          <h3>История ручной оценки</h3>
          <ol>
            {history.items.map((grade) => (
              <li key={grade.id}>
                Версия {grade.revision}: {grade.value ?? 'Отозвана'} · {grade.authorName} ·{' '}
                {grade.publishedAt}
                {grade.reason ? <p>{grade.reason}</p> : null}
              </li>
            ))}
          </ol>
          {history.nextBeforeRevision !== null && historyColumn ? (
            <button
              type="button"
              disabled={historyLoading}
              onClick={() => void showManualHistory(historyColumn, history.nextBeforeRevision!)}
            >
              Ещё история
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              historyGeneration.current++;
              setHistoryLoading(false);
              setHistory(null);
            }}
          >
            Закрыть историю
          </button>
        </div>
      ) : null}
      {historyLoading ? <p role="status">Загружаем историю…</p> : null}
      {resultHistory ? (
        <div>
          <h3>История результата</h3>
          <ol>
            {resultHistory.items.map((r) => (
              <li key={r.id}>
                Попытка {r.attempt_number}, версия {r.revision}:{' '}
                {r.raw_points === null ? 'Без балла' : `${r.raw_points} / ${r.max_points}`} ·{' '}
                {r.author}
                {r.reason ? <p>{r.reason}</p> : null}
                {r.feedback ? <p>{r.feedback}</p> : null}
              </li>
            ))}
          </ol>
          {resultHistory.hasMore && historyAssignment ? (
            <button
              type="button"
              disabled={historyLoading}
              onClick={() => void showResultHistory(historyAssignment, resultHistory.offset + 30)}
            >
              Ещё история
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              historyGeneration.current++;
              setHistoryLoading(false);
              setResultHistory(null);
            }}
          >
            Закрыть историю
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Coordinator hook: SeatResults / student home can include this component.
 * The endpoint uses only the Seat cookie and exposes no classmates' data. */
export function StudentParticipantSummary({
  accountSeat,
}: { accountSeat?: { classroomId: string; seatId: string } } = {}): JSX.Element {
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const accountClassId = accountSeat?.classroomId;
  const accountSeatId = accountSeat?.seatId;
  const load = useCallback(async () => {
    const token = ++generation.current;
    setError(null);
    const r =
      accountClassId && accountSeatId
        ? await participantsApi.profile(accountClassId, accountSeatId)
        : await participantsApi.seatProfile();
    if (token !== generation.current) return;
    if (r.ok) setProfile(r.data);
    else {
      setProfile(null);
      setError(r.error.message);
    }
  }, [accountClassId, accountSeatId]);
  useEffect(() => {
    setProfile(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return (
    <section className="student-participant-summary" aria-label="Мои показатели">
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Повторить
          </button>
        </p>
      ) : null}
      {!profile && !error ? <p role="status">Загружаем показатели…</p> : null}
      {profile ? (
        <>
          <p>
            Всего работ: <strong>{profile.metrics.totalWorks}</strong> · в архиве{' '}
            {profile.metrics.archivedWorks}
          </p>
          <ParticipantRating metrics={profile.metrics} settings={profile.settings} />
          <SeatAwardRow keys={profile.builtinAwards.map((award) => award.awardKey)} />
          <ParticipantMeritsAndAvatars
            classroomId={accountSeat?.classroomId ?? ''}
            seatId={profile.metrics.seatId}
            profile={profile}
            onChanged={load}
            readOnly
            accountLearner={Boolean(accountSeat)}
          />
        </>
      ) : null}
    </section>
  );
}

export function ClassroomStaffProfile({
  classroomId,
  accountId,
  onClose,
}: {
  classroomId: string;
  accountId: string;
  onClose: () => void;
}): JSX.Element {
  const [data, setData] = useState<ParticipantStaff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    void participantsApi.staff(classroomId, accountId).then((r) => {
      if (!active) return;
      if (r.ok) setData(r.data);
      else setError(r.error.message);
    });
    return () => {
      active = false;
    };
  }, [classroomId, accountId, retry]);
  return (
    <section className="participant-staff-profile">
      <button type="button" onClick={onClose}>
        К преподавателям
      </button>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Повторить
          </button>
        </p>
      ) : !data ? (
        <p role="status">Загружаем профиль…</p>
      ) : (
        <>
          <header>
            {data.avatarUrl ? <img src={data.avatarUrl} alt="" width={64} height={64} /> : null}
            <h2>{data.name}</h2>
          </header>
          <p>Действующие роли в классах, доступных вам обоим.</p>
          <ul>
            {data.classes.map((c) => (
              <li key={`${c.id}:${c.role}`}>
                {c.title} ·{' '}
                {c.role === 'owner'
                  ? 'Основной преподаватель'
                  : c.role === 'co_teacher'
                    ? 'Коллега-преподаватель'
                    : c.role === 'school_admin'
                      ? 'Менеджер организации'
                      : 'Владелец организации'}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ClassroomParticipantManagers({
  classroomId,
  onOpen,
}: {
  classroomId: string;
  onOpen: (accountId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<Array<{
    accountId: string;
    name: string;
    role: string;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    void participantsApi.managers(classroomId).then((r) => {
      if (!active) return;
      if (r.ok) setItems(r.data);
      else setError(r.error.message);
    });
    return () => {
      active = false;
    };
  }, [classroomId, retry]);
  return (
    <section aria-label="Действующие менеджеры">
      <h3>Менеджеры организации</h3>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Повторить
          </button>
        </p>
      ) : null}
      {!items && !error ? <p role="status">Загружаем действующие роли…</p> : null}
      {items?.length === 0 ? <p>В этом классе нет действующих менеджеров организации.</p> : null}
      {items ? (
        <ul>
          {items.map((person) => (
            <li key={person.accountId}>
              <button
                type="button"
                className="participant-staff-name"
                onClick={() => onOpen(person.accountId)}
              >
                {person.name}
              </button>{' '}
              · {person.role === 'owner' ? 'Владелец организации' : 'Менеджер организации'}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
