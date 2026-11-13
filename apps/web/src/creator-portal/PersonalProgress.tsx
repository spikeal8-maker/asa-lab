import { useState } from 'react';
import type { OwnProgressGroupV1, ProgressMetricNameV1 } from '@asa-lab/contracts';
import { PortalLink } from '../components/PortalLink';
import {
  progressNumber,
  useOwnAvatar,
  type OwnProgressActor,
  type usePersonalProgress,
} from './personal-progress';
import './personal-progress.css';

type Progress = ReturnType<typeof usePersonalProgress>;
const metrics = [
  ['everPublishedWorks', 'Опубликованные работы'],
  ['currentLikes', 'Нравится'],
  ['createdCopies', 'Копии ваших работ'],
] as const;

function MetricIcon({ name }: { readonly name: ProgressMetricNameV1 }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'currentLikes' ? (
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      ) : name === 'createdCopies' ? (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V4H4v12h4" />
        </>
      ) : (
        <>
          <path d="m12 3 8 5v9l-8 4-8-4V8Z" />
          <path d="m4 8 8 5 8-5M12 13v8" />
        </>
      )}
    </svg>
  );
}

function OwnAvatar({
  src,
  fallback,
}: {
  readonly src: string;
  readonly fallback: string;
}): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  const displayed = failed === src ? fallback : src;
  return <img src={displayed} alt="" width="88" height="88" onError={() => setFailed(src)} />;
}

function OwnGroup({
  group,
  avatar,
}: {
  readonly group: OwnProgressGroupV1;
  readonly avatar: { readonly src: string; readonly fallback: string };
}): JSX.Element {
  const { own } = group;
  const score = own.score === null ? null : progressNumber(own.score);
  const rank = own.rank === null ? null : progressNumber(own.rank);
  const description = [
    'Вы',
    rank === null ? null : `${rank}-е место`,
    score === null ? null : `рейтинг ${score}`,
  ]
    .filter(Boolean)
    .join(', ');
  const unavailable =
    own.availability === 'unavailable'
      ? own.reason === 'ambiguous_self_participant'
        ? 'Учебный профиль нужно уточнить у преподавателя.'
        : 'Рейтинг сейчас недоступен.'
      : own.score === null && own.rank === null
        ? 'Рейтинг выключен'
        : null;
  return (
    <article
      className="personal-progress-group"
      data-testid="own-progress-group"
      data-group-id={group.groupId}
    >
      <header>
        <h3>{group.title}</h3>
        <span>{group.periodDays} дней</span>
      </header>
      <div className="personal-progress-group-body">
        <div className="personal-progress-self" role="img" aria-label={description}>
          <div className="personal-progress-group-avatar">
            <OwnAvatar {...avatar} />
            {rank !== null ? (
              <span
                className="personal-progress-rank"
                aria-hidden="true"
                data-testid="own-progress-rank"
              >
                {rank}
              </span>
            ) : null}
            {score !== null ? (
              <span
                className="personal-progress-score"
                aria-hidden="true"
                data-testid="own-progress-score"
              >
                {score}
              </span>
            ) : null}
          </div>
          <span className="personal-progress-you" aria-hidden="true">
            Вы
          </span>
        </div>
        <p className="personal-progress-group-note">{unavailable ?? 'Ваш результат за период'}</p>
      </div>
    </article>
  );
}

