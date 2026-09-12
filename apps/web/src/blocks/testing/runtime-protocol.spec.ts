import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlocksRuntimeBridge, BLOCKS_PROTOCOL_VERSION } from '../runtime-protocol';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_ORIGIN = 'http://127.0.0.1:4613';
const API_ORIGIN = 'http://127.0.0.1:4612';

function makeTarget() {
  return {
    postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>(),
  };
}

function makeBridge(target = makeTarget(), onFatal = vi.fn()) {
  return {
    target,
    onFatal,
    bridge: new BlocksRuntimeBridge({
      childWindow: target,
      runtimeOrigin: RUNTIME_ORIGIN,
      projectId: PROJECT_ID,
      mode: 'editor',
      versionId: null,
      apiOrigin: API_ORIGIN,
      runtimeToken: 'fixture-token',
      draftRevision: 12,
      hasProjectJson: true,
      assets: [],
      recoveryNamespace: 'fixture-recovery',
      onFatal,
    }),
  };
}
describe('BlocksRuntimeBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends INIT only to the exact configured runtime origin', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const { bridge, target } = makeBridge();

    bridge.sendInit();

    expect(target.postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = target.postMessage.mock.calls[0];
    expect(targetOrigin).toBe(RUNTIME_ORIGIN);
    expect(targetOrigin).not.toBe('*');
    expect(message).toMatchObject({
      protocolVersion: BLOCKS_PROTOCOL_VERSION,
      messageType: 'ASA_BLOCKS_INIT',
      projectId: PROJECT_ID,
      sessionNonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runtimeToken: 'fixture-token',
    });
  });

  it('binds token update and flush requests to the same project and nonce', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const { bridge, target } = makeBridge();
    bridge.updateToken('rotated-fixture-token');
    bridge.requestFlush('flush-1');

    expect(target.postMessage.mock.calls[0][0]).toMatchObject({
      messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
      projectId: PROJECT_ID,
      sessionNonce: bridge.sessionNonce,
    });
    expect(target.postMessage.mock.calls[1][0]).toMatchObject({
      messageType: 'ASA_BLOCKS_FLUSH_REQUEST',
      requestId: 'flush-1',
      projectId: PROJECT_ID,
      sessionNonce: bridge.sessionNonce,
    });
  });
  it('rejects child messages with wrong source, origin, project, nonce or protocol', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    const { bridge, target } = makeBridge();
    const valid = {
      protocolVersion: BLOCKS_PROTOCOL_VERSION,
      messageType: 'ASA_BLOCKS_STATUS',
      projectId: PROJECT_ID,
      sessionNonce: bridge.sessionNonce,
      status: 'ready',
    };

    expect(bridge.acceptChildMessage({ source: {}, origin: RUNTIME_ORIGIN, data: valid })).toBe(
      false,
    );
    expect(
      bridge.acceptChildMessage({ source: target, origin: 'http://evil.test', data: valid }),
    ).toBe(false);
    expect(
      bridge.acceptChildMessage({
        source: target,
        origin: RUNTIME_ORIGIN,
        data: { ...valid, projectId: '22222222-2222-4222-8222-222222222222' },
      }),
    ).toBe(false);
    expect(
      bridge.acceptChildMessage({
        source: target,
        origin: RUNTIME_ORIGIN,
        data: { ...valid, sessionNonce: 'wrong' },
      }),
    ).toBe(false);
    expect(
      bridge.acceptChildMessage({
        source: target,
        origin: RUNTIME_ORIGIN,
        data: { ...valid, protocolVersion: 2 },
      }),
    ).toBe(false);
  });

  it('accepts a bound FATAL message without throwing in the parent bridge', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    const { bridge, target, onFatal } = makeBridge();
    const message = {
      protocolVersion: BLOCKS_PROTOCOL_VERSION,
      messageType: 'ASA_BLOCKS_FATAL',
      projectId: PROJECT_ID,
      sessionNonce: bridge.sessionNonce,
      code: 'runtime_error',
    };

    expect(
      bridge.acceptChildMessage({ source: target, origin: RUNTIME_ORIGIN, data: message }),
    ).toBe(true);
    expect(onFatal).toHaveBeenCalledWith(message);
  });
});
