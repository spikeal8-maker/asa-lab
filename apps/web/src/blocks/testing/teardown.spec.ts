import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { BlocksRuntimeBridge } from '../runtime-protocol';

const projectId = '11111111-1111-4111-8111-111111111111';
const origin = 'http://127.0.0.1:4612';

describe('accepted protocol teardown under exceptions', () => {
  it('parent clears authority even when posting STOP throws', () => {
    const bridge = new BlocksRuntimeBridge({
      childWindow: {
        postMessage() {
          throw new Error('detached iframe');
        },
      },
      runtimeOrigin: 'http://127.0.0.1:4613',
      projectId,
      mode: 'editor',
      versionId: null,
      apiOrigin: origin,
      runtimeToken: 'teardown-fixture-token',
      draftRevision: 0,
      hasProjectJson: false,
      assets: [],
      recoveryNamespace: 'test',
    });
    expect(() => bridge.stop()).toThrow('detached iframe');
    expect(JSON.stringify(bridge)).not.toContain('teardown-fixture-token');
    expect(() => bridge.sendInit()).toThrow('stopped');
    expect(() => bridge.stop()).not.toThrow();
  });

  it('child clears authority and becomes terminal even when onStop throws', () => {
    let receive: ((event: unknown) => void) | undefined;
    const window = {
      addEventListener: vi.fn((_type, listener) => {
        receive = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const sandbox = vm.createContext({ window });
    vm.runInContext(
      fs.readFileSync(
        new URL('../../../../../infra/scratch-editor/host/protocol.js', import.meta.url),
        'utf8',
      ),
      sandbox,
    );
    const parent = {};
    const protocol = sandbox['AsaBlocksProtocol'].createChildProtocol({
      parentWindow: parent,
      expectedParentOrigin: origin,
      onStop() {
        throw new Error('stop callback failed');
      },
    });
    protocol.start();
    const binding = { protocolVersion: 1, projectId, sessionNonce: 'fixture-nonce' };
    const send = (data: unknown) => receive?.({ source: parent, origin, data });
    send({
      ...binding,
      messageType: 'ASA_BLOCKS_INIT',
      mode: 'editor',
      runtimeToken: 'fixture-token',
    });
    expect(protocol.getRuntimeToken()).toBe('fixture-token');
    expect(() => send({ ...binding, messageType: 'ASA_BLOCKS_STOP' })).toThrow(
      'stop callback failed',
    );
    expect(protocol.getRuntimeToken()).toBeNull();
    expect(protocol.getBinding()).toBeNull();
    send({ ...binding, messageType: 'ASA_BLOCKS_INIT', mode: 'editor', runtimeToken: 'replay' });
    expect(protocol.isInitialized()).toBe(false);
    protocol.dispose();
    expect(window.removeEventListener).toHaveBeenCalledWith('message', receive);
  });
});
