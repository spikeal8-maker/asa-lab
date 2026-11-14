import { useEffect, useState } from 'react';
import { useLearningDestination } from '../learning/use-learning-destination';
import { ClassroomAssignmentIssuer } from './ClassroomAssignmentIssuer';
import { ClassroomAssignments } from './ClassroomAssignments';
import { ClassroomCourses } from './ClassroomCourses';
import { ClassroomQuizzes } from './ClassroomQuizzes';

export function ClassroomLearning({
  classroomId,
  archived,
  onOpenProject,
}: {
  readonly classroomId: string;
  readonly archived: boolean;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState<'courses' | 'assignments' | 'quizzes'>('courses');
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);
  const destination = useLearningDestination();

  useEffect(() => {
    if (destination.courseRun && !destination.assignment) setTab('courses');
  }, [destination.courseRun, destination.assignment]);

  return (
    <section className="classroom-tab-panel classroom-learning-panel">
      <ClassroomAssignmentIssuer
        classroomId={classroomId}
        archived={archived}
        onAssigned={() => {
          setTab('assignments');
          setAssignmentRefresh((value) => value + 1);
        }}
      />
      <nav className="classroom-learning-tabs" aria-label="Материалы класса">
        <button
          type="button"
          className={tab === 'courses' ? 'active' : undefined}
          onClick={() => setTab('courses')}
        >
          Курсы
        </button>
        <button
          type="button"
          className={tab === 'assignments' ? 'active' : undefined}
          onClick={() => setTab('assignments')}
        >
          Отдельные задания
        </button>
        <button
          type="button"
          className={tab === 'quizzes' ? 'active' : undefined}
          onClick={() => setTab('quizzes')}
        >
          Тесты
        </button>
      </nav>
      {tab === 'courses' ? (
        <ClassroomCourses
          classroomId={classroomId}
          archived={archived}
          onOpenProject={onOpenProject}
        />
      ) : tab === 'assignments' ? (
        <ClassroomAssignments
          key={assignmentRefresh}
          classroomId={classroomId}
          archived={archived}
          onOpenProject={onOpenProject}
        />
      ) : (
        <ClassroomQuizzes classroomId={classroomId} archived={archived} />
      )}
    </section>
  );
}
