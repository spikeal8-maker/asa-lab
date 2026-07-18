/** Foundation surface for the observability package: request/trace context and
 * an OpenTelemetry bootstrap that never carries personal data. */
import { trace, type Tracer } from '@opentelemetry/api';

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
