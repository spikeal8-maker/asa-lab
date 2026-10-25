import { describe, expect, it } from 'vitest';
import { AuthRequestError } from './auth-request';
import { requestFailureKind, requestMethod, requestOperation } from './request-diagnostic-details';

describe('bounded request classifications', () => {
  it.each([
    ['/api/auth/me', 'GET', 'electronics', 'auth_me'],
    ['/api/auth/refresh', 'POST', 'electronics', 'auth_refresh'],
    ['/api/projects/private-user', 'GET', 'portal', 'project_read'],
    ['/api/projects/private-user', 'GET', 'electronics', 'electronics_draft_read'],
    ['/api/projects/private-user/draft', 'PUT', 'electronics', 'electronics_draft_write'],
    ['/api/projects/private-user/draft', 'PUT', 'scratch', 'project_save'],
    [
      '/api/projects/private-user/blocks/runtime-session',
      'POST',
      'scratch',
      'blocks_runtime_session',
    ],
    ['/api/private-token', 'GET', 'electronics', 'other_api'],
  ])('maps %s to a fixed operation', (path, method, module, operation) => {
    expect(requestOperation(path, method, module)).toBe(operation);
  });
  it('normalizes methods and distinguishes confirmed aborts from ambiguous failures', () => {
    expect(requestMethod('patch')).toBe('PATCH');
    expect(requestMethod('private')).toBe('OTHER');
    const signal = new AbortController();
    const timeout = new AuthRequestError('auth_timeout');
    signal.abort(timeout);
    expect(requestFailureKind(timeout, signal.signal)).toBe('timeout');
    expect(requestFailureKind(new TypeError('private'), signal.signal)).toBe('unknown');
    const cancel = new AbortController();
    cancel.abort(new AuthRequestError('auth_cancelled'));
    expect(requestFailureKind(cancel.signal.reason, cancel.signal)).toBe('cancelled');
    expect(requestFailureKind(new DOMException('private', 'AbortError'))).toBe('unknown');
    expect(requestFailureKind(new TypeError('private'))).toBe('network');
  });
});
