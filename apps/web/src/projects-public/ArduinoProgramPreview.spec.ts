// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { publicArduinoBlocks, classroomArduinoBlocks } from '@asa-lab/contracts';
import ClassroomExactArduinoSource, {
  classroomArduinoPrograms,
} from '../components/ClassroomExactArduinoSource';
import { publishedArduinoPrograms } from './ArduinoProgramPreview';

vi.mock('./PublicArduinoBlocks', () => ({
  PublicArduinoBlocks: ({ value, scope }: { value: string; scope: string }) =>
    createElement('output', { 'data-scope': scope }, value),
}));

const workspace = JSON.stringify({
  blocks: { languageVersion: 0, blocks: [{ id: 'first', type: 'asa_wait', x: 20, y: 24 }] },
});
const sketch = 'void setup() {}\nvoid loop() {}';
const board = {
  id: 'uno',
  componentTypeId: 'arduino-uno',
  kind: 'visual' as const,
  position: { x: 0, y: 0 },
  value: 5,
};
function circuit(properties: Record<string, string>) {
  return {
    schemaVersion: 4,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
    components: [{ ...board, stateProperties: properties }],
    connections: [],
  };
}

it.each([
  { mode: 'blocks', workspace, source: sketch, label: 'Блоки', showBlocks: true, hasCode: false },
  {
    mode: 'blocks-text',
    workspace,
    source: sketch,
    label: 'Блоки',
    showBlocks: true,
    hasCode: true,
  },
  { mode: '', workspace: '', source: sketch, label: 'Код', showBlocks: false, hasCode: true },
  { mode: '', workspace, source: '', label: 'Блоки', showBlocks: true, hasCode: false },
  {
    mode: 'blocks',
    workspace: '',
    source: sketch,
    label: 'Блоки',
    showBlocks: false,
    hasCode: false,
  },
  { mode: 'text', workspace, source: sketch, label: 'Код', showBlocks: false, hasCode: true },
])('opens the author representation on request: mode $mode, button $label', async (fixture) => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const payload = circuit({
    ...(fixture.mode && { arduinoCodeMode: fixture.mode }),
    ...(fixture.workspace && { arduinoWorkspace: fixture.workspace }),
    ...(fixture.source && { arduinoSource: fixture.source }),
  });
  const before = JSON.stringify(payload);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement(ClassroomExactArduinoSource, { document: payload })),
    );
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe(fixture.label);
    expect(host.querySelector('aside, pre, output')).toBeNull();
    await act(async () => button.click());
    expect(host.querySelector('aside')).not.toBeNull();
    expect(host.querySelector('output')?.textContent ?? null).toBe(
      fixture.showBlocks ? workspace : null,
    );
    if (fixture.showBlocks) expect(host.querySelector('output')?.dataset.scope).toBe('classroom');
    expect(host.querySelector('code')?.textContent ?? null).toBe(fixture.hasCode ? sketch : null);
    if (fixture.mode === 'blocks-text') expect(host.querySelector('details')?.open).toBe(false);
    await act(async () =>
      host
        .querySelector('aside')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
    );
    expect(host.querySelector('aside')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(JSON.stringify(payload)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps private saved workspaces separate from opt-in attached publication blocks', () => {
  const props = { arduinoCodeMode: 'blocks', arduinoSource: sketch, arduinoWorkspace: workspace };
  expect(classroomArduinoPrograms(circuit(props))[0]).toMatchObject({
    workspace,
    scope: 'classroom',
  });
  expect(publishedArduinoPrograms([{ ...board, stateProperties: props }])[0]).toMatchObject({
    workspace: null,
    scope: 'publication',
  });
  expect(
    publishedArduinoPrograms([
      { ...board, stateProperties: { ...props, arduinoBlocks: workspace } },
    ])[0]?.workspace,
  ).toBe(workspace);
  expect(
    classroomArduinoPrograms(circuit({ arduinoWorkspace: workspace, arduinoCodeMode: 'text' })),
  ).toEqual([]);
  expect(classroomArduinoPrograms(circuit({}))).toEqual([]);
});

it('preserves larger classroom graphs while retaining the public budget and metadata filtering', () => {
  const nodes = Array.from({ length: 700 }, (_, index) => ({
    id: 'board-' + index,
    type: 'asa_wait',
    x: index,
    y: 10,
    fields: { TIME: '1' },
  }));
  const data = JSON.stringify({ blocks: { blocks: nodes }, extraState: { server: 'private' } });
  expect(publicArduinoBlocks(data)).toBeNull();
  const projected = classroomArduinoBlocks(data);
  expect(JSON.parse(projected!).blocks.blocks).toEqual(nodes);
  expect(projected).not.toContain('private');
  expect(classroomArduinoBlocks('{}')).toBe('{"blocks":{"languageVersion":0,"blocks":[]}}');
  expect(publicArduinoBlocks('{}')).toBeNull();
});
