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

function makeBridge(target = makeTarget(), onFatal = vi.fn(), onMessage = vi.fn()) {
  return {
    target,
    onFatal,
    onMessage,
    bridge: new BlocksRuntimeBridge({
      childWindow: target,
      runtimeOrigin: RUNTIME_ORIGIN,
      projectId: PROJECT_ID,
      mode: 'editor',
      versionId: null,
      apiOrigin: API_ORIGIN,
      runtimeToken: 'fixture-token',
      draftRevision: 12,
      projectJson: { targets: [], monitors: [], extensions: [] },
      hasProjectJson: true,
      assets: [],
      recoveryPrincipalKey: '33333333-3333-4333-8333-333333333333',
      onMessage,
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
      draftRevision: 12,
      projectJson: { targets: [], monitors: [], extensions: [] },
      hasProjectJson: true,
    });
  });

  it('binds token updates to the same project and nonce', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const { bridge, target } = makeBridge();
    bridge.updateToken('rotated-fixture-token');

    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(target.postMessage.mock.calls[0][0]).toMatchObject({
      messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
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

  it('accepts bounded project-dirty generation and rejects malformed dirty payloads', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'abababab-abab-4bab-8bab-abababababab' });
    const { bridge, target, onMessage } = makeBridge();
    const base = {
      protocolVersion: BLOCKS_PROTOCOL_VERSION,
      messageType: 'ASA_BLOCKS_STATUS',
      projectId: PROJECT_ID,
      sessionNonce: bridge.sessionNonce,
      status: 'project-dirty',
    };

    expect(
      bridge.acceptChildMessage({
        source: target,
        origin: RUNTIME_ORIGIN,
        data: { ...base, generation: 4 },
      }),
    ).toBe(true);
    expect(onMessage).toHaveBeenLastCalledWith({ ...base, generation: 4 });

    for (const generation of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '4']) {
      expect(
        bridge.acceptChildMessage({
          source: target,
          origin: RUNTIME_ORIGIN,
          data: { ...base, generation },
        }),
      ).toBe(false);
    }
    expect(
      bridge.acceptChildMessage({
        source: {},
        origin: RUNTIME_ORIGIN,
        data: { ...base, generation: 5 },
      }),
    ).toBe(false);
    expect(
      bridge.acceptChildMessage({
        source: target,
        origin: 'http://evil.test',
        data: { ...base, generation: 5 },
      }),
    ).toBe(false);
  });

  it('accepts only bounded trusted thumbnail messages with a confirmed source revision', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd' });
    const { bridge, target, onMessage } = makeBridge();
    const base = {
      protocolVersion: BLOCKS_PROTOCOL_VERSION,
      messageType: 'ASA_BLOCKS_THUMBNAIL_READY',
      projectId: PROJECT_ID,
      sessionNonce: bridge.sessionNonce,
    };
    const valid = {
      ...base,
      sourceRevision: 13,
      imageDataUrl: 'data:image/png;base64,AAAA',
    };

    expect(bridge.acceptChildMessage({ source: target, origin: RUNTIME_ORIGIN, data: valid })).toBe(
      true,
    );
    expect(onMessage).toHaveBeenLastCalledWith(valid);

    for (const data of [
      { ...base, sourceRevision: 0, imageDataUrl: 'data:image/png;base64,AAAA' },
      { ...base, sourceRevision: '13', imageDataUrl: 'data:image/png;base64,AAAA' },
      { ...base, sourceRevision: 13, imageDataUrl: 'data:image/svg+xml;base64,AAAA' },
      { ...base, sourceRevision: 13, imageDataUrl: 'data:image/png;base64,not base64' },
      {
        ...base,
        sourceRevision: 13,
        imageDataUrl: `data:image/png;base64,${'A'.repeat(349_600)}`,
      },
    ]) {
      expect(bridge.acceptChildMessage({ source: target, origin: RUNTIME_ORIGIN, data })).toBe(
        false,
      );
    }
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

  it('becomes terminal after STOP and cannot restore retained authority', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    const { bridge, target } = makeBridge();
    bridge.stop();

    expect(target.postMessage).toHaveBeenCalledTimes(1);
    expect(target.postMessage.mock.calls[0][0]).toMatchObject({
      messageType: 'ASA_BLOCKS_STOP',
      projectId: PROJECT_ID,
      sessionNonce: bridge.sessionNonce,
    });
    expect(JSON.stringify(bridge)).not.toContain('fixture-token');

    expect(() => bridge.sendInit()).toThrow('Blocks runtime bridge is stopped');
    expect(() => bridge.updateToken('stale-token')).toThrow('Blocks runtime bridge is stopped');
    bridge.stop();
    expect(target.postMessage).toHaveBeenCalledTimes(1);

    expect(
      bridge.acceptChildMessage({
        source: target,
        origin: RUNTIME_ORIGIN,
        data: {
          protocolVersion: BLOCKS_PROTOCOL_VERSION,
          messageType: 'ASA_BLOCKS_STATUS',
          projectId: PROJECT_ID,
          sessionNonce: bridge.sessionNonce,
          status: 'ready-after-reload',
        },
      }),
    ).toBe(false);
  });
});
