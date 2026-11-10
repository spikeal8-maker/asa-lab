import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { newClientId } from '../client-id';
import { useLearningDestination } from '../learning/use-learning-destination';
import { AuthoredMaterialsPage } from '../pages/AuthoredMaterialsPage';
import { AssignLearningActivityDialog } from './AssignLearningActivityDialog';
import { ClassroomAssignments } from './ClassroomAssignments';
import { ClassroomCourses } from './ClassroomCourses';
import { ClassroomQuizzes } from './ClassroomQuizzes';
import { CourseEditorDialog } from './CourseEditorDialog';

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
  const [flow, setFlow] = useState<'pick' | 'create' | null>(null);
  const [notice, setNotice] = useState('');
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);
  const issueButton = useRef<HTMLButtonElement>(null);
  const editorLeaveGuard = useRef<(() => boolean) | null>(null);
  const request = useRef<{ versionId: string; id: string } | null>(null);
  const destination = useLearningDestination();
  useEffect(() => {
    if (destination.courseRun && !destination.assignment) setTab('courses');
  }, [destination.courseRun, destination.assignment]);
  useLayoutEffect(() => {
    if (flow !== 'create') return;
    // The preview opens image overlays on body, alongside the editor.
    const background = issueButton.current?.closest<HTMLElement>('#root');
    const previousInert = background?.inert ?? false;
    const previousOverflow = document.documentElement.style.overflow;
    if (background) background.inert = true;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      if (background) background.inert = previousInert;
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [flow]);

  function closeFlow() {
    setFlow(null);
    requestAnimationFrame(() => issueButton.current?.focus());
  }

  function finishAssignment(message: string) {
    setNotice(message);
    setTab('assignments');
    setAssignmentRefresh((value) => value + 1);
    closeFlow();
  }

  async function issueNewAssignment(_rootId: string, versionId: string): Promise<void> {
    if (request.current?.versionId !== versionId) {
      request.current = { versionId, id: `assign:${newClientId()}` };
    }
    const result = await api.assignLearningActivity(classroomId, {
      activityVersionId: versionId,
      audienceType: 'whole_class',
      seatIds: [],
      dueAt: null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      requestId: request.current.id,
    });
    if (!result.ok) throw new Error(result.error.message || 'Не удалось выдать задание.');
    finishAssignment(`Задание выдано всему классу. Получателей: ${result.data.assignedCount}.`);
  }

  return (
    <section className="classroom-tab-panel classroom-learning-panel">
      {!archived ? (
        <div className="classroom-assignment-issue">
          <button
            ref={issueButton}
            type="button"
            className="portal-create-button"
            onClick={() => setFlow('pick')}
          >
            Выдать задание
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
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
      {flow === 'pick' && !archived ? (
        <AssignLearningActivityDialog
          classroomId={classroomId}
          onClose={closeFlow}
          onCreate={() => {
            request.current = null;
            setNotice('');
            setFlow('create');
          }}
          onAssigned={(title, count) =>
            finishAssignment(`Задание «${title}» выдано. Получателей: ${count}.`)
          }
        />
      ) : null}
      {flow === 'create' && !archived
        ? createPortal(
            <div className="classroom-assignment-editor-backdrop">
              <CourseEditorDialog
                open
                screen
                showHeader={false}
                title="Новое задание класса"
                closeLabel="Вернуться к классу"
                className="classroom-assignment-editor"
                onClose={() => {
                  if (editorLeaveGuard.current?.()) closeFlow();
                }}
              >
                <AuthoredMaterialsPage
                  embedded
                  onRegisterLeaveGuard={(guard) => {
                    editorLeaveGuard.current = guard;
                  }}
                  classroomCreation={{ onClose: closeFlow, onPublished: issueNewAssignment }}
                />
              </CourseEditorDialog>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
