import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { TelemetryLifecycle } from './runtime.js';
import { launchApiRuntime, type ApiApplication } from './runtime.js';

function fakeTelemetry(events: string[]): TelemetryLifecycle {
  return {
    start: vi.fn(() => events.push('telemetry:start')),
    shutdown: vi.fn(async () => {
      events.push('telemetry:shutdown');
    }),
  };
}

function fakeApp(events: string[], closeError?: Error): ApiApplication {
  return {
    listen: vi.fn(async () => {
      events.push('app:listen');
    }),
    close: vi.fn(async () => {
      events.push('app:close');
      if (closeError) throw closeError;
    }),
  };
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP loopback port');
  }
  return address.port;
}

describe('API runtime lifecycle', () => {
  it('trusts the actual listener port instead of a stale API_PORT origin', async () => {
    const port = await availableLoopbackPort();
    expect(port).not.toBe(4611);
    vi.stubEnv('ASA_WEB_PORT', '4610');
    vi.stubEnv('ASA_WEB_ORIGIN', 'http://127.0.0.1:4610');
    vi.stubEnv('API_PORT', '4611');

    try {
      const runtime = await launchApiRuntime({ port, telemetry: fakeTelemetry([]) });
      try {
        const post = (origin: string) =>
          fetch(`http://127.0.0.1:${port}/api/auth/login`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: '{}',
          });
        expect((await post(`http://127.0.0.1:${port}`)).status).toBe(400);
        expect((await post('http://127.0.0.1:4611')).status).toBe(403);
        expect((await post('http://127.0.0.1:4610')).status).toBe(400);
      } finally {
        await runtime.stop();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts telemetry before creating/listening to the app', async () => {
    const events: string[] = [];
    const app = fakeApp(events);
    const runtime = await launchApiRuntime({
      telemetry: fakeTelemetry(events),
      createApp: async () => {
        events.push('app:create');
        return app;
      },
    });
    expect(events).toEqual(['telemetry:start', 'app:create', 'app:listen']);
    await runtime.stop();
  });

  it('shuts telemetry down when application creation fails', async () => {
    const events: string[] = [];
    await expect(
      launchApiRuntime({
        telemetry: fakeTelemetry(events),
        createApp: async () => {
          events.push('app:create');
          throw new Error('startup failed');
        },
      }),
    ).rejects.toThrow('startup failed');
    expect(events).toEqual(['telemetry:start', 'app:create', 'telemetry:shutdown']);
  });

  it('closes a created app and telemetry when listen fails', async () => {
    const events: string[] = [];
    const app: ApiApplication = {
      listen: vi.fn(async () => {
        events.push('app:listen');
        throw new Error('port unavailable');
      }),
      close: vi.fn(async () => {
        events.push('app:close');
      }),
    };
    await expect(
      launchApiRuntime({ telemetry: fakeTelemetry(events), createApp: async () => app }),
    ).rejects.toThrow('port unavailable');
    expect(events).toEqual(['telemetry:start', 'app:listen', 'app:close', 'telemetry:shutdown']);
  });

  it('preserves startup and cleanup errors when both fail', async () => {
    const events: string[] = [];
    const app: ApiApplication = {
      listen: vi.fn(async () => {
        events.push('app:listen');
        throw new Error('listen failed');
      }),
      close: vi.fn(async () => {
        events.push('app:close');
        throw new Error('cleanup failed');
      }),
    };

    let thrown: unknown;
    try {
      await launchApiRuntime({ telemetry: fakeTelemetry(events), createApp: async () => app });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors.map((error) => String(error))).toEqual([
      'Error: listen failed',
      'Error: cleanup failed',
    ]);
    expect(events).toEqual(['telemetry:start', 'app:listen', 'app:close', 'telemetry:shutdown']);
  });

  it('is idempotent and always shuts telemetry down even if app.close fails', async () => {
    const events: string[] = [];
    const app = fakeApp(events, new Error('close failed'));
    const telemetry = fakeTelemetry(events);
    const runtime = await launchApiRuntime({ telemetry, createApp: async () => app });

    const first = runtime.stop('SIGTERM');
    const second = runtime.stop('SIGINT');
    expect(first).toBe(second);
    await expect(first).rejects.toThrow('close failed');
    expect(events.filter((event) => event === 'app:close')).toHaveLength(1);
    expect(events.filter((event) => event === 'telemetry:shutdown')).toHaveLength(1);
  });
});
