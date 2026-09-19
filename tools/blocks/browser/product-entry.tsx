import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type Project } from '../../../apps/web/src/api';
import { BlocksEditor } from '../../../apps/web/src/blocks/BlocksEditor';
import { useEditorAvatar } from '../../../apps/web/src/components/editor-chrome/EditorAvatar';
import { ProjectPreview } from '../../../apps/web/src/modules/ProjectPreviewFigure';

const projectId = '11111111-1111-4111-8111-111111111111';

// Browser harness uses shipping components. Only HTTP responses are deterministic fixtures.
const user = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Scratch acceptance account',
  email: 'scratch-acceptance@example.test',
};

function ProductFixture() {
  const avatar = useEditorAvatar(user);
  const [route, setRoute] = useState(window.location.hash || '#/editor');
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    const onHashChange = (): void => setRoute(window.location.hash || '#/editor');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (route !== '#/home') return;
    let active = true;
    void api.openProject(projectId).then((result) => {
      if (active && result.ok) setProject(result.data.project);
    });
    return () => {
      active = false;
    };
  }, [route]);

  if (route === '#/home') {
    return (
      <main data-testid="asa-projects-fixture">
        {project ? (
          <div data-testid="asa-project-card">
            <ProjectPreview
              project={project}
              fallback={<span data-testid="project-preview-fallback">Scratch</span>}
            />
          </div>
        ) : (
          <span role="status">Загрузка проектов…</span>
        )}
      </main>
    );
  }

  return (
    <BlocksEditor
      projectId={projectId}
      onBack={() => {
        window.location.hash = '/projects';
      }}
      onHomeClick={() => {
        window.location.hash = '/home';
      }}
      accountLabel={user.displayName}
      accountInitials={avatar.text}
      avatarUrl={avatar.src}
      onAccountClick={() => {
        window.location.hash = '/account';
      }}
    />
  );
}
const root = document.getElementById('product-root');
if (!root) throw new Error('Product fixture root missing');
createRoot(root).render(<ProductFixture />);
