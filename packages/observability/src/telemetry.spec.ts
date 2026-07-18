import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTelemetry, planTelemetry, type TelemetryFactories } from './index';

const OTEL_ENV_KEYS = [
  'OTEL_TRACES_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
];

afterEach(() => {
  for (const key of OTEL_ENV_KEYS) {
    delete process.env[key];
  }
  vi.restoreAllMocks();
});

/** Factory spy: proves whether the SDK/exporter constructor path is reached. */
function spyFactories(): { factories: TelemetryFactories; createSdk: ReturnType<typeof vi.fn> } {
  const sdk = { start: vi.fn(), shutdown: vi.fn(async () => {}) };
  const createSdk = vi.fn(() => sdk);
  return { factories: { createSdk }, createSdk };
}

describe('telemetry plan and endpoint validation', () => {
  it('disabled mode never exports over the network', () => {
    const plan = planTelemetry({ serviceName: 'asa-lab-api', mode: 'disabled' });
    expect(plan.networkExport).toBe(false);
    expect(plan.otlpEndpoint).toBeNull();
  });

  it('requires a service name', () => {
    expect(() => planTelemetry({ serviceName: '  ', mode: 'disabled' })).toThrow(/serviceName/);
  });

  it('rejects otlp mode without an endpoint', () => {
    expect(() => planTelemetry({ serviceName: 'x', mode: 'otlp' })).toThrow(
      /requires an otlpEndpoint/,
    );
  });

  it('rejects an invalid endpoint URL', () => {
    expect(() =>
      planTelemetry({ serviceName: 'x', mode: 'otlp', otlpEndpoint: 'not a url' }),
    ).toThrow(/invalid OTLP endpoint URL/);
  });

  it('rejects a non-http/https protocol', () => {
    expect(() =>
      planTelemetry({ serviceName: 'x', mode: 'otlp', otlpEndpoint: 'grpc://host:4317' }),
    ).toThrow(/unsupported OTLP endpoint protocol/);
  });

  it('rejects an endpoint that carries credentials', () => {
    expect(() =>
      planTelemetry({ serviceName: 'x', mode: 'otlp', otlpEndpoint: 'http://user:pass@host:4318' }),
    ).toThrow(/must not contain credentials/);
  });

  it('accepts a valid http endpoint', () => {
    const plan = planTelemetry({
      serviceName: 'x',
      mode: 'otlp',
      otlpEndpoint: 'http://collector:4318/v1/traces',
    });
    expect(plan.networkExport).toBe(true);
    expect(plan.otlpEndpoint).toBe('http://collector:4318/v1/traces');
  });
});

describe('disabled mode constructs no SDK/exporter', () => {
  it('does not call the SDK factory in disabled mode', () => {
    const { factories, createSdk } = spyFactories();
    const telemetry = createTelemetry({ serviceName: 'asa-lab', mode: 'disabled' }, factories);
    telemetry.start();
    expect(createSdk).not.toHaveBeenCalled();
    expect(telemetry.mode).toBe('disabled');
    expect(telemetry.networkExport).toBe(false);
  });

  it('ignores ambient OTEL_* variables in disabled mode', () => {
    process.env['OTEL_TRACES_EXPORTER'] = 'otlp';
    process.env['OTEL_LOGS_EXPORTER'] = 'otlp';
    process.env['OTEL_METRICS_EXPORTER'] = 'otlp';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://should-not-be-used:4318';
    const { factories, createSdk } = spyFactories();
    const telemetry = createTelemetry({ serviceName: 'asa-lab', mode: 'disabled' }, factories);
    telemetry.start();
    expect(createSdk).not.toHaveBeenCalled();
    expect(telemetry.networkExport).toBe(false);
  });

  it('has idempotent no-op start and shutdown', async () => {
    const telemetry = createTelemetry({ serviceName: 'asa-lab', mode: 'disabled' });
    telemetry.start();
    telemetry.start();
    await telemetry.shutdown();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe('otlp mode constructs the SDK via the factory', () => {
  it('calls the SDK factory once and delegates lifecycle', async () => {
    const { factories, createSdk } = spyFactories();
    const telemetry = createTelemetry(
      { serviceName: 'asa-lab', mode: 'otlp', otlpEndpoint: 'http://collector:4318' },
      factories,
    );
    expect(createSdk).toHaveBeenCalledTimes(1);
    expect(telemetry.mode).toBe('otlp');
    expect(telemetry.networkExport).toBe(true);
    telemetry.start();
    await telemetry.shutdown();
    expect(createSdk.mock.results[0]?.value.start).toHaveBeenCalledTimes(1);
    expect(createSdk.mock.results[0]?.value.shutdown).toHaveBeenCalledTimes(1);
  });
});
