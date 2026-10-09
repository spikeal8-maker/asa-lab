import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
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
import { canonicalLearningLabel } from '../learning/canonical-learning-presentation';
import './classroom-student.css';

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
  { key: 'three-d', label: '3D', module: 'three-d' },
  { key: 'electronics', label: 'Электроника', module: 'electronics' },
  { key: 'blocks', label: 'Scratch', module: 'blocks' },
  { key: 'assignments', label: 'Задания', module: null },
  { key: 'merits', label: 'Заслуги', module: null },
  { key: 'grades', label: 'Оценки и история', module: null },
  { key: 'activity', label: 'Активность', module: null },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ClassroomStudentPage({
  classroomId,
  classroomTitle,
  seatId,
  onBack,
  onOpenProject,
}: {
  readonly classroomId: string;
  readonly classroomTitle: string;
  readonly seatId: string;
  readonly onBack: () => void;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [archive, setArchive] = useState(false);
  const [works, setWorks] = useState<ParticipantWorks | null>(null);
  const [worksError, setWorksError] = useState<string | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [responding, setResponding] = useState<ClassroomStudentWork | null>(null);
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [awardKeys, setAwardKeys] = useState<readonly string[]>([]);
  const [roleBusy, setRoleBusy] = useState(false);
  const generation = useRef(0);
  const profileGeneration = useRef(0);
  const scope = useRef('');
  scope.current = `${classroomId}:${seatId}`;
  const time = useSchoolTime();
  const module = TABS.find((t) => t.key === tab)?.module ?? null;
  const showsWorks = !['merits', 'grades', 'activity'].includes(tab);
  const load = useCallback(async () => {
    if (scope.current !== `${classroomId}:${seatId}`) return;
    const token = ++profileGeneration.current;
    setProfileError(null);
    const result = await participantsApi.profile(classroomId, seatId);
    if (token !== profileGeneration.current) return;
    if (result.ok) {
      setProfile(result.data);
      setAwardKeys(result.data.builtinAwards.map((award) => award.awardKey));
    } else {
      setProfile(null);
      setProfileError(result.error.message);
    }
  }, [classroomId, seatId]);
  const awardsChanged = useCallback(
    (keys: readonly string[]) => {
      setAwardKeys(keys);
      void load();
    },
    [load],
  );
  useEffect(() => {
    setProfile(null);
    setTab('all');
    setResponding(null);
    setAwardKeys([]);
    void load();
    return () => {
      profileGeneration.current++;
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
      if (scope.current !== `${classroomId}:${seatId}`) return;
      const token = ++generation.current;
      setWorkLoading(true);
      setWorksError(null);
      const result = await participantsApi.works(
        classroomId,
        seatId,
        module,
        archive,
        offset,
        tab === 'assignments',
      );
      if (generation.current !== token) return;
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
      else setWorksError(result.error.message);
    },
    [classroomId, seatId, module, archive, tab],
  );
  useEffect(() => {
    setWorks(null);
    setOnlyAwaiting(false);
    if (showsWorks) void loadWorks();
    return () => {
      generation.current++;
    };
  }, [loadWorks, showsWorks]);

  if (!profile)
    return (
      <main className="portal-content" id="main-content" tabIndex={-1}>
        {profileError ? (
          <section role="alert">
            <p>{profileError}</p>
            <button type="button" onClick={() => void load()}>
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
  const readOnly = profile.status !== 'active';
  const visible = (works?.items ?? []).filter(
    (work) =>
      !onlyAwaiting ||
      work.canonicalState?.workflowState === 'waiting_review' ||
      (!work.canonicalState && work.awaitingReview),
  );
  return (
    <main className="portal-content classroom-student" id="main-content" tabIndex={-1}>
      <button type="button" className="classroom-student-back" onClick={onBack}>
        ← {classroomTitle}
      </button>
      <section className="classroom-student-hero participant-hero">
        <img
          className="classroom-student-avatar"
          src={metrics.avatarUrl ?? seatAvatar(student.id, student.avatarKey).src}
          alt=""
          width={64}
          height={64}
        />
        <div className="classroom-student-identity">
          <h1>{student.displayLabel}</h1>
          <p>
            {classroomTitle} · {metrics.role === 'helper' ? 'Помощник' : 'Учащийся'}
            {student.status === 'suspended' ? ' · доступ приостановлен' : ''}
          </p>
          <div className="participant-main-stats">
            <span>
              Всего работ <strong>{metrics.totalWorks}</strong>
            </span>
            <span>
              В архиве <strong>{metrics.archivedWorks}</strong>
            </span>
            <span>
              Сдано <strong>{profile.submittedCount}</strong>
            </span>
            <span>
              Ждут ответа <strong>{profile.awaitingReview}</strong>
            </span>
            <ParticipantRating metrics={metrics} settings={settings} />
          </div>
          <div className="classroom-student-badges">
            <SeatAwardRow keys={awardKeys} size="small" />
            {student.safeMode ? <span>Безопасный режим</span> : null}
          </div>
        </div>
        <label className="participant-role">
          Роль в классе
          <select
            aria-label="Роль в классе"
            value={metrics.role}
            disabled={readOnly || roleBusy}
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
                .finally(() => setRoleBusy(false));
            }}
          >
            <option value="student">Учащийся</option>
            <option value="helper">Помощник</option>
          </select>
        </label>
      </section>
      <p className="participant-role-hint">
        Помощник помогает организовать занятия в этом классе, без доступа к чужим оценкам и
        управлению. Преподавателей добавляют через приглашение коллег.
      </p>
      {readOnly ? <p role="status">Класс в архиве. Изменения недоступны.</p> : null}
      {profileError ? (
        <p role="alert">
          {profileError}{' '}
          <button type="button" onClick={() => void load()}>
            Обновить
          </button>
        </p>
      ) : null}
      <nav className="participant-tabs" aria-label="Разделы профиля">
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
            <button
              type="button"
              className="classroom-student-filter"
              aria-pressed={onlyAwaiting}
              onClick={() => setOnlyAwaiting(!onlyAwaiting)}
            >
              {onlyAwaiting ? 'Показать все' : 'Только ждущие ответа'}
            </button>
          </div>
          {works ? (
            <p className="participant-visibility-note">
              Доступно преподавателю: {works.visibleWorks} из {works.totalWorks} работ.
              {works.visibleWorks < works.totalWorks
                ? ' Остальные работы закрыты. Счётчик включает их, но не даёт права просмотра.'
                : ''}
              {tab === 'assignments'
                ? ' Здесь работы по заданиям; оценки и история — в соседней вкладке.'
                : ` По фильтру: ${works.filteredWorks}.`}
            </p>
          ) : null}
          {worksError ? (
            <p role="alert">
              {worksError}{' '}
              <button type="button" onClick={() => void loadWorks(works?.offset ?? 0)}>
                Повторить
              </button>
            </p>
          ) : null}
          {workLoading ? <p role="status">Загружаем работы…</p> : null}
          {works && !workLoading && !worksError && visible.length === 0 ? (
            <p className="classroom-student-empty">Нет доступных работ по этому фильтру.</p>
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
      {tab === 'merits' ? (
        <>
          <SeatAwardPanel
            classroomId={classroomId}
            seatId={seatId}
            readOnly={readOnly}
            onChanged={awardsChanged}
            awardApi={participantsApi}
          />
          <ParticipantMeritsAndAvatars
            classroomId={classroomId}
            seatId={seatId}
            profile={profile}
            onChanged={load}
          />
        </>
      ) : null}
      {tab === 'grades' ? (
        <ParticipantGradeHistory classroomId={classroomId} seatId={seatId} />
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
