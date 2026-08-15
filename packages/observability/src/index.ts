/** Foundation surface for the observability package: request/trace context and
 * an explicit, safe-by-default OpenTelemetry NodeSDK bootstrap. */
import { trace, type Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export const PACKAGE_NAME = '@asa-lab/observability';

export {
  createRuntimeMetrics,
  type PoolStats,
  type RuntimeMetrics,
  type RuntimeMetricsSnapshot,
} from './runtime-metrics.js';

/**
 * Technical request context. It intentionally carries only technical
 * identifiers and never child PII, project content or open student codes.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly technicalTenantId: string | null;
}

export function createRequestContext(input: {
  requestId: string;
  traceId: string;
  technicalTenantId?: string | null;
}): RequestContext {
  return {
    requestId: input.requestId,
    traceId: input.traceId,
    technicalTenantId: input.technicalTenantId ?? null,
  };
}

/**
 * Telemetry attribute allowlist. Only technical, non-personal attributes are
 * permitted on spans, metrics and logs. Project content, source code, student
 * codes, comments, tokens and signed URLs must never be added as attributes.
 */
export const ALLOWED_TELEMETRY_ATTRIBUTES = [
  'operation',
  'request.id',
  'tenant.technical_id',
  'http.status_code',
] as const;

export function getTracer(name = 'asa-lab'): Tracer {
  return trace.getTracer(name);
}

export type TelemetryMode = 'disabled' | 'otlp';

export interface TelemetryOptions {
  readonly serviceName: string;
  readonly mode: TelemetryMode;
  readonly otlpEndpoint?: string;
}

export interface TelemetryPlan {
  readonly serviceName: string;
  readonly mode: TelemetryMode;
  readonly networkExport: boolean;
  readonly otlpEndpoint: string | null;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertValidOtlpEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`telemetry: invalid OTLP endpoint URL: ${endpoint}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `telemetry: unsupported OTLP endpoint protocol (expected http/https): ${endpoint}`,
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('telemetry: OTLP endpoint must not contain credentials');
  }
}

/**
 * Resolve an explicit telemetry plan from options only. This never reads
 * ambient OTEL_* environment variables, so external configuration can never
 * silently enable network export. Invalid or incomplete configuration fails.
 */
export function planTelemetry(options: TelemetryOptions): TelemetryPlan {
  if (!isNonEmpty(options.serviceName)) {
    throw new Error('telemetry: serviceName is required');
  }
  if (options.mode === 'disabled') {
    return {
      serviceName: options.serviceName,
      mode: 'disabled',
      networkExport: false,
      otlpEndpoint: null,
    };
  }
  if (options.mode === 'otlp') {
    if (!isNonEmpty(options.otlpEndpoint)) {
      throw new Error('telemetry: otlp mode requires an otlpEndpoint');
    }
    assertValidOtlpEndpoint(options.otlpEndpoint);
    return {
      serviceName: options.serviceName,
      mode: 'otlp',
      networkExport: true,
      otlpEndpoint: options.otlpEndpoint,
    };
  }
  throw new Error(`telemetry: unsupported mode: ${String(options.mode)}`);
}

export interface TelemetryHandle {
  readonly mode: TelemetryMode;
  readonly networkExport: boolean;
  start(): void;
  shutdown(): Promise<void>;
}

/** Minimal SDK surface used by the handle; lets tests inject a factory. */
export interface TelemetrySdk {
  start(): void;
  shutdown(): Promise<void>;
}

export interface TelemetryFactories {
  /** Construct the real SDK. Only ever called for `otlp` mode. */
  createSdk(plan: TelemetryPlan): TelemetrySdk;
}

function defaultCreateSdk(plan: TelemetryPlan): TelemetrySdk {
  // Reached only for otlp mode (endpoint already validated and non-null).
  const exporter = new OTLPTraceExporter(
    plan.otlpEndpoint !== null ? { url: plan.otlpEndpoint } : {},
  );
  const sdk = new NodeSDK({
    serviceName: plan.serviceName,
    autoDetectResources: false,
    traceExporter: exporter,
  });
  return {
    start: (): void => sdk.start(),
    shutdown: (): Promise<void> => sdk.shutdown(),
  };
}

export const DEFAULT_TELEMETRY_FACTORIES: TelemetryFactories = {
  createSdk: defaultCreateSdk,
};

/**
 * Create a telemetry handle with an explicit, safe-by-default configuration.
 *
 * - `disabled` (default use): a pure no-op handle. No NodeSDK, exporter,
 *   provider or resource detector is constructed, no OTEL_* variable is read
 *   and no network connection is possible.
 * - `otlp`: an OTLP/HTTP trace exporter and NodeSDK are constructed explicitly
 *   against a validated http/https endpoint.
 *
 * A factory seam allows tests to prove that no SDK/exporter is constructed in
 * disabled mode.
 */
export function createTelemetry(
  options: TelemetryOptions,
  factories: TelemetryFactories = DEFAULT_TELEMETRY_FACTORIES,
): TelemetryHandle {
  const plan = planTelemetry(options);

  if (plan.mode === 'disabled') {
    // Pure no-op handle: nothing is constructed and there is no state to track.
    return {
      mode: 'disabled',
      networkExport: false,
      start: (): void => undefined,
      shutdown: (): Promise<void> => Promise.resolve(),
    };
  }

  const sdk = factories.createSdk(plan);
  let started = false;
  return {
    mode: 'otlp',
    networkExport: true,
    start: (): void => {
      if (!started) {
        sdk.start();
        started = true;
      }
    },
    shutdown: async (): Promise<void> => {
      if (started) {
        await sdk.shutdown();
        started = false;
      }
    },
  };
}
