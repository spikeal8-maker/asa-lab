import { useLayoutEffect, useRef } from 'react';
import { WorkbenchEditingTools } from '../electronics/WorkbenchHeader';
import { WorkbenchTooltip } from '../electronics/WorkbenchTooltip';
import { CodeIcon, ListIcon, ViewIcon } from '../electronics/workbench-icons';
import type { ElectronicsWorkbenchController } from '../electronics/use-electronics-workbench';

/** Host for native Electronics editing tools: no duplicate solver, editor or tool definitions. */
export function RoboticsElectronicsToolbar({
  controller,
  running,
  codeOpen,
  onToggleCode,
}: {
  readonly controller: ElectronicsWorkbenchController;
  readonly running: boolean;
  readonly codeOpen: boolean;
  readonly onToggleCode: () => void;
}): JSX.Element {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const nativeToolsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (nativeToolsRef.current) nativeToolsRef.current.inert = running || controller.busy;
  }, [running, controller.busy]);
  return (
    <div ref={toolbarRef} className="robotics-electronics-tools workbench-toolbar breadboard"
      role="toolbar" aria-label="Инструменты электроники">
      <button type="button"
        className={'workbench-tool robotics-electronics-catalog' + (controller.libraryOpen ? ' active' : '')}
        aria-label="Компоненты" data-workbench-tooltip="Каталог компонентов"
        aria-pressed={controller.libraryOpen}
        disabled={running || controller.busy}
        onClick={() => controller.setLibraryOpen((open) => !open)}
      ><ListIcon /></button>
      <button type="button" className="workbench-tool" aria-label="Вписать"
        data-workbench-tooltip="Вписать электрическую схему в экран"
        onClick={controller.fitScene}
      ><ViewIcon /></button>
      <button type="button"
        className={'workbench-tool robotics-electronics-code' + (codeOpen ? ' active' : '')}
        aria-label={codeOpen ? 'Закрыть код' : 'Открыть код'}
        data-workbench-tooltip={codeOpen ? 'Закрыть редактор Arduino' : 'Выдвинуть редактор кода Arduino'}
        aria-pressed={codeOpen} onClick={onToggleCode}
      ><CodeIcon /></button>
      <div className="robotics-electronics-native-tools" ref={nativeToolsRef}>
        <WorkbenchEditingTools controller={controller} showNotes={false} />
      </div>
      <WorkbenchTooltip root={toolbarRef} />
    </div>
  );
}
