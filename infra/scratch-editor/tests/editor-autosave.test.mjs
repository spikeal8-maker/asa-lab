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
    crypto: {
      getRandomValues(bytes) {
        randomCalls += 1;
        bytes[0] = randomByte;
        return bytes;
      },
    },
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

test('first dirty generation selects a 55–65 second checkpoint that later edits cannot postpone', async () => {
  for (const [randomByte, seconds] of [
    [0, 55],
    [5, 60],
    [10, 65],
  ]) {
    const fixture = await mountWithRandomByte(randomByte);
    assert.equal(fixture.props.autoSaveIntervalSecs, seconds);

    // The pinned ProjectSaverHOC arms on the first dirty transition. Model
    // that timer with fake time while exercising the actual host dirty events.
    let now = 0;
    let deadline = null;
    let latest = null;
    const checkpoints = [];
    const edit = (value) => {
      latest = value;
      fixture.machine.emit('PROJECT_CHANGED');
      if (deadline === null) deadline = now + fixture.props.autoSaveIntervalSecs * 1000;
    };
    const advance = (milliseconds) => {
      now += milliseconds;
      if (deadline !== null && now >= deadline) {
        checkpoints.push({ at: deadline, value: latest });
        deadline = null;
      }
    };

    edit('A');
    advance(30_000);
    edit('B');
    advance(seconds * 1000 - 30_001);
    assert.equal(checkpoints.length, 0);
    advance(1);
    assert.deepEqual(checkpoints, [{ at: seconds * 1000, value: 'B' }]);

    edit('C0');
    let elapsed = 0;
    while (elapsed + 5_000 < seconds * 1000) {
      advance(5_000);
      elapsed += 5_000;
      edit(`C${elapsed}`);
    }
    advance(seconds * 1000 - elapsed);
    assert.equal(checkpoints.length, 2);
    assert.equal(checkpoints[1].at, seconds * 2000);
    assert.equal(checkpoints[1].value, `C${elapsed}`);
    assert.equal(fixture.randomCalls(), 1);
    assert.equal(fixture.dirtyGenerations.length, 3 + elapsed / 5_000);
    fixture.editor.dispose();
  }
});
