import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttendedClass, ClassroomStudentSession, LearnerResult } from '../api';
import { api } from '../api';
import {
  journalApi,
  journalMonthRange,
  journalRevisionLabel,
  journalShiftMonth,
  type JournalResult,
  type JournalResultsPage,
} from '../classroom-journal-api';
import {
  PARTICIPANT_FACTORS,
  participantsApi,
  type ParticipantProfile,
} from '../classroom-participants-api';
import {
  learnerGrantedMerits,
  learnerJournalItems,
  learnerRankLabel,
  learnerResultLabel,
  learnerScoreLabel,
} from '../learning/learner-achievements-model';
import { onSessionLoggedOut } from '../session-fetch';
import { canonicalLearningLabel } from '../learning/canonical-learning-presentation';
import { seatAvatar } from '../creator-portal/default-avatars';
import { awardOf } from './SeatAwards';
import { useSchoolTime } from './school-time';
import './learner-achievements.css';

export type AchievementSection = 'overview' | 'grades' | 'awards';

interface LearnerClass {
  classroomId: string;
  seatId: string;
  classroomTitle: string;
  teacherDisplayName: string;
  unfinishedCount: number | null;
}

const FACTOR_NAMES: Record<(typeof PARTICIPANT_FACTORS)[number], string> = {
  projects: 'Новые проекты',
  logins: 'Дни со входом',
  days: 'Активные дни',
  time: 'Время работы',
  grades: 'Результаты оценивания',
};

function LearnerClassCard({
  entry,
  seatSession,
  selected,
  refresh,
  onSelect,
  onLoaded,
}: {
  entry: LearnerClass;
  seatSession: boolean;
  selected: boolean;
  refresh: number;
  onSelect: () => void;
  onLoaded: (seatId: string, profile: ParticipantProfile) => void;
}) {
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setProfile(null);
    setError('');
    const read = seatSession
      ? participantsApi.seatProfile()
      : participantsApi.profile(entry.classroomId, entry.seatId);
    void read
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setProfile(result.data);
        onLoaded(entry.seatId, result.data);
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить рейтинг.');
      });
    const unsubscribe = onSessionLoggedOut(() => {
      active = false;
      setProfile(null);
      setError('Сеанс завершён.');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [entry.classroomId, entry.seatId, onLoaded, refresh, seatSession]);

  const score = profile?.metrics.score;
  return (
    <li className="learner-class-item">
      <button
        type="button"
        className={'learner-class-card' + (selected ? ' is-selected' : '')}
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span className="learner-class-card-top">
          <span className="learner-class-name">
            <strong>{entry.classroomTitle}</strong>
            <small>Преподаватель: {entry.teacherDisplayName}</small>
          </span>
          <span className="learner-class-rank">
            <b>{learnerRankLabel(profile ?? undefined)}</b>
            <small>место</small>
          </span>
        </span>
        {error ? (
          <span className="learner-class-error">{error}</span>
        ) : profile ? (
          <>
            <span className="learner-class-scoreline">
              <span>{score === null ? 'Рейтинг не включён' : 'Рейтинг класса'}</span>
              <strong>
                {learnerScoreLabel(profile)}
                {score === null ? '' : ' / 100'}
              </strong>
            </span>
            <span
              className="learner-class-track"
              role="meter"
              aria-label={'Баллы рейтинга класса ' + entry.classroomTitle}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={score === null ? undefined : score}
              aria-valuetext={
                score === null ? 'Рейтинг отключён' : learnerScoreLabel(profile) + ' из 100'
              }
            >
              <span style={{ width: String(Math.max(0, Math.min(score ?? 0, 100))) + '%' }} />
            </span>
            <span className="learner-class-foot">
              <span>За {profile.settings.periodDays} дней</span>
              <span>
                Сдано: {profile.submittedCount} · На проверке: {profile.awaitingReview}
              </span>
            </span>
          </>
        ) : (
          <span className="learner-class-loading" role="status">
            Загрузка рейтинга…
          </span>
        )}
      </button>
    </li>
  );
}

type TimelineItem =
  | { kind: 'journal'; id: string; sortDate: string; item: JournalResult }
  | { kind: 'result'; id: string; sortDate: string; item: LearnerResult };

