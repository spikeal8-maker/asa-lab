import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { TextEncoder, TextDecoder } from 'node:util';
import test from 'node:test';

function loadHost(name, globals = {}) {
  const context = vm.createContext({ TextEncoder, TextDecoder, ...globals });
  vm.runInContext(
    fs.readFileSync(new URL(`../../infra/scratch-editor/host/${name}.js`, import.meta.url), 'utf8'),
    context,
  );
  return context;
}

test('storage exposes only bounded fixtures and never reports a durable write', async () => {
  class Storage {
    AssetType = { Project: { name: 'Project' }, ImageVector: { name: 'ImageVector' } };
    DataFormat = { JSON: 'json', SVG: 'svg' };
    createAsset(assetType, dataFormat, data, assetId) {
      return { assetType, dataFormat, data, assetId, encodeDataURI: () => 'data:fixture' };
    }
    addHelper(helper) {
      this.helper = helper;
    }
    // No network API in this test double: registering one fails immediately.
  }
  const api = loadHost('storage').AsaBlocksStorage;
  const storage = api.createFixtureStorage({
    ScratchStorage: Storage,
    buildDefaultProject: () => [
      {
        assetType: 'Project',
        dataFormat: 'JSON',
        id: 0,
        data: JSON.stringify({ targets: [{ isStage: true }, { isStage: false }] }),
      },
      { assetType: 'ImageVector', dataFormat: 'SVG', id: 'bundled', data: new Uint8Array([1]) },
    ],
  });
  const read = (id) =>
    storage.scratchStorage.helper.load(storage.scratchStorage.AssetType.Project, id, 'json');
  for (const id of ['0', api.EXISTING_FIXTURE_ID]) {
    const project = JSON.parse(new TextDecoder().decode((await read(id)).data));
    assert.equal(project.targets[1].blocks.flag.opcode, 'event_whenflagclicked');
    assert.equal(project.monitors[0].params.VARIABLE, 'Ticks');
  }
  assert.equal(await read('11111111-1111-4111-8111-111111111111'), null);
  assert.equal(storage.getLibraryAssetUrl('bundled', 'svg'), 'data:fixture');
  assert.throws(() => storage.getLibraryAssetUrl('unknown', 'svg'), /fixture_asset_unavailable/);
  await assert.rejects(storage.saveProject(), /fixture_storage_read_only/);
  assert.equal(storage.cloudVariables, undefined);
  assert.equal(storage.backpackStorage, undefined);
});

function editorFixture(hasProjectJson = false, mode = 'editor') {
  const machine = new EventEmitter();
  let stops = 0;
  let quits = 0;
  let unmounts = 0;
  let ready = 0;
  let props;
  let params;
  const storage = {};
  machine.stopAll = () => {
    stops++;
  };
  machine.quit = () => {
    quits++;
  };
  const standalone = {
    EditorState: class {
      constructor(options, factory) {
        params = options;
        assert.equal(factory().storage, storage);
      }
    },
    setAppElement() {},
    createStandaloneRoot: () => ({
      render(value) {
        props = value;
        value.onVmInit(machine);
      },
      unmount() {
        unmounts++;
      },
    }),
  };
  const shell = { dataset: {} };
  const api = loadHost('editor', {
    AsaBlocksStorage: {
      createFixtureStorage: () => storage,
      EXISTING_FIXTURE_ID: 'asa-controlled-fixture',
    },
  }).AsaBlocksEditor;
  const editor = api.mountEditor({
    standalone,
    container: {},
    shell,
    session: { mode, projectId: '11111111-1111-4111-8111-111111111111' },
    hasProjectJson,
    onReady() {
      ready++;
    },
  });
  return {
    machine,
    shell,
    editor,
    props,
    params,
    counts: () => ({ stops, quits, unmounts, ready }),
  };
}

test('mount omits new project ID, ignores load changes and observes later real VM events', () => {
  const fixture = editorFixture();
  assert.equal('projectId' in fixture.props, false);
  assert.equal(fixture.props.canSave, false);
  fixture.machine.emit('PROJECT_CHANGED');
  assert.equal(fixture.shell.dataset.projectChanges, '0');
  fixture.props.onProjectLoaded();
  fixture.machine.emit('PROJECT_CHANGED');
  assert.equal(fixture.shell.dataset.projectChanges, '1');
  fixture.machine.emit('PROJECT_RUN_START');
  assert.equal(fixture.shell.dataset.projectRunning, 'true');
  fixture.machine.emit('PROJECT_RUN_STOP');
  assert.equal(fixture.shell.dataset.projectRunning, 'false');
});

test('existing player uses a technical fixture ID and teardown ignores late project completion', () => {
  const fixture = editorFixture(true, 'player');
  assert.equal(fixture.props.projectId, 'asa-controlled-fixture');
  assert.equal(fixture.params.isPlayerOnly, true);
  fixture.editor.dispose();
  fixture.editor.dispose();
  fixture.props.onProjectLoaded();
  fixture.machine.emit('PROJECT_CHANGED');
  assert.equal(fixture.shell.dataset.editorState, 'disposed');
  assert.equal(fixture.shell.dataset.projectChanges, '0');
  assert.equal(fixture.machine.listenerCount('PROJECT_CHANGED'), 0);
  assert.deepEqual(fixture.counts(), { stops: 2, quits: 2, unmounts: 1, ready: 0 });
});

test('accepted bridge passes only a boolean fixture selector after trust checks, never the capability', () => {
  const handlers = new Map();
  const parent = {};
  const calls = [];
  const api = loadHost('protocol', {
    window: {
      addEventListener: (event, handler) => handlers.set(event, handler),
      removeEventListener: (event) => handlers.delete(event),
    },
  }).AsaBlocksProtocol;
  const protocol = api.createChildProtocol({
    parentWindow: parent,
    expectedParentOrigin: 'https://asa.example',
    onInit: (...args) => calls.push(args),
  });
  protocol.start();
  const message = {
    messageType: 'ASA_BLOCKS_INIT',
    protocolVersion: 1,
    mode: 'editor',
    projectId: '11111111-1111-4111-8111-111111111111',
    sessionNonce: 'nonce',
    runtimeToken: 'secret',
    hasProjectJson: true,
    apiOrigin: 'https://untrusted.example',
  };
  handlers.get('message')({ source: {}, origin: 'https://asa.example', data: message });
  assert.equal(calls.length, 0);
  handlers.get('message')({ source: parent, origin: 'https://asa.example', data: message });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].runtimeToken, undefined);
  assert.equal(calls[0][0].apiOrigin, undefined);
  assert.deepEqual(Object.keys(calls[0][1]), ['hasProjectJson']);
  assert.equal(calls[0][1].hasProjectJson, true);
  assert.equal(protocol.getRuntimeToken(), 'secret');
  protocol.dispose();
  assert.equal(protocol.getRuntimeToken(), null);
});
