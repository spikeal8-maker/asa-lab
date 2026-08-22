import type { ClassroomStudentSession } from '../api';
import { SeatCourses } from '../components/SeatCourses';
import { SeatAssignments } from '../components/SeatAssignments';
import { SeatQuizzes } from '../components/SeatQuizzes';

/**
 * A learner's class.
 *
 * Work set by a teacher lives here, not on the learner's home page. Home is
 * their own shelf of models; homework with a deadline is a different thing and
 * belongs behind the door marked with the class — which is also where the count
 * of what is still owed can sit without shouting at them on every visit.
 */
export function SeatClassPage({
  seat,
  onOpenProject,
}: {
  readonly seat: ClassroomStudentSession;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  return (
    <main id="main-content" className="portal-content" tabIndex={-1}>
      <header className="seat-class-heading">
        <p className="portal-eyebrow">Мой класс</p>
        <h1>{seat.classroom.title}</h1>
        <p>Преподаватель: {seat.classroom.teacherDisplayName}</p>
      </header>

      <SeatCourses onOpenProject={onOpenProject} />
      <SeatQuizzes />
      <SeatAssignments onOpenProject={onOpenProject} />
    </main>
  );
}
