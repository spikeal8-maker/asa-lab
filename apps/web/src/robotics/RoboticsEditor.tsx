import { useEffect, useRef, useState } from 'react';
import type { Project, PublicUser } from '../api';
import { AppBootShell } from '../components/AppBootShell';
import { EditorHeader } from '../components/editor-chrome/EditorHeader';
import { useEditorAvatar } from '../components/editor-chrome/EditorAvatar';
import { ProjectProperties } from '../components/ProjectProperties';
import { isProjectSnapshotConfirmed, sendProjectSnapshot } from '../modules/project-snapshot';
import { useReportProjectSaveEvidence } from '../modules/project-save-evidence';
import { RoboticsWorkspace } from './RoboticsLab';
import { RoboticsProjectPreview } from './robotics-project-preview';
import {
  useOpenRoboticsProject,
  useRoboticsProject,
  type OpenRoboticsProject,
} from './use-robotics-project';
import '../electronics/workbench.css';
import '../electronics/workbench-mobile-properties.css';
import './robotics.css';

interface RoboticsEditorProps {
  readonly projectId: string;
  readonly onBack: () => void;
  readonly user: PublicUser;
  readonly seatLearner?: boolean;
}

export function RoboticsEditor({
  projectId,
  onBack,
  user,
  seatLearner = false,
}: RoboticsEditorProps): JSX.Element {
  const opened = useOpenRoboticsProject(projectId, user.id, seatLearner);
  if (opened.kind === 'loading') return <AppBootShell label="Открываем робототехнику" />;
  if (opened.kind === 'error')
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>Проект не открыт</h1>
          <p>{opened.message}</p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  return (
    <OpenedRoboticsEditor
      key={`${projectId}:${user.id}:${seatLearner}`}
      opened={opened.value}
      user={user}
      seatLearner={seatLearner}
      onBack={onBack}
    />
  );
}

function OpenedRoboticsEditor({
  opened,
  user,
  seatLearner,
  onBack,
}: {
  readonly opened: OpenRoboticsProject;
  readonly user: PublicUser;
  readonly seatLearner: boolean;
  readonly onBack: () => void;
}): JSX.Element {
  const projectId = opened.project.id;
  const controller = useRoboticsProject(opened, user.id, seatLearner);
  const host = controller.host;
  const avatar = useEditorAvatar(user);
  const [publicationProject, setPublicationProject] = useState<Project | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const action = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    document.title = `${host.project?.title ?? 'Робототехника'} · ASA Lab`;
  }, [host.project?.title]);
  useReportProjectSaveEvidence(host.serverRevision, controller.getSavedRevision() !== null);

  async function finish(destination?: () => void, publishing = false): Promise<void> {
    if (action.current) return;
    action.current = true;
    setActionPending(true);
    try {
      if (!(await controller.saveAll()) || !active.current) return;
      // Commit the just-saved source SVG before capturing its revision receipt.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!active.current) return;
      const sourceRevision = controller.getSavedRevision();
      await sendProjectSnapshot(projectId);
      if (!active.current) return;
      if (publishing) {
        if (
          sourceRevision === null ||
          controller.getSavedRevision() !== sourceRevision ||
          !isProjectSnapshotConfirmed(projectId, sourceRevision)
        ) {
          host.setNotice(
            'Не удалось подготовить изображение сохранённого проекта. Повторите публикацию.',
          );
          return;
        }
        setPublicationProject(controller.getProject());
      } else if (!controller.hasUnsavedChanges()) destination?.();
    } finally {
      action.current = false;
      if (active.current) setActionPending(false);
    }
  }
  const go = (hash: string): void => {
    void finish(() => {
      window.location.hash = hash;
    });
  };
  const busy = actionPending || host.busy;
  const canPublish =
    !seatLearner && (host.project?.learningWork?.allowedActions.publishOriginal ?? true);
  const saveLabel =
    host.saveStatus === 'saved'
      ? 'Сохранено в аккаунте'
      : host.saveStatus === 'saving'
        ? 'Сохраняем…'
        : host.saveStatus === 'error'
          ? 'Не удалось сохранить'
          : 'Есть изменения';
  return (
    <div
      className="robotics-portal-editor"
      data-testid="robotics-account-editor"
      data-server-revision={controller.getSavedRevision() ?? ''}
    >
      <RoboticsWorkspace
        project={controller}
        projectId={projectId}
        header={
          <EditorHeader
            moduleId="robotics"
            onExit={() => {
              void finish(onBack);
            }}
            exitLabel="Вернуться к проектам"
            title={{
              kind: 'editable',
              value: host.projectTitle,
              ariaLabel: 'Название проекта',
              maxLength: 255,
              onChange: host.setProjectTitle,
              onCommit: host.renameProject,
              onCancel: controller.cancelTitleEdit,
            }}
            status={{
              kind: host.saveStatus,
              label: saveLabel,
              detail: host.saveError ?? 'Схема, программа, конструкция и поле сохраняются вместе.',
            }}
            navigation={{
              ariaLabel: 'Навигация ASALab',
              items: [
                {
                  id: 'robotics-home',
                  label: 'Главная',
                  visibility: 'wide',
                  disabled: busy,
                  onActivate: () => go('/home'),
                },
                {
                  id: 'robotics-projects',
                  label: 'Мои проекты',
                  visibility: 'wide',
                  disabled: busy,
                  onActivate: () => go('/projects'),
                },
                {
                  id: 'robotics-account',
                  label: 'Аккаунт',
                  disabled: busy,
                  onActivate: () => go('/account'),
                },
              ],
            }}
            actions={[
              {
                id: 'robotics-save',
                label: 'Сохранить',
                disabled: busy,
                onActivate: () => {
                  void finish();
                },
              },
              ...(canPublish
                ? [
                    {
                      id: 'robotics-publish',
                      label: 'Публикация',
                      emphasis: 'primary' as const,
                      disabled: busy,
                      onActivate: () => {
                        void finish(undefined, true);
                      },
                    },
                  ]
                : []),
            ]}
            avatar={{ label: `Аккаунт: ${user.displayName}`, text: avatar.text }}
          />
        }
      />
      <RoboticsProjectPreview
        projectId={projectId}
        project={controller.robotProject}
        getCurrentProject={controller.getCurrentProject}
        getSavedRevision={controller.getSavedRevision}
      />
      {publicationProject ? (
        <ProjectProperties
          project={publicationProject}
          initialSection="publication"
          onClose={() => setPublicationProject(null)}
          onSaved={() => {
            setPublicationProject(null);
            void controller.refreshMetadata();
          }}
        />
      ) : null}
    </div>
  );
}
