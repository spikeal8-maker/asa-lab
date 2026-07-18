import { describe, it, expect, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { launch } from './launcher';
import { buildApp } from './app';

describe('api launcher wires telemetry together with Fastify', () => {
  it('starts telemetry before the app and stops both (idempotent)', async () => {
    const order: string[] = [];
    const telemetry = {
      start: vi.fn(() => {
        order.push('telemetry.start');
      }),
      shutdown: vi.fn(async () => {
        order.push('telemetry.shutdown');
      }),
    };
    const loadApp = vi.fn(async () => {
      order.push('loadApp');
      return { buildApp };
    });

    const server = await launch({ telemetry, loadApp, host: '127.0.0.1', port: 0 });

    expect(telemetry.start).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('telemetry.start');
    expect(order.indexOf('telemetry.start')).toBeLessThan(order.indexOf('loadApp'));

    const address = server.app.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/health/live`);
    expect(response.status).toBe(200);

    await server.stop();
    expect(telemetry.shutdown).toHaveBeenCalledTimes(1);

    await server.stop(); // idempotent
    expect(telemetry.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shuts telemetry down when startup fails', async () => {
    const telemetry = {
      start: vi.fn(),
      shutdown: vi.fn(async () => {}),
    };
    const loadApp = async (): Promise<{ buildApp: typeof buildApp }> => {
      throw new Error('boom');
    };

    await expect(launch({ telemetry, loadApp, host: '127.0.0.1', port: 0 })).rejects.toThrow(
      'boom',
    );
    expect(telemetry.start).toHaveBeenCalledTimes(1);
    expect(telemetry.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shuts telemetry down once even if closing Fastify fails, without swallowing the error', async () => {
    const telemetry = {
      start: vi.fn(),
      shutdown: vi.fn(async () => {}),
    };
    const server = await launch({
      telemetry,
      loadApp: async () => ({ buildApp }),
      host: '127.0.0.1',
      port: 0,
    });

    const closeSpy = vi.spyOn(server.app, 'close').mockRejectedValue(new Error('close-fail'));

    await expect(server.stop()).rejects.toThrow('close-fail');
    expect(telemetry.shutdown).toHaveBeenCalledTimes(1);

    // Idempotent: a second stop does nothing more.
    await expect(server.stop()).resolves.toBeUndefined();
    expect(telemetry.shutdown).toHaveBeenCalledTimes(1);

    // Real cleanup so the listening port is released.
    closeSpy.mockRestore();
    await server.app.close();
  });
});
