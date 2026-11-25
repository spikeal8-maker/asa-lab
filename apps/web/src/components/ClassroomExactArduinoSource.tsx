import { useMemo } from 'react';
import { parseElectronicsDocument } from '@asa-lab/electronics';
import { readArduinoProgramState } from '../electronics/arduino-program-state';
import {
  useArduinoProgramPreview,
  type PreviewBoard,
} from '../projects-public/ArduinoProgramPreview';

export { useArduinoProgramPreview };

export function classroomArduinoPrograms(document: unknown): PreviewBoard[] {
  const parsed = parseElectronicsDocument(document);
  if (!parsed.ok) return [];
  return parsed.document.components.flatMap((board) => {
    if (board.componentTypeId !== 'arduino-uno' && board.variantId !== 'arduino-uno') return [];
    const properties = board.stateProperties;
    const source = properties?.arduinoSource;
    const workspace = properties?.arduinoWorkspace;
    const { mode } = readArduinoProgramState(properties);
    const hasSource = typeof source === 'string' && Boolean(source.trim());
    const hasBlocks = typeof workspace === 'string' && Boolean(workspace.trim());
    if (!hasSource && (mode === 'text' || !hasBlocks)) return [];
    return [
      {
        id: board.id,
        name: board.name?.trim() || 'Arduino Uno',
        mode,
        source: hasSource ? source : null,
        workspace: hasBlocks ? workspace : null,
        scope: 'classroom',
      },
    ];
  });
}

export default function ClassroomExactArduinoSource({ document }: { readonly document: unknown }) {
  const boards = useMemo(() => classroomArduinoPrograms(document), [document]);
  const program = useArduinoProgramPreview(boards);
  if (!program.button) return null;
  return (
    <div className="gradebook-arduino-source" onKeyDown={program.onKeyDown}>
      {program.button}
      {program.panel}
    </div>
  );
}
