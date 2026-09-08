import { useState } from 'react';
import type { ClassroomStudentSession } from '../api';
import { SeatAssignments } from '../components/SeatAssignments';
import { SeatCourses } from '../components/SeatCourses';
import { SeatQuizzes } from '../components/SeatQuizzes';
import { SeatResults } from '../components/SeatResults';
import { AttendedClassesPage } from './AttendedClassesPage';

export function LearningPage({
  seat,
  onOpenProject,
}: {
  readonly seat: ClassroomStudentSession | null;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState<'self' | 'teacher' | 'completed'>('teacher');
  const navigation = (
    <nav aria-label="Разделы моего обучения" className="learning-sections">
      {(
        [
          { id: 'self', title: 'Самостоятельно' },
          { id: 'teacher', title: 'С преподавателем' },
          { id: 'completed', title: 'Завершённое' },
        ] as const
      ).map((item) => (
        <button
          type="button"
          key={item.id}
          className="btn-secondary"
          aria-current={tab === item.id ? 'page' : undefined}
          onClick={() => setTab(item.id)}
        >
          {item.title}
        </button>
      ))}
    </nav>
  );

  if (tab === 'self')
    return (
      <main id="main-content" className="portal-content learning-page" tabIndex={-1}>
        <h1>Моё обучение</h1>
        {navigation}
        <p>
          Выбирайте открытые материалы в «Знаниях». Личный прогресс самостоятельных курсов пока не
          поддерживается.
        </p>
        {!seat ? (
          <a className="btn-secondary" href="#/knowledge">
            Открыть знания
          </a>
        ) : (
          <p>Сейчас для вашего учебного профиля доступны занятия преподавателя.</p>
        )}
      </main>
    );

  if (!seat)
    return (
      <>
        <div className="portal-content">{navigation}</div>
        <AttendedClassesPage
          onOpenProject={onOpenProject}
          mode="learning"
          completedOnly={tab === 'completed'}
        />
      </>
    );

  return (
    <main id="main-content" className="portal-content learning-page" tabIndex={-1}>
      <header className="seat-class-heading">
        <h1>Моё обучение</h1>
        {navigation}
        <p>
          Курсы и отдельные задания класса «{seat.classroom.title}». Материалы можно проходить по
          порядку, а практические работы — открывать в редакторе.
        </p>
      </header>
      <SeatCourses onOpenProject={onOpenProject} completedOnly={tab === 'completed'} />
      {tab === 'completed' ? (
        <SeatResults completedOnly />
      ) : (
        <>
          <SeatResults />
          <SeatQuizzes />
          <SeatAssignments onOpenProject={onOpenProject} />
        </>
      )}
    </main>
  );
}
