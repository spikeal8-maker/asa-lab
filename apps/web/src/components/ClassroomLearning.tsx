import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLearningDestination } from '../learning/use-learning-destination';
import { AuthoredMaterialsPage } from '../pages/AuthoredMaterialsPage';
import { AssignLearningActivityDialog } from './AssignLearningActivityDialog';
import { ClassroomAssignments } from './ClassroomAssignments';
import { ClassroomCourses } from './ClassroomCourses';
import { ClassroomQuizzes } from './ClassroomQuizzes';
import { CourseEditorDialog } from './CourseEditorDialog';

type AssignmentFlow =
  | { kind: 'pick'; prepared?: { draftId: string; versionId: string } }
  | { kind: 'edit'; draftId?: string };

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
  const [flow, setFlow] = useState<AssignmentFlow | null>(null);
  const [notice, setNotice] = useState('');
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);
  const issueButton = useRef<HTMLButtonElement>(null);
  const editorLeaveGuard = useRef<(() => boolean) | null>(null);
  const issuing = flow !== null && !archived;
  const destination = useLearningDestination();
  useEffect(() => {
    if (destination.courseRun && !destination.assignment) setTab('courses');
  }, [destination.courseRun, destination.assignment]);
  useLayoutEffect(() => {
    if (!issuing) return;
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
  }, [issuing]);

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

  return (
    <section className="classroom-tab-panel classroom-learning-panel">
      {!archived ? (
        <div className="classroom-assignment-issue">
          <button
            ref={issueButton}
            type="button"
            className="portal-create-button"
            onClick={() => setFlow({ kind: 'pick' })}
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
      {flow?.kind === 'pick' && !archived
        ? createPortal(
            <AssignLearningActivityDialog
              classroomId={classroomId}
              preparedVersionId={flow.prepared?.versionId ?? null}
              onClose={() => {
                if (flow.prepared) setFlow({ kind: 'edit', draftId: flow.prepared.draftId });
                else closeFlow();
              }}
              onCreate={(draftId) => {
                setNotice('');
                setFlow(draftId ? { kind: 'edit', draftId } : { kind: 'edit' });
              }}
              onAssigned={(title, count, wholeClass) =>
                finishAssignment(
                  `Задание «${title}» выдано${wholeClass ? ' всему классу' : ''}. Получателей: ${count}.`,
                )
              }
            />,
            document.body,
          )
        : null}
      {flow?.kind === 'edit' && !archived
        ? createPortal(
            <div className="classroom-assignment-editor-backdrop">
              <CourseEditorDialog
                open
                screen
                showHeader={false}
                title={flow.draftId ? 'Редактор задания класса' : 'Новое задание класса'}
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
                  classroomCreation={{
                    draftId: flow.draftId ?? null,
                    onClose: closeFlow,
                    onPublished: async (draftId, versionId) => {
                      setFlow({ kind: 'pick', prepared: { draftId, versionId } });
                    },
                  }}
                />
              </CourseEditorDialog>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
