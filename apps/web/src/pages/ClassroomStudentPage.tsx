import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  api,
  type ClassroomStudentSeat,
  type ClassroomStudentWork,
  type ModuleSummary,
  type Project,
  type ProjectFeedback,
} from '../api';
import {
  participantsApi,
  type ParticipantProfile,
  type ParticipantWorks,
} from '../classroom-participants-api';
import { ProjectCard } from '../modules/ProjectCard';
import { WorkPreview } from '../components/WorkPreview';
import { Dropdown } from '../components/Dropdown';
import { ClassroomActivityList } from '../components/ClassroomActivityList';
import { useSchoolTime } from '../components/school-time';
import { seatAvatar } from '../creator-portal/default-avatars';
import { SeatAwardPanel, SeatAwardRow } from '../components/SeatAwards';
import {
  ParticipantRating,
  ParticipantMeritsAndAvatars,
  ParticipantGradeHistory,
} from '../components/ClassroomParticipantPanels';
import { newClientId } from '../client-id';
import { onSessionLoggedOut } from '../session-fetch';
import { ParticipantAssignmentsList } from '../components/ParticipantAssignmentsList';
import type { ClassroomStudentNavigation } from '../components/classroom-student-navigation';
import { canonicalLearningLabel } from '../learning/canonical-learning-presentation';
import './classroom-student.css';
import { ClassroomGamesSettings } from '../components/ClassroomGamesSettings';
import '../modules/classroom-mobile.css';

