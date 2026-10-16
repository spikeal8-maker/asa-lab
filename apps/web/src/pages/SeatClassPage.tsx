import type { ClassroomStudentSession } from '../api';
import { LearningPage } from './LearningPage';

/** The StudentSeat class opens the same compact, scoped learning surface. */
export function SeatClassPage({
  seat,
  onOpenProject,
}: {
  readonly seat: ClassroomStudentSession;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  return <LearningPage seat={seat} onOpenProject={onOpenProject} pageTitle="Мой класс" />;
}
