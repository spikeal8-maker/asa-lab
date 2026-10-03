import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../host/editor.js', import.meta.url), 'utf8');
const projectId = '11111111-1111-4111-8111-111111111111';

async function mountWithRandomByte(randomByte) {
  const machine = new EventEmitter();
  machine.stopAll = () => {};
  machine.quit = () => {};
  let randomCalls = 0;
  let props;
  const context = vm.createContext({
    ...(randomByte === null
      ? {}
      : {
          crypto: {
            getRandomValues(bytes) {
              randomCalls += 1;
              bytes[0] = randomByte;
              return bytes;
            },
          },
        }),
    AsaBlocksStorage: {
      createReadOnlyStorage: () => ({ dispose() {} }),
    },
  });
  vm.runInContext(source, context);
  const standalone = {
    EditorState: class {
      constructor() {}
    },
    setAppElement() {},
    createStandaloneRoot: () => ({
      render(value) {
        props = value;
        value.onVmInit(machine);
      },
      unmount() {},
    }),
  };
  const shell = { dataset: {} };
  const dirtyGenerations = [];
  const editor = context.AsaBlocksEditor.mountEditor({
    standalone,
    container: {},
    shell,
    session: { mode: 'editor', projectId },
    bootstrap: {
      apiOrigin: 'https://asa.example',
      draftRevision: 7,
      projectJson: null,
      hasProjectJson: false,
      assets: [],
    },
    getRuntimeToken: () => 'token',
    onReady() {},
    onDirty: (generation) => dirtyGenerations.push(generation),
  });
  await editor.startup;
  props.onProjectLoaded();
  return { editor, machine, props, dirtyGenerations, randomCalls: () => randomCalls };
}

test('host supplies one minute-scale interval per mount and reports every dirty generation', async () => {
  for (const [randomByte, seconds] of [
    [0, 55],
    [5, 60],
    [10, 65],
  ]) {
    const fixture = await mountWithRandomByte(randomByte);
    assert.equal(fixture.props.autoSaveIntervalSecs, seconds);

    fixture.machine.emit('PROJECT_CHANGED');
    fixture.machine.emit('PROJECT_CHANGED');
    assert.deepEqual(fixture.dirtyGenerations, [1, 2]);
    assert.equal(fixture.props.autoSaveIntervalSecs, seconds);
    assert.equal(fixture.randomCalls(), 1);
    fixture.editor.dispose();
  }
});

test('host falls back to a 60 second interval without crypto', async () => {
  const fixture = await mountWithRandomByte(null);
  assert.equal(fixture.props.autoSaveIntervalSecs, 60);
  assert.equal(fixture.randomCalls(), 0);
  fixture.machine.emit('PROJECT_CHANGED');
  assert.deepEqual(fixture.dirtyGenerations, [1]);
  assert.equal(fixture.props.autoSaveIntervalSecs, 60);
  fixture.editor.dispose();
});
