import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLearningDestination } from '../learning/use-learning-destination';
import { onSessionLoggedOut } from '../session-fetch';
import { AuthoredMaterialsPage } from '../pages/AuthoredMaterialsPage';
import { AssignLearningActivityDialog } from './AssignLearningActivityDialog';
import {
  useClassroomActionFeedback,
  useClassroomFeedbackPublisher,
} from './ClassroomActionFeedback';
import { ClassroomAssignments } from './ClassroomAssignments';
import { ClassroomCourses } from './ClassroomCourses';
import { ClassroomQuizzes } from './ClassroomQuizzes';
import { CourseEditorDialog } from './CourseEditorDialog';
import {
  createAssignmentLifetime,
  type AssignmentFocusTicket,
  type AssignmentScope,
  type AssignmentStageToken,
} from './classroom-assignment-lifetime';

type AssignmentStep =
  | { kind: 'pick'; prepared?: { draftId: string; versionId: string } }
  | { kind: 'edit'; draftId?: string };

type AssignmentFlow = AssignmentStep & {
  readonly owner: object;
  readonly scope: AssignmentScope;
  readonly stage: AssignmentStageToken;
  readonly publish: (message: string | null) => void;
};

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
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);
  const issueButton = useRef<HTMLButtonElement>(null);
  const editorLeaveGuard = useRef<(() => boolean) | null>(null);
  const focusFrame = useRef<number | null>(null);
  const [lifetime] = useState(createAssignmentLifetime);
  const publisher = useClassroomFeedbackPublisher();
  const owner = useMemo(
    () => ({ classroomId, archived, publisher }),
    [classroomId, archived, publisher],
  );
  const binding = useRef<{ owner: object; scope: AssignmentScope } | null>(null);
  const { notice, setNotice } = useClassroomActionFeedback(
    JSON.stringify(['assignment', classroomId, archived]),
  );
  const currentFlow = flow?.owner === owner && !archived ? flow : null;
  const issuing = currentFlow !== null;
  const destination = useLearningDestination();

  useEffect(() => {
    if (destination.courseRun && !destination.assignment) setTab('courses');
  }, [destination.courseRun, destination.assignment]);

  useLayoutEffect(() => {
    const scope = lifetime.activate();
    binding.current = { owner, scope };
    setFlow(null);
    editorLeaveGuard.current = null;
    const unsubscribe = onSessionLoggedOut(() => {
      scope.dispose();
      if (binding.current?.scope === scope) binding.current = null;
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
      editorLeaveGuard.current = null;
      setFlow(null);
    });
    return () => {
      unsubscribe();
      scope.dispose();
      if (binding.current?.scope === scope) binding.current = null;
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
      editorLeaveGuard.current = null;
    };
  }, [lifetime, owner]);

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

  function restoreFocus(source: AssignmentFlow, ticket: AssignmentFocusTicket) {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    const scheduled = requestAnimationFrame(() => {
      if (focusFrame.current !== scheduled) return;
      focusFrame.current = null;
      if (binding.current?.owner === source.owner && source.scope.canRestoreFocus(ticket)) {
        issueButton.current?.focus();
      }
    });
    focusFrame.current = scheduled;
  }

  function startFlow() {
    const current = binding.current;
    if (!current || current.owner !== owner || archived) return;
    const stage = current.scope.start();
    if (!stage) return;
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
    editorLeaveGuard.current = null;
    setNotice(null);
    setFlow({ kind: 'pick', owner, scope: current.scope, stage, publish: setNotice });
  }

  function changeStep(source: AssignmentFlow, next: AssignmentStep) {
    const stage = source.scope.advance(source.stage);
    if (!stage) return;
    editorLeaveGuard.current = null;
    source.publish(null);
    setFlow({ ...next, owner: source.owner, scope: source.scope, stage, publish: source.publish });
  }

  function closeFlow(source: AssignmentFlow) {
    const ticket = source.scope.finish(source.stage);
    if (!ticket) return;
    setFlow(null);
    editorLeaveGuard.current = null;
    restoreFocus(source, ticket);
  }

  function finishAssignment(source: AssignmentFlow, message: string) {
    const ticket = source.scope.finish(source.stage);
    if (!ticket) return;
    // onAssigned is the dialog's confirmed API-success boundary. An obsolete
    // scope or stage reaches none of these UI mutations or the publisher.
    source.publish(message);
    setTab('assignments');
    setAssignmentRefresh((value) => value + 1);
    setFlow(null);
    editorLeaveGuard.current = null;
    restoreFocus(source, ticket);
  }

  return (
    <section className="classroom-tab-panel classroom-learning-panel">
      {!archived ? (
        <div className="classroom-assignment-issue">
          <button
            ref={issueButton}
            type="button"
            className="portal-create-button"
            onClick={startFlow}
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
      {currentFlow?.kind === 'pick'
        ? createPortal(
            <AssignLearningActivityDialog
              key={currentFlow.stage.sequence}
              classroomId={classroomId}
              preparedVersionId={currentFlow.prepared?.versionId ?? null}
              onClose={() => {
                if (currentFlow.prepared) {
                  changeStep(currentFlow, {
                    kind: 'edit',
                    draftId: currentFlow.prepared.draftId,
                  });
                } else closeFlow(currentFlow);
              }}
              onCreate={(draftId) => {
                changeStep(currentFlow, draftId ? { kind: 'edit', draftId } : { kind: 'edit' });
              }}
              onAssigned={(title, count, wholeClass) =>
                finishAssignment(
                  currentFlow,
                  `Задание «${title}» выдано${wholeClass ? ' всему классу' : ''}. Получателей: ${count}.`,
                )
              }
            />,
            document.body,
          )
        : null}
      {currentFlow?.kind === 'edit'
        ? createPortal(
            <div className="classroom-assignment-editor-backdrop">
              <CourseEditorDialog
                open
                screen
                showHeader={false}
                title={currentFlow.draftId ? 'Редактор задания класса' : 'Новое задание класса'}
                closeLabel="Вернуться к классу"
                className="classroom-assignment-editor"
                onClose={() => {
                  if (
                    currentFlow.scope.isCurrent(currentFlow.stage) &&
                    editorLeaveGuard.current?.()
                  ) {
                    closeFlow(currentFlow);
                  }
                }}
              >
                <AuthoredMaterialsPage
                  key={currentFlow.stage.sequence}
                  embedded
                  onRegisterLeaveGuard={(guard) => {
                    if (currentFlow.scope.isCurrent(currentFlow.stage)) {
                      editorLeaveGuard.current = guard;
                    }
                  }}
                  classroomCreation={{
                    draftId: currentFlow.draftId ?? null,
                    onClose: () => closeFlow(currentFlow),
                    onPublished: async (draftId, versionId) => {
                      changeStep(currentFlow, {
                        kind: 'pick',
                        prepared: { draftId, versionId },
                      });
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
