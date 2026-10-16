import { useEffect, useState } from 'react';
import { SystemTabs } from './SystemTabs';
import { useLearningDestination } from '../learning/use-learning-destination';
import { ClassroomAssignments } from './ClassroomAssignments';
import { ClassroomCourses } from './ClassroomCourses';
import { ClassroomQuizzes } from './ClassroomQuizzes';

const LEARNING_TABS = [
  { id: 'courses', label: 'Курсы' },
  { id: 'assignments', label: 'Отдельные задания' },
  { id: 'quizzes', label: 'Тесты' },
] as const;

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
  const destination = useLearningDestination();
  useEffect(() => {
    if (destination.courseRun && !destination.assignment) setTab('courses');
  }, [destination.courseRun, destination.assignment]);
  return (
    <section className="classroom-tab-panel classroom-learning-panel">
      <SystemTabs
        items={LEARNING_TABS}
        active={tab}
        onChange={setTab}
        label="Материалы класса"
        className="classroom-learning-tabs"
      />
      {tab === 'courses' ? (
        <ClassroomCourses
          classroomId={classroomId}
          archived={archived}
          onOpenProject={onOpenProject}
        />
      ) : tab === 'assignments' ? (
        <ClassroomAssignments
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