export function LearnerAchievementsDashboard({
  seat,
  section,
  onGrades,
  onAwards,
  onLearning,
}: {
  seat: ClassroomStudentSession | null;
  section: AchievementSection;
  onGrades: () => void;
  onAwards: () => void;
  onLearning: () => void;
}): JSX.Element {
  const time = useSchoolTime();
  const identity = seat ? 'seat:' + seat.student.seatId + ':' + seat.expiresAt : 'account';
  const [classes, setClasses] = useState<LearnerClass[]>([]);
  const [classLoading, setClassLoading] = useState(true);
  const [classesError, setClassesError] = useState('');
  const [profiles, setProfiles] = useState<Record<string, ParticipantProfile>>({});
  const [classLimit, setClassLimit] = useState(6);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [results, setResults] = useState<LearnerResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [resultsError, setResultsError] = useState('');
  const [month, setMonth] = useState('');
  const [offset, setOffset] = useState(0);
  const [journal, setJournal] = useState<JournalResultsPage | null>(null);
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalError, setJournalError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<{
    id: string;
    revisions: Array<{ id: string; revision: number; value: number | null; reason: string | null }>;
    preset: JournalResult['preset'];
    error: string;
  } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyGeneration = useRef(0);

  const loadedProfile = useCallback((seatId: string, profile: ParticipantProfile) => {
    setProfiles((old) => ({ ...old, [seatId]: profile }));
  }, []);

  useEffect(() => {
    let active = true;
    setProfiles({});
    setClassLimit(6);
    setSelectedClassId(null);
    setMonth('');
    setOffset(0);
    setHistory(null);
    setClassLoading(true);
    setClassesError('');
    setClasses([]);
    const load = async () => {
      if (seat) {
        if (active) {
          setClasses([
            {
              classroomId: seat.classroom.id,
              seatId: seat.student.seatId,
              classroomTitle: seat.classroom.title,
              teacherDisplayName: seat.classroom.teacherDisplayName,
              unfinishedCount: null,
            },
          ]);
          setClassLoading(false);
        }
        return;
      }
      const result = await api.attendedClasses();
      if (!active) return;
      setClassLoading(false);
      if (!result.ok) {
        setClassesError(result.error.message);
        return;
      }
      setClasses(
        result.data.items.map((entry: AttendedClass) => ({
          classroomId: entry.classroomId,
          seatId: entry.seatId,
          classroomTitle: entry.classroomTitle,
          teacherDisplayName: entry.teacherDisplayName,
          unfinishedCount: entry.unfinishedCount,
        })),
      );
    };
    void load().catch(() => {
      if (active) {
        setClassLoading(false);
        setClassesError('Не удалось загрузить классы.');
      }
    });
    const unsubscribe = onSessionLoggedOut(() => {
      active = false;
      setClasses([]);
      setProfiles({});
      setClassesError('Учебный сеанс завершён. Войдите снова.');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [identity, refresh]);

  useEffect(() => {
    let active = true;
    setResultsLoading(true);
    setResultsError('');
    setResults([]);
    const read = seat ? api.seatResults() : api.accountResults();
    void read
      .then((result) => {
        if (!active) return;
        setResultsLoading(false);
        if (result.ok) setResults(result.data.items);
        else setResultsError(result.error.message);
      })
      .catch(() => {
        if (!active) return;
        setResultsLoading(false);
        setResultsError('Не удалось загрузить результаты заданий.');
      });
    const unsubscribe = onSessionLoggedOut(() => {
      active = false;
      setResults([]);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [identity, refresh]);

  useEffect(() => {
    let active = true;
    setJournal(null);
    setJournalError('');
    setJournalLoading(true);
    void journalApi
      .results(seat ? 'seat' : 'account', {
        ...(month ? journalMonthRange(month) : {}),
        offset,
      })
      .then((result) => {
        if (!active) return;
        setJournalLoading(false);
        if (result.ok) setJournal(result.data);
        else setJournalError(result.error.message);
      })
      .catch(() => {
        if (!active) return;
        setJournalLoading(false);
        setJournalError('Не удалось загрузить оценки журнала.');
      });
    const unsubscribe = onSessionLoggedOut(() => {
      active = false;
      setJournal(null);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [identity, month, offset, refresh, seat !== null]);

  const shownMonth = month || journal?.range.from.slice(0, 7) || '';
  const visibleClasses = classes.slice(0, classLimit);
  const focusClass = classes.find((entry) => entry.classroomId === selectedClassId) ?? classes[0];
  const focusProfile = focusClass ? profiles[focusClass.seatId] : undefined;
  const filteredJournal = learnerJournalItems(
    journal?.items ?? [],
    section === 'overview' ? null : selectedClassId,
  );
  const timeline = useMemo<TimelineItem[]>(() => {
    const entries: TimelineItem[] = filteredJournal.map((item) => ({
      kind: 'journal',
      id: 'journal:' + item.id,
      sortDate: item.date + 'T12:00:00Z',
      item,
    }));
    // Legacy result DTO has the class title but no immutable class ID. Never
    // filter it by title: two schools may have same-named classes.
    if (section !== 'grades' || selectedClassId === null || seat !== null) {
      for (const item of results) {
        if (section === 'grades' && shownMonth && !item.publishedAt.startsWith(shownMonth))
          continue;
        entries.push({
          kind: 'result',
          id: 'result:' + item.assignmentId,
          sortDate: item.publishedAt,
          item,
        });
      }
    }
    return entries.sort(
      (left, right) =>
        right.sortDate.localeCompare(left.sortDate) || left.id.localeCompare(right.id),
    );
  }, [filteredJournal, results, section, selectedClassId, seat, shownMonth]);
  const shownTimeline = section === 'overview' ? timeline.slice(0, 4) : timeline;
  const shownAwards = visibleClasses.flatMap((entry) => {
    if (section === 'awards' && selectedClassId && selectedClassId !== entry.classroomId) return [];
    const profile = profiles[entry.seatId];
    if (!profile) return [];
    return [
      ...profile.builtinAwards.map((award) => ({
        id: entry.seatId + ':builtin:' + award.awardKey,
        title: awardOf(award.awardKey)?.label ?? award.awardKey,
        symbol: awardOf(award.awardKey)?.glyph ?? '★',
        description: award.note,
        source: entry.classroomTitle,
        awardedBy: award.awardedBy,
      })),
      ...learnerGrantedMerits(profile).map((merit) => ({
        id: entry.seatId + ':custom:' + merit.id,
        title: merit.title,
        symbol: '✦',
        description: merit.description,
        source: entry.classroomTitle,
        awardedBy: '',
      })),
    ];
  });

  async function showHistory(item: JournalResult): Promise<void> {
    const request = ++historyGeneration.current;
    setHistory(null);
    setHistoryBusy(true);
    const read = seat
      ? participantsApi.seatHistory(item.columnId)
      : participantsApi.history(item.classroomId, item.seatId, item.columnId);
    try {
      const result = await read;
      if (request !== historyGeneration.current) return;
      setHistory({
        id: item.id,
        revisions: result.ok ? result.data.items : [],
        preset: result.ok ? result.data.preset : item.preset,
        error: result.ok ? '' : result.error.message,
      });
    } catch {
      if (request !== historyGeneration.current) return;
      setHistory({
        id: item.id,
        revisions: [],
        preset: item.preset,
        error: 'Не удалось загрузить историю.',
      });
    } finally {
      if (request === historyGeneration.current) setHistoryBusy(false);
    }
  }

  return (
    <div className="learner-achievements" data-testid="learner-achievements">
      {section === 'overview' ? (
        <section className="learner-achievements-hero" aria-labelledby="learner-achievements-title">
          <div className="learner-achievements-hero-content">
            <span className="learner-achievements-eyebrow">Личный учебный профиль</span>
            <h2 id="learner-achievements-title">Мои достижения</h2>
            <p>Рейтинги классов, реальные оценки, выполненные работы и награды — в одном месте.</p>
            <div className="learner-achievements-hero-actions">
              <a href="#/my-projects" className="btn-secondary">
                Мои работы <span aria-hidden="true">↗</span>
              </a>
              <button type="button" onClick={onLearning}>
                Продолжить обучение <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
          <div className="learner-achievements-emblem" aria-hidden="true">
            {seat ? (
              <img src={seatAvatar(seat.student.seatId, seat.student.avatarKey).src} alt="" />
            ) : (
              '✦'
            )}
          </div>
        </section>
      ) : (
        <div className="learner-achievements-section-head">
          <div>
            <h2>{section === 'grades' ? 'Мои оценки' : 'Мои награды'}</h2>
            <p>
              {section === 'grades'
                ? 'По занятиям и заданиям, с историей исправлений.'
                : 'Награды, выданные преподавателями, по каждому классу.'}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setRefresh((current) => current + 1)}
          >
            Обновить
          </button>
        </div>
      )}

      {section === 'overview' ? (
        <div className="learner-achievements-stats" aria-label="Сводные показатели">
          <div className="learner-stat">
            <span>Классы</span>
            <strong>{classLoading ? '…' : classes.length}</strong>
            <small>В моём обучении</small>
          </div>
          <div className="learner-stat">
            <span>Результаты</span>
            <strong>{resultsLoading ? '…' : results.length}</strong>
            <small>Опубликовано</small>
          </div>
          <div className="learner-stat">
            <span>Работы</span>
            <strong>{focusProfile ? focusProfile.metrics.totalWorks : '—'}</strong>
            <small>{focusClass ? 'Проекты моего профиля' : 'Выберите класс'}</small>
          </div>
          <div className="learner-stat">
            <span>Награды</span>
            <strong>{Object.keys(profiles).length === 0 ? '—' : shownAwards.length}</strong>
            <small>В загруженных классах</small>
          </div>
        </div>
      ) : null}

      <section
        className="learner-achievements-panel"
        aria-labelledby="learner-achievements-ratings"
      >
        <div className="learner-achievements-panel-head">
          <div>
            <h3 id="learner-achievements-ratings">Рейтинг по классам</h3>
            <p>
              У каждого класса собственные правила и период. Баллы между классами не суммируются.
            </p>
          </div>
          {section === 'overview' ? (
            <button
              type="button"
              className="learner-text-button"
              onClick={() => setRefresh((current) => current + 1)}
            >
              Обновить
            </button>
          ) : null}
        </div>
        {classesError ? (
          <p className="learner-achievements-alert" role="alert">
            {classesError}{' '}
            <button type="button" onClick={() => setRefresh((current) => current + 1)}>
              Повторить
            </button>
          </p>
        ) : null}
        {classLoading ? (
          <p role="status" className="learner-achievements-muted">
            Загружаем ваши классы…
          </p>
        ) : null}
        {!classLoading && !classesError && classes.length === 0 ? (
          <p className="learner-achievements-empty">
            Вы пока не состоите в учебных классах. Присоединитесь к классу преподавателя, чтобы
            увидеть результаты.
          </p>
        ) : null}
        {classes.length ? (
          <ul className="learner-achievements-classes">
            {visibleClasses.map((entry) => (
              <LearnerClassCard
                key={entry.seatId}
                entry={entry}
                seatSession={seat !== null}
                selected={focusClass?.seatId === entry.seatId}
                refresh={refresh}
                onSelect={() => setSelectedClassId(entry.classroomId)}
                onLoaded={loadedProfile}
              />
            ))}
          </ul>
        ) : null}
        {classLimit < classes.length ? (
          <button
            type="button"
            className="btn-secondary learner-achievements-more"
            onClick={() => setClassLimit((current) => current + 6)}
          >
            Показать ещё классы ({classes.length - classLimit})
          </button>
        ) : null}
        {focusProfile && section === 'overview' && focusProfile.metrics.score !== null ? (
          <div className="learner-achievements-factors">
            <div className="learner-achievements-panel-head">
              <div>
                <h4>Из чего складываются баллы</h4>
                <p>
                  {focusClass.classroomTitle} · {focusProfile.settings.periodDays} дней
                </p>
              </div>
            </div>
            <div className="learner-achievements-factor-grid">
              {PARTICIPANT_FACTORS.filter((key) => focusProfile.settings.factors[key]).map(
                (key) => (
                  <div className="learner-factor" key={key}>
                    <span>{FACTOR_NAMES[key]}</span>
                    <strong>{Math.round(focusProfile.metrics.factors[key] * 10) / 10} / 100</strong>
                    <span className="learner-factor-track">
                      <span
                        style={{
                          width:
                            Math.max(0, Math.min(focusProfile.metrics.factors[key], 100)) + '%',
                        }}
                      />
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        ) : null}
        {section === 'overview' ? (
          <p className="learner-achievements-footnote">
            Общешкольное место пока не рассчитывается: для него нужна единая методика рейтинга и
            разрешённая школьная область сравнения.
          </p>
        ) : null}
      </section>

      {section !== 'awards' ? (
        <section
          className="learner-achievements-panel"
          aria-labelledby="learner-achievements-marks"
        >
          <div className="learner-achievements-panel-head">
            <div>
              <h3 id="learner-achievements-marks">
                {section === 'overview' ? 'Последние оценки' : 'История оценок'}
              </h3>
              <p>Оценки журнала и опубликованные результаты заданий.</p>
            </div>
            {section === 'overview' ? (
              <button type="button" className="learner-text-button" onClick={onGrades}>
                Все оценки →
              </button>
            ) : null}
          </div>
          {section === 'grades' ? (
            <div className="learner-achievements-filters">
              <label>
                Класс
                <select
                  value={selectedClassId ?? ''}
                  onChange={(event) => {
                    setSelectedClassId(event.target.value || null);
                    historyGeneration.current++;
                    setHistoryBusy(false);
                    setHistory(null);
                  }}
                >
                  <option value="">Все мои классы</option>
                  {classes.map((entry) => (
                    <option key={entry.seatId} value={entry.classroomId}>
                      {entry.classroomTitle} — {entry.teacherDisplayName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="learner-achievements-month">
                <span>Месяц</span>
                <div>
                  <button
                    type="button"
                    aria-label="Предыдущий месяц"
                    disabled={!shownMonth || journalLoading}
                    onClick={() => {
                      setMonth(journalShiftMonth(shownMonth, -1));
                      setOffset(0);
                    }}
                  >
                    ‹
                  </button>
                  <input
                    type="month"
                    aria-label="Месяц оценок"
                    min="2000-01"
                    max="2100-12"
                    value={shownMonth}
                    onChange={(event) => {
                      if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(event.target.value)) {
                        setMonth(event.target.value);
                        setOffset(0);
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Следующий месяц"
                    disabled={!shownMonth || journalLoading}
                    onClick={() => {
                      setMonth(journalShiftMonth(shownMonth, 1));
                      setOffset(0);
                    }}
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {resultsError ? (
            <p className="learner-achievements-alert" role="alert">
              {resultsError}
            </p>
          ) : null}
          {journalError ? (
            <p className="learner-achievements-alert" role="alert">
              {journalError}
            </p>
          ) : null}
          {journalLoading || resultsLoading ? (
            <p className="learner-achievements-muted" role="status">
              Загружаем оценки…
            </p>
          ) : null}
          {!journalLoading &&
          !resultsLoading &&
          timeline.length === 0 &&
          !journalError &&
          !resultsError ? (
            <p className="learner-achievements-empty">
              За выбранный период опубликованных оценок нет. Можно выбрать другой месяц.
            </p>
          ) : null}
          {shownTimeline.length ? (
            <ol className="learner-achievements-grade-list">
              {shownTimeline.map((entry) =>
                entry.kind === 'journal' ? (
                  <li key={entry.id} className="learner-grade-row">
                    <span className="learner-grade-mark">
                      {journalRevisionLabel(entry.item.preset, entry.item.value)}
                    </span>
                    <div className="learner-grade-info">
                      <strong>{entry.item.category}</strong>
                      <span>
                        {entry.item.classroomTitle} ·{' '}
                        {entry.item.date.split('-').reverse().join('.')}
                      </span>
                      <small>
                        {entry.item.authorName} ·{' '}
                        {entry.item.revision > 1 ? 'Оценка исправлена' : 'Оценка журнала'}
                      </small>
                      {entry.item.reason ? <p>{entry.item.reason}</p> : null}
                      {entry.item.revision > 1 ? (
                        <button
                          type="button"
                          className="learner-text-button"
                          disabled={historyBusy}
                          onClick={() => void showHistory(entry.item)}
                        >
                          История изменений
                        </button>
                      ) : null}
                      {history?.id === entry.item.id ? (
                        <div className="learner-grade-history">
                          {history.error ? (
                            <p role="alert">{history.error}</p>
                          ) : (
                            <ol>
                              {history.revisions.map((revision) => (
                                <li key={revision.id}>
                                  Версия {revision.revision}:{' '}
                                  {journalRevisionLabel(history.preset, revision.value)}
                                  {revision.reason ? ' · ' + revision.reason : ''}
                                </li>
                              ))}
                            </ol>
                          )}
                          <button
                            type="button"
                            className="learner-text-button"
                            onClick={() => setHistory(null)}
                          >
                            Свернуть
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <span className="learner-grade-kind">Журнал</span>
                  </li>
                ) : (
                  <li key={entry.id} className="learner-grade-row">
                    <span className="learner-grade-mark is-result">
                      {learnerResultLabel(entry.item)}
                    </span>
                    <div className="learner-grade-info">
                      <strong>{entry.item.assignmentTitle}</strong>
                      <span>
                        {entry.item.classroomTitle} · {time.date(entry.item.publishedAt)}
                      </span>
                      <small>
                        Результат задания · попытка {entry.item.attemptNumber}
                        {entry.item.canonicalState
                          ? ' · ' + canonicalLearningLabel(entry.item.canonicalState)
                          : ''}
                      </small>
                      {entry.item.feedback ? <p>{entry.item.feedback}</p> : null}
                    </div>
                    <span className="learner-grade-kind">Задание</span>
                  </li>
                ),
              )}
            </ol>
          ) : null}
          {section === 'grades' && selectedClassId && seat === null ? (
            <p className="learner-achievements-footnote">
              Фильтр класса применяется к журналу по точному ID. Результаты заданий без ID класса не
              смешиваются с другим классом и здесь не показываются.
            </p>
          ) : null}
          {section === 'grades' && journal ? (
            <div className="learner-achievements-pagination">
              <button
                type="button"
                className="btn-secondary"
                disabled={offset === 0 || journalLoading}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Предыдущие 20
              </button>
              <span>Страница {Math.floor(offset / 20) + 1} журнала</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={journal.nextOffset === null || journalLoading}
                onClick={() => {
                  if (journal.nextOffset !== null) setOffset(journal.nextOffset);
                }}
              >
                Следующие 20
              </button>
            </div>
          ) : null}
          {section === 'overview' ? (
            <button type="button" className="learner-achievements-bottom-action" onClick={onGrades}>
              Посмотреть все оценки и изменения <span aria-hidden="true">→</span>
            </button>
          ) : null}
        </section>
      ) : null}

      {section !== 'grades' ? (
        <section
          className="learner-achievements-panel"
          aria-labelledby="learner-achievements-awards"
        >
          <div className="learner-achievements-panel-head">
            <div>
              <h3 id="learner-achievements-awards">Мои награды</h3>
              <p>За идеи, точность, помощь другим и выполненные работы.</p>
            </div>
            {section === 'overview' ? (
              <button type="button" className="learner-text-button" onClick={onAwards}>
                Все награды →
              </button>
            ) : null}
          </div>
          {section === 'awards' && classes.length > 1 ? (
            <label className="learner-achievements-award-filter">
              Класс
              <select
                value={selectedClassId ?? ''}
                onChange={(event) => setSelectedClassId(event.target.value || null)}
              >
                <option value="">Все классы</option>
                {classes.map((entry) => (
                  <option key={entry.seatId} value={entry.classroomId}>
                    {entry.classroomTitle} — {entry.teacherDisplayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {shownAwards.length ? (
            <ul className="learner-achievements-award-list">
              {(section === 'overview' ? shownAwards.slice(0, 4) : shownAwards).map((award) => (
                <li key={award.id}>
                  <span className="learner-award-symbol" aria-hidden="true">
                    {award.symbol}
                  </span>
                  <span>
                    <strong>{award.title}</strong>
                    <small>{award.source}</small>
                    {award.description ? <p>{award.description}</p> : null}
                    {award.awardedBy ? <small>Выдал: {award.awardedBy}</small> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="learner-achievements-empty">
              Полученных значков пока нет. Они появятся здесь после выдачи преподавателем.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
