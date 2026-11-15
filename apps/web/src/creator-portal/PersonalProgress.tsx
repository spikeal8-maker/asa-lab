import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  OwnProgressGroupV1,
  ProgressMetricNameV1,
  GroupRatingPeerV1,
} from '@asa-lab/contracts';
import { PortalLink } from '../components/PortalLink';
import {
  progressNumber,
  groupRatingPreviewLimit,
  useGroupRatingPreview,
  useGroupRatingFull,
  useOwnAvatar,
  type OwnProgressActor,
  type ProgressLifetime,
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

function PeerAvatar({
  peer,
  image,
}: {
  readonly peer: GroupRatingPeerV1;
  readonly image: string | null;
}): JSX.Element {
  const chosen = image ?? peer.avatarSrc;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = failedSrc === chosen ? peer.avatarSrc : chosen;
  const rank = peer.rank === null ? null : progressNumber(peer.rank);
  const score = peer.score === null ? null : progressNumber(peer.score);
  const description = [
    rank === null ? 'Место неизвестно' : `Место ${rank}`,
    score === null ? 'балл недоступен' : `балл ${score}`,
  ].join(', ');
  return (
    <div className="personal-progress-peer" role="img" aria-label={description}>
      <div className="personal-progress-peer-avatar">
        <img src={src} alt="" width="52" height="52" onError={() => setFailedSrc(chosen)} />
        {rank !== null ? (
          <span className="personal-progress-rank" aria-hidden="true">
            {rank}
          </span>
        ) : null}
        {score !== null ? (
          <span className="personal-progress-score" aria-hidden="true">
            {score}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GroupRatingDialog({
  title,
  full,
  ownAvatar,
  onClose,
}: {
  readonly title: string;
  readonly full: ReturnType<typeof useGroupRatingFull>;
  readonly ownAvatar: { readonly src: string; readonly fallback: string };
  readonly onClose: () => void;
}): JSX.Element | null {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (full.opened) closeButton.current?.focus();
  }, [full.opened]);
  if (!full.opened) return null;
  const state = full.state;
  const own = state?.page?.own;
  const ownRank = own?.rank === null || own?.rank === undefined ? null : progressNumber(own.rank);
  const ownScore =
    own?.score === null || own?.score === undefined ? null : progressNumber(own.score);
  return (
    <div
      className="personal-progress-rating-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        ref={dialog}
        className="personal-progress-rating-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Рейтинг группы ${title}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === 'Tab') {
            const available = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'a[href],area[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
              ) ?? []),
            ].filter(
              (node) =>
                node.tabIndex >= 0 &&
                node.getAttribute('aria-disabled') !== 'true' &&
                !node.closest('[hidden],[inert]') &&
                getComputedStyle(node).visibility !== 'hidden' &&
                getComputedStyle(node).display !== 'none',
            );
            if (available.length === 0) return;
            const first = available[0]!;
            const last = available[available.length - 1]!;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="personal-progress-rating-title">
          <h3>{title}</h3>
          <span>{state?.page?.periodDays ?? '—'} дней</span>
          <button ref={closeButton} type="button" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <div className="personal-progress-rating-body">
          <div className="personal-progress-rating-pinned">
            <div
              className="personal-progress-self"
              role="img"
              aria-label={[
                'Вы',
                ownRank === null ? 'место недоступно' : `место ${ownRank}`,
                ownScore === null ? 'балл недоступен' : `балл ${ownScore}`,
              ].join(', ')}
            >
              <div className="personal-progress-group-avatar">
                <OwnAvatar {...ownAvatar} />
                {ownRank !== null ? (
                  <span className="personal-progress-rank" aria-hidden="true">
                    {ownRank}
                  </span>
                ) : null}
                {ownScore !== null ? (
                  <span className="personal-progress-score" aria-hidden="true">
                    {ownScore}
                  </span>
                ) : null}
              </div>
              <span className="personal-progress-you" aria-hidden="true">
                Вы
              </span>
            </div>
          </div>
          <div className="personal-progress-rating-scroll">
            {state?.restarted ? (
              <p role="status">Рейтинг обновился. Показана новая последовательная выдача.</p>
            ) : null}
            <div className="personal-progress-rating-items" aria-label="Участники группы по местам">
              {state?.peers.map((peer) => (
                <PeerAvatar
                  key={peer.peerKey}
                  peer={peer}
                  image={peer.avatarTicket ? (state.images[peer.avatarTicket] ?? null) : null}
                />
              ))}
            </div>
            {state?.loading ? <p role="status">Загружаем рейтинг…</p> : null}
            {state && !state.loading && state.peers.length === 0 && !state.error ? (
              <p>Других участников нет.</p>
            ) : null}
            {state?.error ? (
              <p role="alert">
                {state.error}{' '}
                <button type="button" onClick={full.retry}>
                  Повторить
                </button>
              </p>
            ) : null}
            {state?.nextCursor ? (
              <button
                type="button"
                className="btn-secondary personal-progress-rating-next"
                disabled={state.loading}
                onClick={full.loadMore}
              >
                Показать ещё
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnGroup({
  group,
  avatar,
  actor,
  lifetime,
}: {
  readonly group: OwnProgressGroupV1;
  readonly avatar: { readonly src: string; readonly fallback: string };
  readonly actor: OwnProgressActor;
  readonly lifetime: ProgressLifetime;
}): JSX.Element {
  const article = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [limit, setLimit] = useState(() =>
    typeof window === 'undefined' ? 2 : groupRatingPreviewLimit(window.innerWidth),
  );
  useLayoutEffect(() => {
    const update = () => {
      const width = article.current?.getBoundingClientRect().width || window.innerWidth;
      setLimit(groupRatingPreviewLimit(width));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    if (article.current) observer.observe(article.current);
    return () => observer.disconnect();
  }, []);
  const preview = useGroupRatingPreview(actor, lifetime, group.groupId, limit);
  const full = useGroupRatingFull(actor, lifetime, group.groupId);
  const own = preview.rating.data?.own ?? group.own;
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
      ? 'reason' in own && own.reason === 'ambiguous_self_participant'
        ? 'Учебный профиль нужно уточнить у преподавателя.'
        : 'reason' in own && own.reason === 'rating_disabled'
          ? 'Рейтинг выключен'
          : 'Рейтинг сейчас недоступен.'
      : own.score === null && own.rank === null
        ? 'Рейтинг выключен'
        : null;
  const peers = preview.rating.data?.peers ?? [];
  const close = () => {
    full.close();
    if (lifetime.key && lifetime.current() === lifetime.key) opener.current?.focus();
  };
  return (
    <article
      ref={article}
      className="personal-progress-group"
      data-testid="own-progress-group"
      data-group-id={group.groupId}
    >
      <header>
        <h3>{group.title}</h3>
        <span>{group.periodDays} дней</span>
        <button
          ref={opener}
          type="button"
          className="personal-progress-all"
          onClick={full.open}
          disabled={
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              group.groupId,
            )
          }
        >
          Все
        </button>
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
        {preview.rating.data && !unavailable ? (
          <>
            <div className="personal-progress-peer-divider" aria-hidden="true" />
            <div className="personal-progress-peers" aria-label="Места других участников">
              {peers.map((peer) => (
                <PeerAvatar
                  key={peer.peerKey}
                  peer={peer}
                  image={
                    peer.avatarTicket ? (preview.imageMap.get(peer.avatarTicket) ?? null) : null
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <p className="personal-progress-group-note">
            {unavailable ??
              (preview.rating.error
                ? 'Не удалось загрузить участников.'
                : preview.rating.loading
                  ? 'Загружаем участников…'
                  : 'Ваш результат за период')}
          </p>
        )}
      </div>
      {preview.rating.error && !preview.rating.loading && !unavailable ? (
        <button
          className="btn-secondary personal-progress-group-retry"
          type="button"
          onClick={preview.rating.reload}
        >
          Повторить загрузку участников
        </button>
      ) : null}
      {preview.avatars.error ? (
        <p className="personal-progress-group-note">Некоторые аватары недоступны.</p>
      ) : null}
      <GroupRatingDialog title={group.title} full={full} ownAvatar={avatar} onClose={close} />
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
              <OwnGroup
                key={group.groupId}
                group={group}
                avatar={avatar}
                actor={actor}
                lifetime={progress.lifetime}
              />
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
