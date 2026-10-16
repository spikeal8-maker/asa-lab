import { useState } from 'react';
import type { ClassroomStudentSession } from '../api';
import { SeatAssignments } from '../components/SeatAssignments';
import { SeatCourses } from '../components/SeatCourses';
import { SeatQuizzes } from '../components/SeatQuizzes';
import {
  LearnerAchievementsDashboard,
  type AchievementSection,
} from '../components/LearnerAchievementsDashboard';
import { AttendedClassesPage } from './AttendedClassesPage';

type LearnerTab = AchievementSection | 'learning';
type LearningMode = 'teacher' | 'completed' | 'self';

const LEARNER_TABS: readonly { id: LearnerTab; title: string }[] = [
  { id: 'overview', title: 'Обзор' },
  { id: 'grades', title: 'Оценки' },
  { id: 'awards', title: 'Награды' },
  { id: 'learning', title: 'Занятия' },
];
const LEARNING_MODES: readonly { id: LearningMode; title: string }[] = [
  { id: 'teacher', title: 'С преподавателем' },
  { id: 'completed', title: 'Завершённое' },
  { id: 'self', title: 'Самостоятельно' },
];

/**
 * One learner surface for StudentSeat and Account: achievements remain visible
 * without turning class lessons, assessments, and teacher operations into an
 * endless stack below the gradebook. All numbers come from authorized reads.
 */
export function LearningPage({
  seat,
  onOpenProject,
  pageTitle = 'Моё обучение',
}: {
  readonly seat: ClassroomStudentSession | null;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
  readonly pageTitle?: string;
}): JSX.Element {
  const [tab, setTab] = useState<LearnerTab>('overview');
  const [mode, setMode] = useState<LearningMode>('teacher');

  const navigation = (
    <nav aria-label="Разделы учебного кабинета" className="learning-sections learner-hub-tabs">
      {LEARNER_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={tab === item.id ? 'page' : undefined}
          onClick={() => setTab(item.id)}
        >
          {item.title}
        </button>
      ))}
    </nav>
  );

  const learningNavigation = (
    <nav aria-label="Режим занятий" className="learning-sections learner-hub-tabs">
      {LEARNING_MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={mode === item.id ? 'page' : undefined}
          onClick={() => setMode(item.id)}
        >
          {item.title}
        </button>
      ))}
    </nav>
  );

  const heading = (
    <header className="learner-hub-header">
      <h1>{pageTitle}</h1>
      <p>
        {seat
          ? 'Класс «' +
            seat.classroom.title +
            '» · преподаватель ' +
            seat.classroom.teacherDisplayName
          : 'Ваши занятия, оценки и достижения в доступных учебных классах.'}
      </p>
    </header>
  );

  if (tab !== 'learning') {
    return (
      <main id="main-content" className="portal-content learning-page learner-hub" tabIndex={-1}>
        {heading}
        {navigation}
        <LearnerAchievementsDashboard
          seat={seat}
          section={tab}
          onGrades={() => setTab('grades')}
          onAwards={() => setTab('awards')}
          onLearning={() => {
            setTab('learning');
            setMode('teacher');
          }}
        />
      </main>
    );
  }

  if (!seat && mode !== 'self') {
    return (
      <>
        <div className="portal-content learning-page learner-hub">
          {heading}
          {navigation}
          {learningNavigation}
        </div>
        <AttendedClassesPage
          onOpenProject={onOpenProject}
          mode="learning"
          completedOnly={mode === 'completed'}
          hideHeading
        />
      </>
    );
  }

  return (
    <main id="main-content" className="portal-content learning-page learner-hub" tabIndex={-1}>
      {heading}
      {navigation}
      <div className="learner-hub-learning">
        {learningNavigation}
        {mode === 'self' ? (
          <section className="learner-achievements-panel">
            <h2>Самостоятельное обучение</h2>
            <p>
              Открытые материалы доступны в «Знаниях». Отдельный личный прогресс самостоятельных
              курсов пока не поддерживается.
            </p>
            <a className="btn-secondary" href="#/knowledge">
              Открыть знания
            </a>
          </section>
        ) : (
          <>
            <SeatCourses onOpenProject={onOpenProject} completedOnly={mode === 'completed'} />
            {mode === 'completed' ? (
              <section className="learner-achievements-panel">
                <h2>Мои результаты</h2>
                <p>Опубликованные оценки и история проверок находятся во вкладке «Оценки».</p>
                <button type="button" className="btn-secondary" onClick={() => setTab('grades')}>
                  Посмотреть оценки
                </button>
              </section>
            ) : (
              <>
                <SeatQuizzes />
                <SeatAssignments onOpenProject={onOpenProject} />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
