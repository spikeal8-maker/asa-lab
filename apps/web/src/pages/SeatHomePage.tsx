import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ClassroomStudentSession,
  type ModuleSummary,
  type Project,
  type SeatAssignment,
  type SeatAward,
} from '../api';
import { awardOf } from '../components/SeatAwards';
import { ModuleGlyph } from '../modules/ModuleGlyph';
import { ProjectCard } from '../modules/ProjectCard';
import { useSchoolTime } from '../components/school-time';
import './seat-home.css';

/**
 * A learner's own front page.
 *
 * What was here before was four identical tiles saying «Новый проект», one per
 * environment, and nothing else — no class, no work, no name. A child signing
 * in was met by a page that knew nothing about them and offered four doors with
 * no reason to choose any of them.
 *
 * What a learner actually wants on opening the product is, in order: the thing
 * they were in the middle of, what is still owed, and what they have made. New
 * work comes last, because starting something is the one thing they never need
 * help finding.
 */

const MODULE_ORDER = ['three-d', 'electronics', 'chess', 'checkers'] as const;

export function SeatHomePage({
  seat,
  onOpenProject,
  onOpenClass,
}: {
  readonly seat: ClassroomStudentSession;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
  readonly onOpenClass: () => void;
}): JSX.Element {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [assignments, setAssignments] = useState<readonly SeatAssignment[]>([]);
  const [awards, setAwards] = useState<readonly SeatAward[]>([]);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const time = useSchoolTime();

  const load = useCallback(async () => {
    const [projectsResult, assignmentsResult, awardsResult, modulesResult] = await Promise.all([
      api.listProjects({ scope: 'personal', status: 'active' }),
      api.seatAssignments(),
      api.mySeatAwards(),
      api.listModules(),
    ]);
    setProjects(projectsResult.ok ? projectsResult.data.items : []);
    setAssignments(assignmentsResult.ok ? assignmentsResult.data.items : []);
    setAwards(awardsResult.ok ? awardsResult.data.items : []);
    setModules(
      modulesResult.ok
        ? modulesResult.data.items.filter((entry) => entry.availability === 'active' && entry.creatable)
        : [],
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const owed = assignments.filter(
    (entry) => entry.submittedAt === null && entry.status === 'open',
  );
  const nextUp = owed[0] ?? null;
  const recent = [...(projects ?? [])]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 4);
  const continuing = recent[0] ?? null;

  async function startModule(moduleKey: string, title: string): Promise<void> {
    setBusy(moduleKey);
    const created = await api.createProject({
      scope: 'personal',
      module: moduleKey,
      title,
      idempotencyKey: `seat-home-${Date.now()}`,
    });
    setBusy(null);
    if (created.ok) onOpenProject(created.data.project.id, moduleKey);
  }

  const orderedModules = [...modules].sort(
    (left, right) =>
      MODULE_ORDER.indexOf(left.moduleKey as (typeof MODULE_ORDER)[number]) -
      MODULE_ORDER.indexOf(right.moduleKey as (typeof MODULE_ORDER)[number]),
  );

  return (
    <main id="main-content" className="portal-content seat-home" tabIndex={-1}>
      <header className="seat-home-hero">
        <div>
          <h1>Привет, {seat.student.displayName}!</h1>
          <p>
            {seat.classroom.title} · преподаватель {seat.classroom.teacherDisplayName}
          </p>
        </div>
        {/* Badges are the one thing here that is purely theirs. Small, and
            first, because a child who earned one wants to see it. */}
        {awards.length > 0 ? (
          <ul className="seat-home-awards" aria-label="Мои значки">
            {awards.slice(0, 6).map((award) => {
              const known = awardOf(award.awardKey);
              return (
                <li key={award.awardKey} title={known?.hint ?? ''}>
                  <span aria-hidden="true">{known?.glyph ?? '★'}</span>
                  {known?.label ?? award.awardKey}
                </li>
              );
            })}
          </ul>
        ) : null}
      </header>

      {/* 1. Что я делал. */}
      {continuing ? (
        <section className="seat-home-continue" aria-labelledby="seat-continue-title">
          <h2 id="seat-continue-title">Продолжить</h2>
          <ul className="project-grid">
            <ProjectCard
              key={continuing.id}
              project={continuing}
              module={modules.find((entry) => entry.moduleKey === continuing.moduleKey)}
              timeLabel={`Изменён ${time.date(continuing.updatedAt)}`}
              footerLabel="Моя работа"
              primaryAction={{
                label: 'Открыть',
                onSelect: () => onOpenProject(continuing.id, continuing.moduleKey),
              }}
            />
          </ul>
        </section>
      ) : null}

      {/* 2. Что задано. */}
      <section className="seat-home-owed" aria-labelledby="seat-owed-title">
        <div className="seat-home-owed-head">
          <h2 id="seat-owed-title">Задания</h2>
          <button type="button" className="btn-secondary" onClick={onOpenClass}>
            Все задания класса
          </button>
        </div>
        {owed.length === 0 ? (
          <p className="seat-home-clear">Всё сдано. Можно делать что-то своё.</p>
        ) : (
          <>
            <p className="seat-home-owed-count">
              Не сдано: {owed.length}
              {nextUp?.dueAt ? ` · ближайшее до ${time.date(nextUp.dueAt)}` : ''}
            </p>
            <ul className="seat-home-owed-list">
              {owed.slice(0, 3).map((assignment) => (
                <li key={assignment.id}>
                  {assignment.sampleImage ? (
                    <img src={assignment.sampleImage} alt="" width={56} height={56} loading="lazy" />
                  ) : (
                    <span className="library-no-sample" aria-hidden="true" />
                  )}
                  <div>
                    <strong>{assignment.title}</strong>
                    <span>{assignment.dueAt ? `до ${time.date(assignment.dueAt)}` : 'без срока'}</span>
                  </div>
                  <button type="button" className="portal-create-button" onClick={onOpenClass}>
                    {assignment.projectId ? 'Продолжить' : 'Начать'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 3. Что я сделал. */}
      {recent.length > 1 ? (
        <section className="seat-home-works" aria-labelledby="seat-works-title">
          <h2 id="seat-works-title">Мои работы</h2>
          <ul className="project-grid">
            {recent.slice(1).map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                module={modules.find((entry) => entry.moduleKey === project.moduleKey)}
                timeLabel={`Изменён ${time.date(project.updatedAt)}`}
                footerLabel="Моя работа"
                primaryAction={{
                  label: 'Открыть',
                  onSelect: () => onOpenProject(project.id, project.moduleKey),
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* 4. И только теперь — начать новое. Одна строка, а не стена плиток. */}
      <section className="seat-home-start" aria-labelledby="seat-start-title">
        <h2 id="seat-start-title">Сделать своё</h2>
        <div className="seat-home-start-row">
          {orderedModules.map((module) => (
            <button
              key={module.moduleKey}
              type="button"
              className="seat-home-start-tile"
              disabled={busy !== null}
              onClick={() => void startModule(module.moduleKey, `Моя работа · ${module.displayName}`)}
            >
              <ModuleGlyph module={module} size={30} />
              <span>{module.displayName}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
