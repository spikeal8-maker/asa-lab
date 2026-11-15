/* @vitest-environment jsdom */
import * as ScratchBlocks from 'scratch-blocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateArduinoCode, registerArduinoBlocks } from '../arduino-blocks';

const messages = ScratchBlocks.Msg as Record<string, string>;
const originalMessages = { ...messages };
let workspace: ScratchBlocks.Workspace | undefined;

function deleteMenu() {
  const item = ScratchBlocks.ContextMenuRegistry.registry.getItem('workspaceDelete');
  if (!item || !('displayText' in item) || typeof item.displayText !== 'function')
    throw new Error('Pinned ScratchBlocks workspace delete menu is missing');
  return item.displayText({ workspace: workspace as ScratchBlocks.WorkspaceSvg });
}

function createProgram() {
  workspace = new ScratchBlocks.Workspace();
  const setup = workspace.newBlock('asa_setup');
  const wait = workspace.newBlock('asa_wait');
  setup.getInput('DO')!.connection!.connect(wait.previousConnection!);
  return workspace;
}

afterEach(() => {
  workspace?.dispose();
  workspace = undefined;
  for (const key of Object.keys(messages)) delete messages[key];
  Object.assign(messages, originalMessages);
  vi.restoreAllMocks();
});

describe('Arduino initializes the pinned ScratchBlocks messages before editing', () => {
  it('reproduces the exact classroom workspace-menu TypeError and repairs it on registration', () => {
    registerArduinoBlocks();
    createProgram();
    // Exact release frame ArduinoCodePanel-BLDbiImP.js:2325:53490 maps to
    // workspaceDelete.displayText -> Msg.DELETE_X_BLOCKS.replace(...).
    delete messages.DELETE_X_BLOCKS;
    expect(() => deleteMenu()).toThrow(TypeError);
    registerArduinoBlocks();
    expect(deleteMenu()).toBe('Удалить 2 блоки');
  });

  it('renders the real vendor delete label without changing blocks, generated code or serialization', () => {
    registerArduinoBlocks();
    const current = createProgram();
    const before = ScratchBlocks.serialization.workspaces.save(current);
    const code = generateArduinoCode(current);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(deleteMenu()).toBe('Удалить 2 блоки');
    }
    expect(ScratchBlocks.serialization.workspaces.save(current)).toEqual(before);
    expect(generateArduinoCode(current)).toBe(code);
    const restored = new ScratchBlocks.Workspace();
    try {
      ScratchBlocks.serialization.workspaces.load(before, restored);
      expect(generateArduinoCode(restored)).toBe(code);
      expect(restored.getAllBlocks(false)).toHaveLength(current.getAllBlocks(false).length);
    } finally {
      restored.dispose();
    }
  });

  it('supplies native variable prompts and respects cancelling creation', () => {
    registerArduinoBlocks();
    const current = createProgram();
    const prompt = vi.fn((_message, _default, callback) => callback('', []));
    ScratchBlocks.ScratchVariables.setPromptHandler(prompt);
    ScratchBlocks.ScratchVariables.createVariable(
      current as ScratchBlocks.WorkspaceSvg,
      undefined,
      ScratchBlocks.SCALAR_VARIABLE_TYPE,
    );
    expect(prompt).toHaveBeenCalledWith(
      messages.NEW_VARIABLE_TITLE,
      '',
      expect.any(Function),
      messages.VARIABLE_MODAL_TITLE,
      ScratchBlocks.SCALAR_VARIABLE_TYPE,
    );
    expect(current.getVariableMap().getAllVariables()).toHaveLength(0);
    expect(messages.DELETE_ALL_BLOCKS.replace('%1', '2')).toBe('Удалить все 2 блоки?');
  });
});