export function PersonalProgress({
  actor,
  progress,
  mode = 'home',
  onLearning,
}: {
  readonly actor: OwnProgressActor;
  readonly progress: Progress;
  readonly mode?: 'home' | 'learning';
  readonly onLearning?: () => void;
}): JSX.Element {
  const avatar = useOwnAvatar(actor, progress.lifetime);
  const { summary } = progress;
  const data = summary.data;
  const groups = mode === 'home' ? progress.groups.slice(0, 2) : progress.groups;
  if (!progress.lifetime.key)
    return (
      <section
        className="personal-progress personal-progress-pending"
        aria-label="Загрузка личного прогресса"
        aria-busy="true"
      >
        <span>Проверяем учебный контекст…</span>
      </section>
    );
  return (
    <section
      className="personal-progress"
      aria-label={mode === 'home' ? 'Мой прогресс' : 'Прогресс в группах'}
      data-testid="personal-progress"
    >
      {mode === 'home' ? (
        <div className="personal-progress-hero">
          <div className="personal-progress-hero-avatar">
            <OwnAvatar {...avatar} />
          </div>
          <div className="personal-progress-hero-copy">
            <h1>Мой прогресс</h1>
            <p className="personal-progress-person">{actor.displayName}</p>
            <dl
              className="personal-progress-metrics"
              aria-label="Показатели ваших работ"
              aria-busy={summary.loading}
            >
              {metrics.map(([name, label]) => {
                const metric = data?.metrics[name];
                const value =
                  metric?.availability === 'available' ? progressNumber(metric.value) : '—';
                return (
                  <div key={name} title={label} data-testid={`progress-${name}`}>
                    <dt>
                      <MetricIcon name={name} />
                      <span className="sr-only">{label}</span>
                    </dt>
                    <dd
                      aria-label={`${label}: ${value === '—' ? (summary.loading ? 'загрузка' : 'недоступно') : value}`}
                    >
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      ) : null}
      {summary.loading ? (
        <p className="personal-progress-state" role="status">
          Загружаем прогресс…
        </p>
      ) : null}
      {summary.error || data?.availability === 'unavailable' ? (
        <div className="personal-progress-state" role="alert">
          <span>
            {summary.error?.status === 403
              ? 'Прогресс сейчас недоступен в этом контексте.'
              : 'Не удалось загрузить прогресс.'}
          </span>
          <button className="btn-secondary" type="button" onClick={summary.reload}>
            Повторить загрузку прогресса
          </button>
        </div>
      ) : null}
      {data?.availability === 'partial' ? (
        <div className="personal-progress-state" role="status">
          <span>Часть прогресса сейчас недоступна. Доступные результаты сохранены.</span>
          <button className="btn-secondary" type="button" onClick={summary.reload}>
            Обновить прогресс
          </button>
        </div>
      ) : null}
      {mode === 'home' && data ? (
        <details className="personal-progress-explanation">
          <summary>О показателях</summary>
          <p>
            Работы учитываются по подтверждённым публикациям; новая версия не считается новой
            работой. «Нравится» — текущие отметки. Копии — подтверждённые добавления ваших работ к
            себе, включая уже удалённые копии.
          </p>
          <p>Общий рейтинг ещё не рассчитывается.</p>
          {data.metrics.activePublicWorks.availability === 'available' ? (
            <p>
              Сейчас в открытом каталоге: {progressNumber(data.metrics.activePublicWorks.value)}.
            </p>
          ) : null}
          {metrics.some(([name]) =>
            data.coverage[name].limitations.includes('history_before_canonical_records_unknown'),
          ) ? (
            <p>История до первых подтверждённых записей может быть неполной.</p>
          ) : null}
          {data.coverage.createdCopies.limitations.includes(
            'copies_not_supported_by_all_modules',
          ) ? (
            <p>Копирование поддерживают не все среды.</p>
          ) : null}
        </details>
      ) : null}
      {groups.length > 0 ? (
        <section className="personal-progress-groups" aria-label="Мои учебные группы">
          <div className="personal-progress-groups-heading">
            <h2>{mode === 'home' ? 'Мои группы' : 'Прогресс в группах'}</h2>
            {mode === 'home' ? (
              <PortalLink href="/#/learning" {...(onLearning ? { onNavigate: onLearning } : {})}>
                Все группы <span aria-hidden="true">→</span>
              </PortalLink>
            ) : (
              <a href="#/learning?view=results">Результаты и заслуги</a>
            )}
          </div>
          <div className="personal-progress-group-list">
            {groups.map((group) => (
              <OwnGroup key={group.groupId} group={group} avatar={avatar} />
            ))}
          </div>
          {mode === 'learning' && progress.hasMore ? (
            <div className="personal-progress-more">
              {progress.moreError ? (
                <p role="alert">
                  Не удалось загрузить следующие группы. Уже открытые группы сохранены.
                </p>
              ) : null}
              <button
                className="btn-secondary"
                type="button"
                disabled={progress.loadingMore}
                onClick={() => void progress.loadMore()}
              >
                {progress.loadingMore
                  ? 'Загружаем группы…'
                  : progress.moreError
                    ? 'Повторить загрузку групп'
                    : 'Показать ещё группы'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {data?.groups.availability === 'unavailable' && data.availability !== 'unavailable' ? (
        <p className="personal-progress-state">Учебные группы сейчас не загрузились.</p>
      ) : null}
      {mode === 'learning' && data?.groups.availability === 'available' && groups.length === 0 ? (
        <p className="personal-progress-state">
          Учебных групп пока нет. Можно присоединиться к группе в разделе «Классы».
        </p>
      ) : null}
    </section>
  );
}
