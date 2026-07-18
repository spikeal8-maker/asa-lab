import { describe, it, expect, afterEach } from 'vitest';
import { createTelemetry, planTelemetry } from './index';

const OTEL_ENV_KEYS = ['OTEL_TRACES_EXPORTER', 'OTEL_EXPORTER_OTLP_ENDPOINT'];

afterEach(() => {
  for (const key of OTEL_ENV_KEYS) {
    delete process.env[key];
  }
});

describe('telemetry plan (safe by default)', () => {
  it('disabled mode never exports over the network', () => {
    const plan = planTelemetry({ serviceName: 'asa-lab-api', mode: 'disabled' });
    expect(plan.networkExport).toBe(false);
    expect(plan.otlpEndpoint).toBeNull();
  });

  it('ignores ambient OTEL_* variables in disabled mode', () => {
    process.env['OTEL_TRACES_EXPORTER'] = 'otlp';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://should-not-be-used:4318';
    const plan = planTelemetry({ serviceName: 'asa-lab-api', mode: 'disabled' });
    expect(plan.networkExport).toBe(false);
    expect(plan.otlpEndpoint).toBeNull();
  });

  it('rejects otlp mode without an endpoint', () => {
    expect(() => planTelemetry({ serviceName: 'asa-lab-api', mode: 'otlp' })).toThrow(
      /requires an otlpEndpoint/,
    );
  });

  it('rejects an unsupported otlp endpoint protocol', () => {
    expect(() =>
      planTelemetry({ serviceName: 'asa-lab-api', mode: 'otlp', otlpEndpoint: 'grpc://x:4317' }),
    ).toThrow(/unsupported OTLP endpoint protocol/);
  });

  it('requires a service name', () => {
    expect(() => planTelemetry({ serviceName: '  ', mode: 'disabled' })).toThrow(/serviceName/);
  });
});

describe('telemetry handle (disabled) lifecycle', () => {
  it('creates a disabled, non-networked SDK', () => {
    const telemetry = createTelemetry({ serviceName: 'asa-lab-test', mode: 'disabled' });
    expect(telemetry.mode).toBe('disabled');
    expect(telemetry.networkExport).toBe(false);
  });

  it('starts once and shuts down once, idempotently', async () => {
    const telemetry = createTelemetry({ serviceName: 'asa-lab-test', mode: 'disabled' });
    telemetry.start();
    telemetry.start(); // second call is a no-op
    await telemetry.shutdown();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});
