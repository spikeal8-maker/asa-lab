import type { PublicUser } from '../api';
import { WorkbenchHeader } from '../electronics/WorkbenchHeader';
import { WorkbenchSidebars } from '../electronics/WorkbenchSidebars';
import { WorkbenchStage } from '../electronics/WorkbenchStage';
import { useElectronicsWorkbench } from '../electronics/use-electronics-workbench';
import '../electronics/workbench.css';

export function SchematicEditor({ projectId, onBack, user }: { projectId: string; onBack: () => void; user: PublicUser }): JSX.Element {
  const controller = useElectronicsWorkbench(projectId);
  if (controller.status === 'loading') return <div className="workbench-loading" role="status">Загрузка проекта…</div>;
  if (controller.status === 'error' || !controller.document) return <main className="workbench-loading"><p>Не удалось открыть проект.</p><button className="btn-secondary" onClick={onBack}>К проектам</button></main>;
  return <div className={`workbench-shell${controller.libraryOpen ? '' : ' library-collapsed'}`}>
    <WorkbenchHeader controller={controller} onBack={onBack} user={user} />
    <div className="workbench-main">
      <WorkbenchStage controller={controller} />
      <WorkbenchSidebars controller={controller} />
    </div>
  </div>;
}
