# observability

Request/trace context and an explicit, safe-by-default OpenTelemetry NodeSDK
bootstrap.

## Telemetry modes

```ts
createTelemetry({ serviceName, mode: 'disabled' | 'otlp', otlpEndpoint? });
```

- **Exporter is disabled by default.** In `disabled` mode span processors are
  set explicitly to an empty list, so no exporter is created and no traces,
  metrics or logs leave the process. The SDK never falls back to an implicit
  OTLP exporter derived from ambient `OTEL_*` environment variables.
- **OTLP export is opt-in only.** It is enabled solely by an explicit ASA Lab
  configuration (`mode: 'otlp'` with a required `http`/`https` `otlpEndpoint`).
  Missing, incomplete or unsupported configuration fails startup rather than
  silently degrading.
- The service name is passed through the NodeSDK API, never by mutating
  `process.env`.

## Allowed telemetry attributes

Only technical, non-personal attributes are permitted (see
`ALLOWED_TELEMETRY_ATTRIBUTES`):

- `operation`
- `request.id`
- `tenant.technical_id`
- `http.status_code`

The following must **never** be attached as attributes, logged or exported:
project content, source code, student codes, comments, tokens, signed URLs, or
any child personal data.

Foundation skeleton (TASK-BOOT-001).