export const BADGE_LABELS: Readonly<Record<string, string>> = {
  excellent: 'Отлично',
  good: 'Хорошо',
  progress: 'Есть прогресс',
  redo: 'Нужно доделать',
};
function markTone(
  entry: ProjectFeedback | null,
  edited: boolean,
): 'excellent' | 'good' | 'progress' | 'redo' | 'teacher' | undefined {
  const badge = entry?.badge;
  if (badge === 'excellent' || badge === 'good' || badge === 'progress' || badge === 'redo')
    return badge;
  return edited ? 'teacher' : undefined;
}
function asProject(work: ClassroomStudentWork): Project {
  return {
    id: work.id,
    scope: 'personal',
    classroomId: null,
    moduleKey: work.moduleKey,
    title: work.title,
    status: work.status,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    preview: work.preview,
    copiedFrom: null,
    snapshotRevision: work.snapshotRevision,
  };
}
const TABS = [
  { key: 'all', label: 'Все работы', module: null },
  { key: 'grades', label: 'Оценки', module: null },
  { key: 'assignments', label: 'Задания', module: null },
  { key: 'three-d', label: '3D', module: 'three-d' },
  { key: 'electronics', label: 'Электроника', module: 'electronics' },
  { key: 'blocks', label: 'Scratch', module: 'blocks' },
  { key: 'merits', label: 'Заслуги', module: null },
  { key: 'activity', label: 'Активность', module: null },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ClassroomStudentPage({
  classroomId,
  classroomTitle,
  seatId,
  navigation,
  onNavigateStudent,
  onBack,
  onOpenProject,
  profileRevision = 0,
  seatActions,
}: {
  readonly classroomId: string;
  readonly classroomTitle: string;
  readonly seatId: string;
  readonly navigation: ClassroomStudentNavigation | null;
  readonly onNavigateStudent: (seatId: string) => void;
  readonly onBack: () => void;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
  readonly profileRevision?: number;
  readonly seatActions?: {
    readonly busy: boolean;
    readonly readOnly: boolean;
    readonly studentCode: boolean;
    readonly canOpenCard: boolean;
    readonly error: string | null;
    readonly onSettings: () => void;
    readonly onCode: () => void;
    readonly onAccessCard: () => void;
    readonly onSuspend: () => void;
    readonly onSafeMode: (value: boolean) => Promise<string | null>;
  };
}): JSX.Element {
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [loadedScope, setLoadedScope] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [archive, setArchive] = useState(false);
  const [works, setWorks] = useState<ParticipantWorks | null>(null);
  const [worksError, setWorksError] = useState<string | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const workRequest = useRef(0);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [responding, setResponding] = useState<ClassroomStudentWork | null>(null);
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [awardKeys, setAwardKeys] = useState<readonly string[]>([]);
  const [roleBusy, setRoleBusy] = useState(false);
  const [safeBusy, setSafeBusy] = useState(false);
  const safeRequest = useRef(0);
  const avatarSection = useRef<HTMLElement>(null);
  const [focusAvatar, setFocusAvatar] = useState(false);
  const [learnerPickerOpen, setLearnerPickerOpen] = useState(false);
  const [learnerSearch, setLearnerSearch] = useState('');
  const [learnerRoster, setLearnerRoster] = useState<{
    classroomId: string;
    items: Pick<ClassroomStudentSeat, 'id' | 'displayLabel' | 'avatarKey'>[];
  } | null>(null);
  const [learnerRosterError, setLearnerRosterError] = useState<string | null>(null);
  const [learnerRosterRetry, setLearnerRosterRetry] = useState(0);
  const rosterRequest = useRef<{
    classroomId: string;
    promise: ReturnType<typeof api.listClassroomRoster>;
  } | null>(null);
  const learnerPicker = useRef<HTMLDivElement>(null);
  const learnerOpener = useRef<HTMLButtonElement | null>(null);
  const learnerSearchInput = useRef<HTMLInputElement>(null);
  const focusAfterNavigation = useRef<string | null>(null);
  const learnerPickerId = useId();
  const generation = useRef(0);
  const profileGeneration = useRef(0);
  const sessionEnded = useRef(false);
  const lastClassroomId = useRef(classroomId);
  const scope = useRef('');
  scope.current = `${classroomId}:${seatId}`;
  const time = useSchoolTime();
  const module = TABS.find((t) => t.key === tab)?.module ?? null;
  const showsWorks = !['assignments', 'merits', 'grades', 'activity'].includes(tab);
  const closeLearnerPicker = useCallback((restoreFocus = true) => {
    setLearnerPickerOpen(false);
    if (restoreFocus) learnerOpener.current?.focus();
  }, []);
  useEffect(() => {
    setLearnerPickerOpen(false);
    setLearnerSearch('');
    setSafeBusy(false);
    safeRequest.current++;
    setFocusAvatar(false);
  }, [classroomId, seatId]);
  useEffect(() => {
    if (tab !== 'merits' || !focusAvatar) return;
    avatarSection.current?.focus();
    avatarSection.current?.scrollIntoView?.({ block: 'start' });
    setFocusAvatar(false);
  }, [tab, focusAvatar]);
  useEffect(() => {
    if (!learnerPickerOpen || sessionEnded.current) return;
    let active = true;
    learnerSearchInput.current?.focus();
    setLearnerRosterError(null);
    // Retain the single class request across pupil changes and menu reopenings.
    if (rosterRequest.current?.classroomId !== classroomId) {
      rosterRequest.current = { classroomId, promise: api.listClassroomRoster(classroomId) };
    }
    const request = rosterRequest.current;
    void request.promise
      .then((result) => {
        if (!result.ok && rosterRequest.current === request) rosterRequest.current = null;
        if (!active || sessionEnded.current) return;
        if (result.ok) {
          setLearnerRoster({
            classroomId,
            items: result.data.items.map(({ id, displayLabel, avatarKey }) => ({
              id,
              displayLabel,
              avatarKey,
            })),
          });
        } else setLearnerRosterError(result.error.message);
      })
      .catch(() => {
        if (rosterRequest.current === request) rosterRequest.current = null;
        if (active && !sessionEnded.current)
          setLearnerRosterError('Не удалось загрузить список учеников.');
      });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !learnerPicker.current?.contains(event.target))
        closeLearnerPicker();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeLearnerPicker();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      active = false;
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [classroomId, learnerPickerOpen, learnerRosterRetry, closeLearnerPicker]);
  const load = useCallback(async () => {
    if (sessionEnded.current || scope.current !== `${classroomId}:${seatId}`) return;
    const token = ++profileGeneration.current;
    setProfileError(null);
    // Same-scope refresh must not unmount active forms or restart the awards panel.
    const result = await participantsApi.profile(classroomId, seatId);
    if (token !== profileGeneration.current || scope.current !== `${classroomId}:${seatId}`) return;
    if (result.ok) {
      setLoadedScope(`${classroomId}:${seatId}`);
      setProfile(result.data);
      setAwardKeys(result.data.builtinAwards.map((award) => award.awardKey));
    } else {
      setProfile(null);
      setProfileError(result.error.message);
    }
  }, [classroomId, seatId]);
  useEffect(() => {
    if (!profileRevision) return;
    // Refresh confirmed settings without resetting the current review/tab state.
    rosterRequest.current = null;
    setLearnerRoster(null);
    setLearnerRosterRetry((value) => value + 1);
    void load();
  }, [profileRevision, load]);
  const awardsChanged = useCallback(
    (keys: readonly string[]) => {
      setAwardKeys(keys);
      void load();
    },
    [load],
  );
  useEffect(() => {
    setProfile(null);
    // Keep the selected project/grade tab while moving through the same class.
    // A different class always resets the context and review filters.
    if (lastClassroomId.current !== classroomId) {
      lastClassroomId.current = classroomId;
      focusAfterNavigation.current = null;
      setTab('all');
      setArchive(false);
      setOnlyAwaiting(false);
    }
    setResponding(null);
    setAwardKeys([]);
    setRoleBusy(false);
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener('focus', refresh);
    const unsubscribe = onSessionLoggedOut(() => {
      sessionEnded.current = true;
      safeRequest.current++;
      profileGeneration.current++;
      generation.current++;
      setProfile(null);
      setWorks(null);
      setResponding(null);
      setAwardKeys([]);
      setLearnerPickerOpen(false);
      setLearnerRoster(null);
      rosterRequest.current = null;
      setProfileError('Войдите, чтобы открыть профиль.');
    });
    return () => {
      safeRequest.current++;
      profileGeneration.current++;
      window.removeEventListener('focus', refresh);
      unsubscribe();
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    void api.listProjectModules().then((r) => {
      if (active && r.ok) setModules(r.data.items);
    });
    return () => {
      active = false;
    };
  }, []);
  const loadWorks = useCallback(
    async (offset = 0) => {
      if (sessionEnded.current || scope.current !== `${classroomId}:${seatId}`) return;
      const token = ++generation.current;
      setWorkLoading(true);
      workRequest.current = offset;
      setWorksError(null);
      const result = await participantsApi.works(classroomId, seatId, module, archive, offset);
      if (generation.current !== token || scope.current !== `${classroomId}:${seatId}`) return;
      setWorkLoading(false);
      if (result.ok)
        setWorks((old) =>
          offset && old
            ? {
                ...result.data,
                items: [...old.items, ...result.data.items].filter(
                  (w, i, all) => all.findIndex((other) => other.id === w.id) === i,
                ),
              }
            : result.data,
        );
      else {
        if ([401, 403, 404].includes(result.status)) {
          setWorks(null);
          workRequest.current = 0;
        }
        setWorksError(result.error.message);
      }
    },
    [classroomId, seatId, module, archive, tab],
  );
  useEffect(() => {
    setWorks(null);
    if (showsWorks) void loadWorks();
    return () => {
      generation.current++;
    };
  }, [loadWorks, showsWorks]);

  const activeStudent =
    profile?.student.id === seatId && loadedScope === `${classroomId}:${seatId}`
      ? profile.student
      : null;
  const matchingLearners = (
    learnerRoster?.classroomId === classroomId ? learnerRoster.items : []
  ).filter((entry) =>
    entry.displayLabel.toLocaleLowerCase().includes(learnerSearch.trim().toLocaleLowerCase()),
  );

  const navigationRow = (
    <div
      className="classroom-student-navrow classroom-student-identity-rail"
      role="group"
      aria-label="Ученик и навигация"
    >
      <button
        type="button"
        className="classroom-student-back"
        aria-label="← К классу"
        title={classroomTitle}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
        <span className="classroom-student-back-label">К классу</span>
      </button>
      <nav className="classroom-student-navigation" aria-label="Переход по ученикам">
        <button
          type="button"
          className="classroom-student-previous"
          aria-label={
            navigation
              ? `Предыдущий ученик: ${navigation.previous.displayLabel}`
              : 'Предыдущий ученик'
          }
          title={navigation?.previous.displayLabel}
          disabled={!navigation || navigation.total < 2}
          onClick={() => {
            if (navigation) onNavigateStudent(navigation.previous.id);
          }}
        >
          <span aria-hidden="true">‹</span>
          {navigation ? (
            <span className="student-pager-name">
              {navigation.previous.displayLabel.trim().split(/\s+/).slice(0, 2).join(' ')}
            </span>
          ) : null}
        </button>
        {activeStudent ? (
          <div className="classroom-student-heading-row">
            <div
              className="classroom-student-picker"
              ref={learnerPicker}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) closeLearnerPicker(false);
              }}
            >
              <h1 className="classroom-student-picker-heading">
                <button
                  type="button"
                  className="classroom-student-person classroom-student-picker-opener"
                  ref={(element) => {
                    learnerOpener.current = element;
                    if (element && focusAfterNavigation.current === seatId) {
                      focusAfterNavigation.current = null;
                      element.focus();
                    }
                  }}
                  aria-label={`Выбрать ученика: ${activeStudent.displayLabel}`}
                  aria-haspopup="dialog"
                  aria-expanded={learnerPickerOpen}
                  aria-controls={learnerPickerId}
                  onClick={() => {
                    setLearnerSearch('');
                    setLearnerPickerOpen((open) => !open);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setLearnerPickerOpen(true);
                      learnerSearchInput.current?.focus();
                    }
                  }}
                >
                  <img
                    className="classroom-student-avatar"
                    src={
                      profile?.metrics.avatarUrl ??
                      seatAvatar(activeStudent.id, activeStudent.avatarKey).src
                    }
                    alt=""
                    width={48}
                    height={48}
                  />
                  <span className="classroom-student-picker-text">
                    <span
                      className="classroom-student-picker-name"
                      title={activeStudent.displayLabel}
                    >
                      {activeStudent.displayLabel}
                    </span>
                    <span className="classroom-student-rail-state">
                      {navigation ? (
                        <span
                          className="classroom-student-navigation-position"
                          aria-label={`Ученик ${navigation.position} из ${navigation.total}`}
                        >
                          {navigation.position}/{navigation.total}
                        </span>
                      ) : null}
                      <span
                        className={
                          activeStudent.status === 'suspended'
                            ? 'classroom-student-suspended'
                            : undefined
                        }
                      >
                        {activeStudent.status === 'suspended'
                          ? 'Доступ приостановлен'
                          : activeStudent.safeMode
                            ? 'Защита включена'
                            : 'Защита выключена'}
                      </span>
                    </span>
                  </span>
                  <span className="classroom-student-picker-chevron" aria-hidden="true">
                    ▾
                  </span>
                </button>
              </h1>
              {learnerPickerOpen ? (
                <div
                  className="classroom-student-picker-popup"
                  id={learnerPickerId}
                  role="dialog"
                  aria-label="Ученики класса"
                  onKeyDown={(event) => {
                    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                    const controls = Array.from(
                      event.currentTarget.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
                        'input, button',
                      ),
                    );
                    const index = controls.indexOf(
                      event.target as HTMLInputElement | HTMLButtonElement,
                    );
                    if (index < 0) return;
                    // Home/End remain native text-editing keys in the search field.
                    if (index === 0 && (event.key === 'Home' || event.key === 'End')) return;
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 1
                        : event.key === 'End'
                          ? controls.length - 1
                          : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) %
                            controls.length;
                    controls[next]?.focus();
                    controls[next]?.scrollIntoView?.({ block: 'nearest' });
                  }}
                >
                  <input
                    ref={learnerSearchInput}
                    type="search"
                    aria-label="Найти ученика по имени или фамилии"
                    placeholder="Имя или фамилия"
                    value={learnerSearch}
                    onChange={(event) => setLearnerSearch(event.target.value)}
                  />
                  {learnerRosterError ? (
                    <>
                      <p role="alert">{learnerRosterError}</p>
                      <button
                        type="button"
                        onClick={() => setLearnerRosterRetry((retry) => retry + 1)}
                      >
                        Повторить
                      </button>
                    </>
                  ) : learnerRoster?.classroomId !== classroomId ? (
                    <p role="status">Загружаем учеников…</p>
                  ) : (
                    <>
                      <ul aria-label="Список учеников">
                        {matchingLearners.map((entry) => (
                          <li key={entry.id}>
                            <button
                              type="button"
                              aria-current={entry.id === seatId ? 'page' : undefined}
                              onClick={() => {
                                closeLearnerPicker();
                                focusAfterNavigation.current =
                                  entry.id !== seatId ? entry.id : null;
                                onNavigateStudent(entry.id);
                              }}
                            >
                              <img
                                src={seatAvatar(entry.id, entry.avatarKey).src}
                                alt=""
                                width={28}
                                height={28}
                              />
                              <span>{entry.displayLabel}</span>
                              {entry.id === seatId ? (
                                <span
                                  className="classroom-student-picker-active"
                                  aria-label="Текущий ученик"
                                >
                                  ✓
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                      {matchingLearners.length === 0 ? (
                        <p role="status">Ученики не найдены</p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="classroom-student-rail-loading" role="status">
            Загружаем ученика…
          </span>
        )}
        <button
          type="button"
          className="classroom-student-next"
          aria-label={
            navigation ? `Следующий ученик: ${navigation.next.displayLabel}` : 'Следующий ученик'
          }
          title={navigation?.next.displayLabel}
          disabled={!navigation || navigation.total < 2}
          onClick={() => {
            if (navigation) onNavigateStudent(navigation.next.id);
          }}
        >
          {navigation ? (
            <span className="student-pager-name">
              {navigation.next.displayLabel.trim().split(/\s+/).slice(0, 2).join(' ')}
            </span>
          ) : null}
          <span aria-hidden="true">›</span>
        </button>
      </nav>
    </div>
  );
  if (!profile || profile.student.id !== seatId || loadedScope !== `${classroomId}:${seatId}`)
    return (
      <main className="portal-content classroom-student" id="main-content" tabIndex={-1}>
        {navigationRow}
        {profileError ? (
          <section role="alert">
            <p>{profileError}</p>
            <button
              type="button"
              onClick={() => {
                sessionEnded.current = false;
                void load();
              }}
            >
              Повторить
            </button>
            <button type="button" onClick={onBack}>
              К классу
            </button>
          </section>
        ) : (
          <p role="status">Загружаем профиль участника…</p>
        )}
      </main>
    );
  const { student, metrics, settings } = profile;
  const readOnly = profile.status !== 'active' || Boolean(seatActions?.readOnly);
  const settingsLocked = readOnly || student.status === 'suspended';
  const controlsBusy = roleBusy || safeBusy || Boolean(seatActions?.busy);
  const visible = (works?.items ?? []).filter(
    (work) =>
      !onlyAwaiting ||
      work.canonicalState?.workflowState === 'waiting_review' ||
      (!work.canonicalState && work.awaitingReview),
  );
  return (
    <main className="portal-content classroom-student" id="main-content" tabIndex={-1}>
      {navigationRow}
      <section className="classroom-student-hero participant-hero" aria-label="Профиль ученика">
        <div className="classroom-student-meta-row">
          <div className="participant-main-stats" aria-label="Показатели ученика">
            <span className="classroom-student-stat">
              <strong>{metrics.totalWorks}</strong>
              <small>Работы</small>
            </span>
            <span className="classroom-student-stat">
              <strong>{profile.submittedCount}</strong>
              <small>Сдано</small>
            </span>
            <span className="classroom-student-stat">
              <strong>{profile.awaitingReview}</strong>
              <small>Ждут</small>
            </span>
            <ParticipantRating metrics={metrics} settings={settings} />
          </div>
          <div className="classroom-student-meta-actions">
            <label className="participant-role">
              <select
                aria-label="Роль в классе"
                value={metrics.role}
                disabled={settingsLocked || controlsBusy}
                onChange={(e) => {
                  const token = profileGeneration.current;
                  setRoleBusy(true);
                  setProfileError(null);
                  void participantsApi
                    .mutate(classroomId, 'role', { seatId, role: e.target.value }, newClientId())
                    .then(async (r) => {
                      if (token !== profileGeneration.current) return;
                      if (r.ok) await load();
                      else setProfileError(r.error.message);
                    })
                    .finally(() => {
                      if (scope.current === `${classroomId}:${seatId}`) setRoleBusy(false);
                    });
                }}
              >
                <option value="student">Учащийся</option>
                <option value="helper">Помощник</option>
              </select>
            </label>
            <div className="classroom-student-badges">
              <SeatAwardRow keys={awardKeys} size="small" />
              <label className="classroom-student-safety">
                <input
                  type="checkbox"
                  checked={student.safeMode}
                  aria-label={`Защита: ${student.displayLabel}`}
                  disabled={settingsLocked || controlsBusy || !seatActions}
                  onChange={(event) => {
                    if (!seatActions || settingsLocked || controlsBusy) return;
                    const value = event.target.checked;
                    const currentScope = scope.current;
                    const token = ++safeRequest.current;
                    setSafeBusy(true);
                    setProfileError(null);
                    void (async () => {
                      try {
                        const error = await seatActions.onSafeMode(value);
                        if (
                          scope.current !== currentScope ||
                          sessionEnded.current ||
                          safeRequest.current !== token
                        )
                          return;
                        if (error) setProfileError(error);
                        else await load();
                      } catch {
                        if (
                          scope.current === currentScope &&
                          !sessionEnded.current &&
                          safeRequest.current === token
                        )
                          setProfileError('Не удалось сохранить защиту ученика.');
                      } finally {
                        if (
                          scope.current === currentScope &&
                          !sessionEnded.current &&
                          safeRequest.current === token
                        )
                          setSafeBusy(false);
                      }
                    })();
                  }}
                />
                Защита
              </label>
              {seatActions ? (
                <>
                  <button
                    type="button"
                    className="classroom-student-settings"
                    aria-label={`Настройки ученика: ${student.displayLabel}`}
                    title="Настройки ученика"
                    disabled={settingsLocked || controlsBusy}
                    onClick={seatActions.onSettings}
                  >
                    <span aria-hidden="true">⚙</span>
                  </button>
                  <Dropdown
                    key={`${classroomId}:${seatId}`}
                    className="classroom-row-menu classroom-student-actions"
                    ariaLabel={`Действия: ${student.displayLabel}`}
                    label="•••"
                    disabled={controlsBusy}
                  >
                    {(close) => (
                      <>
                        <button
                          type="button"
                          disabled={settingsLocked || controlsBusy}
                          onClick={() => {
                            close();
                            seatActions.onSettings();
                          }}
                        >
                          Имя и аватар
                        </button>
                        {seatActions.studentCode ? (
                          <button
                            type="button"
                            disabled={settingsLocked || controlsBusy}
                            onClick={() => {
                              close();
                              seatActions.onCode();
                            }}
                          >
                            Изменить код
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={settingsLocked || controlsBusy || !seatActions.canOpenCard}
                          onClick={() => {
                            close();
                            seatActions.onAccessCard();
                          }}
                        >
                          Карточка доступа
                        </button>
                        <button
                          type="button"
                          disabled={readOnly || controlsBusy}
                          onClick={() => {
                            close();
                            seatActions.onSuspend();
                          }}
                        >
                          {student.status === 'suspended'
                            ? 'Вернуть доступ'
                            : 'Приостановить доступ'}
                        </button>
                        <button
                          type="button"
                          disabled={settingsLocked || controlsBusy}
                          onClick={() => {
                            close();
                            setTab('merits');
                            setFocusAvatar(true);
                          }}
                        >
                          Аватары класса
                        </button>
                      </>
                    )}
                  </Dropdown>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <ParticipantGradeHistory
        key={`${classroomId}:${seatId}:summary`}
        classroomId={classroomId}
        seatId={seatId}
        compact
        variant="teacherProfile"
      />
      {metrics.role === 'helper' ? (
        <section className="participant-helper-classes" aria-label="Классы помощника">
          <h2>Классы помощника</h2>
          {(profile.helperClasses ?? []).length === 0 ? (
            <p>Нет действующих классов помощника, доступных вам обоим.</p>
          ) : (
            <ul>
              {profile.helperClasses.map((entry) => (
                <li key={entry.id}>
                  <a href={`#/classrooms/${entry.id}`}>{entry.title}</a> · Помощник
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {readOnly ? <p role="status">Класс в архиве. Изменения недоступны.</p> : null}
      <ClassroomGamesSettings
        key={`${classroomId}:${seatId}:games`}
        classroomId={classroomId}
        seatId={seatId}
        readOnly={settingsLocked || controlsBusy}
      />
      {seatActions?.error && seatActions.error !== profileError ? (
        <p role="alert">{seatActions.error}</p>
      ) : null}
      {profileError ? (
        <p role="alert">
          {profileError}{' '}
          <button type="button" onClick={() => void load()}>
            Обновить
          </button>
        </p>
      ) : null}
      <nav
        className="participant-tabs"
        aria-label="Разделы профиля"
        onFocus={(event) => {
          // Native focus may leave a partly visible button clipped in a local
          // scroller. Reveal its full label for Tab and arrow/Home/End users.
          if (event.target instanceof HTMLButtonElement)
            event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        }}
        onKeyDown={(event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}
      >
        {TABS.map((item) => (
          <button
            type="button"
            key={item.key}
            aria-pressed={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {showsWorks ? (
        <section className="classroom-student-section" aria-labelledby="student-works">
          <div className="classroom-student-works-head">
            <h2 id="student-works">{TABS.find((t) => t.key === tab)?.label}</h2>
            <label>
              <input
                type="checkbox"
                checked={archive}
                onChange={(e) => setArchive(e.target.checked)}
              />
              Включая архив
            </label>
            <label className="classroom-student-filter">
              <span>Статус</span>
              <select
                aria-label="Статус работ"
                aria-describedby="student-filter-scope"
                value={onlyAwaiting ? 'awaiting' : 'all'}
                onChange={(e) => setOnlyAwaiting(e.target.value === 'awaiting')}
              >
                <option value="all">Все</option>
                <option value="awaiting">Ждут проверки</option>
              </select>
              <small id="student-filter-scope">по загруженным</small>
            </label>
          </div>
          {works && works.visibleWorks < works.totalWorks ? (
            <p className="participant-visibility-note">
              Часть личных работ закрыта для преподавателя ({works.visibleWorks} из{' '}
              {works.totalWorks}).
            </p>
          ) : null}
          {worksError ? (
            <p role="alert">
              {worksError}{' '}
              <button type="button" onClick={() => void loadWorks(workRequest.current)}>
                Повторить
              </button>
            </p>
          ) : null}
          {workLoading ? <p role="status">Загружаем работы…</p> : null}
          {works && !workLoading && !worksError && visible.length === 0 ? (
            <p className="classroom-student-empty">
              {onlyAwaiting
                ? `Среди загруженных работ нет ожидающих проверки.${works.hasMore ? ' Загрузите ещё работы.' : ''}`
                : 'Нет доступных работ по этому фильтру.'}
            </p>
          ) : null}
          <ul className="project-card-grid">
            {visible.map((work) => (
              <ProjectCard
                key={work.id}
                project={asProject(work)}
                module={modules.find((entry) => entry.moduleKey === work.moduleKey)}
                timeLabel={`Изменён ${time.shortDate(work.updatedAt)}`}
                footerLabel={
                  canonicalLearningLabel(work.canonicalState) ??
                  (work.awaitingReview
                    ? 'Ждёт ответа'
                    : work.feedback?.badge
                      ? (BADGE_LABELS[work.feedback.badge] ?? 'Отклик есть')
                      : work.lastEditedByTeacher
                        ? 'Правил педагог'
                        : 'Работа')
                }
                footerTone={
                  work.canonicalState?.workflowState === 'waiting_review' ||
                  (!work.canonicalState && work.awaitingReview)
                    ? 'redo'
                    : markTone(work.feedback, work.lastEditedByTeacher)
                }
                primaryLabel="Открыть"
                open={{
                  href: `#/projects/${work.id}`,
                  onNavigate: () => onOpenProject(work.id, work.moduleKey),
                }}
                menuItems={
                  readOnly || work.status === 'archived'
                    ? []
                    : [
                        {
                          label: work.feedback ? 'Изменить отклик' : 'Оценить работу',
                          onSelect: () => setResponding(work),
                        },
                      ]
                }
              />
            ))}
          </ul>
          {works?.hasMore ? (
            <button
              type="button"
              disabled={workLoading}
              onClick={() => void loadWorks(works.offset + 30)}
            >
              Ещё работы
            </button>
          ) : null}
        </section>
      ) : null}
      {tab === 'assignments' ? (
        <ParticipantAssignmentsList
          key={`${classroomId}:${seatId}`}
          classroomId={classroomId}
          seatId={seatId}
          readOnly={readOnly}
          onOpenProject={onOpenProject}
        />
      ) : null}
      {tab === 'merits' ? (
        <>
          <SeatAwardPanel
            classroomId={classroomId}
            seatId={seatId}
            readOnly={readOnly}
            onChanged={awardsChanged}
            awardApi={participantsApi}
          />
          <section ref={avatarSection} tabIndex={-1} aria-label="Аватары класса">
            <h2>Аватары класса</h2>
            <p>Изображения для этого класса. Стандартный аватар выбирается в настройках ученика.</p>
            <ParticipantMeritsAndAvatars
              key={`${classroomId}:${seatId}`}
              classroomId={classroomId}
              seatId={seatId}
              profile={profile}
              readOnly={readOnly}
              mutationsDisabled={settingsLocked}
              onChanged={load}
            />
          </section>
        </>
      ) : null}
      {tab === 'grades' ? (
        <ParticipantGradeHistory
          key={`${classroomId}:${seatId}`}
          classroomId={classroomId}
          seatId={seatId}
          variant="teacherProfile"
        />
      ) : null}
      {tab === 'activity' ? (
        <section className="classroom-student-section">
          <h2>Активность</h2>
          <p>
            Последний вход:{' '}
            {student.lastActiveAt ? time.longDateTime(student.lastActiveAt) : 'ещё не входил'}
          </p>
          <ClassroomActivityList entries={profile.activity} emptyText="Пока никаких действий." />
        </section>
      ) : null}
      {responding ? (
        <WorkPreview
          projectId={responding.id}
          snapshotRevision={responding.snapshotRevision}
          moduleKey={responding.moduleKey}
          learnerName={student.displayLabel}
          workTitle={responding.title}
          submittedAt={responding.submittedAt ?? null}
          assignment={responding.assignment}
          onClose={() => setResponding(null)}
          onOpenEditor={() => {
            const work = responding;
            setResponding(null);
            onOpenProject(work.id, work.moduleKey);
          }}
          onGraded={() => {
            setResponding(null);
            void loadWorks();
            void load();
          }}
        />
      ) : null}
    </main>
  );
}
