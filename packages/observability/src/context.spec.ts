import { describe, it, expect } from 'vitest';
import { createRequestContext, ALLOWED_TELEMETRY_ATTRIBUTES } from './index';

describe('observability request context', () => {
  it('defaults the technical tenant to null', () => {
    const context = createRequestContext({ requestId: 'r1', traceId: 't1' });
    expect(context.technicalTenantId).toBeNull();
  });

  it('keeps supplied technical identifiers', () => {
    const context = createRequestContext({
      requestId: 'r2',
      traceId: 't2',
      technicalTenantId: 'tenant-technical-1',
    });
    expect(context.requestId).toBe('r2');
    expect(context.technicalTenantId).toBe('tenant-technical-1');
  });

  it('never allows personal-data telemetry attributes', () => {
    const joined = ALLOWED_TELEMETRY_ATTRIBUTES.join(',');
    expect(joined).not.toMatch(/email|student|child|password|display.?name/i);
  });
});
