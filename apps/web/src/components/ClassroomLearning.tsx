import { useState } from 'react';
import { ClassroomAssignments } from './ClassroomAssignments';
import { ClassroomCourses } from './ClassroomCourses';

export function ClassroomLearning({
  classroomId,
  archived,
  onOpenProject,
}: {
  readonly classroomId: string;
  readonly archived: boolean;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState<'courses' | 'assignments'>('courses');
  return (
    <section className="classroom-tab-panel classroom-learning-panel">
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
      </nav>
      {tab === 'courses' ? (
        <ClassroomCourses
          classroomId={classroomId}
          archived={archived}
          onOpenProject={onOpenProject}
        />
      ) : (
        <ClassroomAssignments
          classroomId={classroomId}
          archived={archived}
          onOpenProject={onOpenProject}
        />
      )}
    </section>
  );
}
