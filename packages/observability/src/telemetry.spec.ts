import { describe, it, expect } from 'vitest';
import { createTelemetry } from './index';

describe('observability telemetry bootstrap', () => {
  it('starts and shuts down a real NodeSDK without an external exporter', async () => {
    const telemetry = createTelemetry('asa-lab-test');
    expect(() => telemetry.start()).not.toThrow();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('is idempotent on repeated shutdown', async () => {
    const telemetry = createTelemetry('asa-lab-test');
    telemetry.start();
    await telemetry.shutdown();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});
