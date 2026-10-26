import { useEffect, useRef, useState } from 'react';
import { crmApi, type CrmSubject, type CrmDashboard } from './crm-user-api';
import './crm-user-dashboard.css';

const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString('ru-RU') : 'Не зафиксировано';
const modules: Record<string, string> = {
  electronics: 'Электроника',
  blocks: 'Scratch',
  'three-d': '3D',
  chess: 'Шахматы',
  checkers: 'Шашки',
  portal: 'Личный кабинет',
  ai: 'ИИ',
};
const actions: Record<string, string> = {
  'auth.login': 'Вход',
  'auth.register': 'Регистрация',
  'project.open': 'Открытие проекта',
  'project.created': 'Создание проекта',
  'project.saved': 'Сохранение проекта',
  'project.updated': 'Изменение проекта',
  'project.published': 'Публикация проекта',
  'module.open': 'Открытие редактора',
  'ai.request': 'Запрос к ИИ',
  'module.opened': 'Открытие редактора',
  'project.opened': 'Открытие проекта',
  'editor.opened': 'Открытие редактора',
  'session.started': 'Начало работы',
  'session.heartbeat': 'Работа в системе',
  'project.save': 'Сохранение проекта',
  'editor.save.succeeded': 'Сохранение проекта',
  'editor.save.failed': 'Ошибка сохранения',
};
function MiniChart({
  data,
  field,
  title,
}: {
  data: CrmDashboard['activity'];
  field: 'events' | 'aiRequests';
  title: string;
}) {
  const maximumValue = Math.max(0, ...data.map((d) => d[field]));
  const peak = Math.max(1, maximumValue);
  const [selected, setSelected] = useState(0);
  const activePoint = Math.min(selected, Math.max(0, data.length - 1));
  const width = 380,
    left = 28,
    right = 12,
    height = 116,
    bottom = 24;
  const x = (index: number) =>
    left + (index / Math.max(1, data.length - 1)) * (width - left - right);
  const y = (value: number) => height - bottom - (value / peak) * (height - bottom - 10);
  const indexes = [
    ...new Set(data.length ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : []),
  ].filter((i) => i >= 0);
  return (
    <section className="crm-person-chart" aria-label={title}>
      <header>
        <h4>{title}</h4>
        <strong>{data.reduce((sum, day) => sum + day[field], 0).toLocaleString('ru-RU')}</strong>
      </header>
      <div className="crm-person-scale">
        <span>{field === 'events' ? 'События за день' : 'Запросы за день'}</span>
        <span>0 — {maximumValue.toLocaleString('ru-RU')}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title} по дням UTC за 30 дней`}
      >
        <line
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
          className="crm-person-grid"
        />
        <polyline
          points={data.map((day, i) => `${x(i)},${y(day[field])}`).join(' ')}
          className={`crm-person-line crm-person-line-${field}`}
        />
        {data.map((day, i) => (
          <circle
            key={day.date}
            cx={x(i)}
            cy={y(day[field])}
            r="2.5"
            tabIndex={i === activePoint ? 0 : -1}
            onFocus={() => setSelected(i)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? Math.min(i + 1, data.length - 1)
                  : event.key === 'ArrowLeft'
                    ? Math.max(0, i - 1)
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? data.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setSelected(next);
              event.currentTarget.ownerSVGElement
                ?.querySelectorAll<SVGCircleElement>('circle')
                [next]?.focus?.();
            }}
            aria-label={`${day.date} UTC: ${day[field]}`}
          >
            <title>
              {day.date} UTC: {day[field]}
            </title>
          </circle>
        ))}
      </svg>
      <div className="crm-person-dates" aria-label="Даты UTC">
        {indexes.map((i) => (
          <span key={i}>{data[i]!.date.slice(5).split('-').reverse().join('.')}</span>
        ))}
      </div>
      {!data.some((day) => day[field] > 0) ? (
        <small>За период событий не зафиксировано</small>
      ) : null}
    </section>
  );
}
export function CrmUserDashboard({
  subject,
  onAccessDenied,
}: {
  subject: CrmSubject;
  onAccessDenied: () => void;
}) {
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  const key = `${subject.kind}:${subject.targetId}:${subject.classroomId ?? ''}`;
  const [state, setState] = useState<{ key: string; value?: CrmDashboard; error?: string }>({
    key,
  });
  const [reload, refresh] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ key });
    void crmApi
      .dashboard(subject)
      .then((result) => {
        if (!alive) return;
        if (!result.ok) {
          setState({ key, error: 'Не удалось загрузить сводку пользователя.' });
          if (result.status === 401 || result.status === 403) denied.current();
        } else setState({ key, value: result.data });
      })
      .catch(() => {
        if (alive) setState({ key, error: 'Не удалось загрузить сводку пользователя.' });
      });
    return () => {
      alive = false;
    };
  }, [key, reload]);
  const value = state.key === key ? state.value : undefined;
  if (state.key === key && state.error)
    return (
      <div className="crm-person-state" role="alert">
        {state.error}{' '}
        <button type="button" onClick={() => refresh((n) => n + 1)}>
          Повторить
        </button>
      </div>
    );
  if (!value) return <p role="status">Загружаем сводку пользователя…</p>;
  return (
    <section className="crm-person-dashboard" aria-label="Обзор пользователя">
      <div className="crm-person-presence">
        <div>
          <span>Последняя связь</span>
          <strong>{stamp(value.lastSeenAt)}</strong>
        </div>
        <div>
          <span>Последнее действие</span>
          <strong>{stamp(value.lastActionAt)}</strong>
        </div>
      </div>
      <dl className="crm-person-kpis">
        <div>
          <dt>Проекты</dt>
          <dd>{value.totals.projects}</dd>
        </div>
        <div>
          <dt>Публикации в истории</dt>
          <dd>{value.totals.publications}</dd>
        </div>
        <div>
          <dt>Запросы ИИ · 30 дней</dt>
          <dd>{value.totals.aiRequests}</dd>
        </div>
        <div>
          <dt>Ошибки ИИ · 30 дней</dt>
          <dd>{value.totals.aiErrors}</dd>
        </div>
      </dl>
      <div className="crm-person-charts">
        <MiniChart data={value.activity} field="events" title="Активность" />
        <MiniChart data={value.activity} field="aiRequests" title="Использование ИИ" />
      </div>
      <div className="crm-person-bottom">
        <section className="crm-person-actions">
          <h4>Последние действия</h4>
          {value.latestActions.length ? (
            <ol>
              {value.latestActions.map((item, i) => (
                <li key={`${item.occurredAt}:${i}`}>
                  <span>
                    {actions[item.eventType] ?? 'Действие в системе'}
                    {item.module ? ` · ${modules[item.module] ?? item.module}` : ''}
                    <small>{stamp(item.occurredAt)}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>Действия пока не зафиксированы.</p>
          )}
        </section>
        <section className="crm-person-rating">
          <h4>Рейтинг</h4>
          <strong>
            {value.rating.value === null
              ? value.rating.kind === 'classroom'
                ? 'Нет данных'
                : 'Не настроен'
              : value.rating.value.toLocaleString('ru-RU')}
          </strong>
          <p>{value.rating.label}</p>
          {value.rating.rank !== null ? (
            <p>
              Место в классе: {value.rating.rank}
              {value.rating.periodDays !== null ? ` · ${value.rating.periodDays} дней` : ''}
            </p>
          ) : null}
          <small>Бонусы ИИ автоматически не начисляются.</small>
        </section>
      </div>
      <details className="crm-person-coverage">
        <summary>О данных сводки</summary>
        <p>
          Дневные графики за 30 дней, время UTC. Учтены только сохранённые события
          {value.coverage.activityFrom ? ` начиная с ${stamp(value.coverage.activityFrom)}` : ''};
          отсутствие события не доказывает отсутствие действия. Проекты и публикации — все
          сохранившиеся, запросы и ошибки ИИ — за 30 дней. Токены ИИ: входящие{' '}
          {value.totals.inputTokens ?? 'неизвестно'}, исходящие{' '}
          {value.totals.outputTokens ?? 'неизвестно'}; подтверждены для{' '}
          {value.coverage.tokenRequests} запросов.
        </p>
      </details>
    </section>
  );
}
