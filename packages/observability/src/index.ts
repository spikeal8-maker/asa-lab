/** Foundation surface for the observability package: request/trace context and
 * an explicit, safe-by-default OpenTelemetry NodeSDK bootstrap. */
import { trace, type Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export const PACKAGE_NAME = '@asa-lab/observability';

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
    if (!/^https?:\/\//u.test(options.otlpEndpoint)) {
      throw new Error(
        `telemetry: unsupported OTLP endpoint protocol (expected http/https): ${options.otlpEndpoint}`,
      );
    }
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

/**
 * Create an OpenTelemetry NodeSDK with an explicit, safe-by-default
 * configuration.
 *
 * - `disabled` (default use): span processors are set explicitly to an empty
 *   list, so no exporter is created and no data leaves the process — the SDK
 *   never falls back to an implicit OTLP exporter from the environment.
 * - `otlp`: an OTLP/HTTP trace exporter is created explicitly against the
 *   required endpoint. Only http/https endpoints are accepted.
 *
 * The service name is passed through the NodeSDK API, not by mutating
 * `process.env`.
 */
export function createTelemetry(options: TelemetryOptions): TelemetryHandle {
  const plan = planTelemetry(options);

  const sdk =
    plan.mode === 'otlp' && plan.otlpEndpoint !== null
      ? new NodeSDK({
          serviceName: plan.serviceName,
          autoDetectResources: false,
          traceExporter: new OTLPTraceExporter({ url: plan.otlpEndpoint }),
        })
      : new NodeSDK({
          serviceName: plan.serviceName,
          autoDetectResources: false,
          spanProcessors: [],
        });

  let started = false;
  return {
    mode: plan.mode,
    networkExport: plan.networkExport,
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
