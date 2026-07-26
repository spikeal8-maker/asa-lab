import { describe, expect, it, vi } from 'vitest';
import type { TelemetryHandle } from '@asa-lab/observability';
import { launchApiRuntime, type ApiApplication } from './runtime.js';

function fakeTelemetry(events: string[]): TelemetryHandle {
  return {
    mode: 'disabled',
    networkExport: false,
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

describe('API runtime lifecycle', () => {
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
