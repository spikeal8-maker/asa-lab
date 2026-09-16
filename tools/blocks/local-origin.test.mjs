import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../../infra/scratch-editor/host/main.js', import.meta.url),
  'utf8',
);
const requiredExports = [
  'EditorState',
  'createStandaloneRoot',
  'setAppElement',
  'ScratchStorage',
  'buildDefaultProject',
  'setProjectId',
];

function resolvedParentOrigin(configuredParentOrigin, runtimeHref) {
  let captured = null;
  const shell = { dataset: {} };
  const status = { hidden: false, textContent: '' };
  const gui = Object.fromEntries(requiredExports.map((name) => [name, {}]));
  const context = {
    URL,
    GUI: gui,
    document: {
      querySelector(selector) {
        if (selector === '[data-asa-host-shell]') return shell;
        if (selector === 'meta[name="asa-parent-origin"]') {
          return { getAttribute: () => configuredParentOrigin };
        }
        return null;
      },
      getElementById(id) {
        return id === 'runtime-status' ? status : null;
      },
    },
    window: {
      location: { href: runtimeHref },
      parent: {},
      addEventListener() {},
    },
    AsaBlocksStatus: {},
    AsaBlocksProtocol: {
      createChildProtocol(options) {
        captured = options.expectedParentOrigin;
        return {
          start() {},
          dispose() {},
          getBinding() {
            return {};
          },
        };
      },
    },
  };
  vm.runInNewContext(source, context);
  return captured;
}

test('localhost parent template follows the hostname used for the runtime', () => {
  for (const host of ['100.105.67.69', 'desktop-i07qije.tail605710.ts.net', 'desktop-i07qije']) {
    assert.equal(
      resolvedParentOrigin('http://localhost:4610', `http://${host}:4614/?asaStatus=parent`),
      `http://${host}:4610`,
    );
  }
});

test('explicit production parent origin remains exact', () => {
  assert.equal(
    resolvedParentOrigin('https://portal.example.test', 'https://scratch.example.test/'),
    'https://portal.example.test',
  );
});
