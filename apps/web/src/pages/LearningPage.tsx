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
  if (!seat) {
    return <AttendedClassesPage onOpenProject={onOpenProject} mode="learning" />;
  }

  return (
    <main id="main-content" className="portal-content learning-page" tabIndex={-1}>
      <header className="seat-class-heading">
        <p className="portal-eyebrow">Мой маршрут</p>
        <h1>Обучение</h1>
        <p>
          Курсы и отдельные задания класса «{seat.classroom.title}». Материалы можно проходить по
          порядку, а практические работы — открывать в редакторе.
        </p>
      </header>
      <SeatCourses onOpenProject={onOpenProject} />
      <SeatResults />
      <SeatQuizzes />
      <SeatAssignments onOpenProject={onOpenProject} />
    </main>
  );
}
