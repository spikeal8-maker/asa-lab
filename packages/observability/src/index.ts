/** Foundation surface for the observability package: request/trace context and
 * a real, minimal OpenTelemetry NodeSDK bootstrap that never carries personal
 * data. */
import { trace, type Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';

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
 * permitted on spans, metrics and logs.
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

export interface TelemetryHandle {
  start(): void;
  shutdown(): Promise<void>;
}

/**
 * Create a real OpenTelemetry NodeSDK bootstrap.
 *
 * No exporter is configured by default, so telemetry stays in-process and no
 * data — and no personal data in particular — leaves the machine. An OTLP
 * exporter is wired only when operators explicitly configure one. The service
 * name is a technical identifier and never a personal attribute.
 */
export function createTelemetry(serviceName = 'asa-lab'): TelemetryHandle {
  if (!process.env['OTEL_SERVICE_NAME']) {
    process.env['OTEL_SERVICE_NAME'] = serviceName;
  }
  const sdk = new NodeSDK({});
  let started = false;
  return {
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
