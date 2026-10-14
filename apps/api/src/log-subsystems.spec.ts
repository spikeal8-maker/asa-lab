import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ANALYTICS_MODULES } from './analytics-envelope.js';
import { logEditorModule, logModule, logSubsystem } from './log-subsystems.js';
import { recordServerFailure } from './server-diagnostics.js';
import { logFilter } from './admin-logs.controller.js';

describe('editor log classification contract', () => {
  it('recognizes the real module registry names and keeps source and route authority', () => {
    expect(ANALYTICS_MODULES.map(logEditorModule).sort()).toEqual(
      ['scratch', 'electronics', 'three-d', 'chess', 'checkers'].sort(),
    );
    for (const reported of ANALYTICS_MODULES) {
      const module = reported === 'blocks' ? 'scratch' : reported;
      expect(logSubsystem('api', '', '', 'client_diagnostic', reported)).toBe(module);
      expect(
        logSubsystem('api', `/api/${reported}/fixture`, '', 'client_diagnostic', 'electronics'),
      ).toBe(module);
      expect(logModule('api', module, 'electronics', 'portal')).toBe(module);
      expect(logFilter({ module: reported }).module).toBe(module);
    }
    expect(logSubsystem('api', '/api/projects/fixture', '', 'http_response', 'chess')).toBe(
      'projects',
    );
    expect(logSubsystem('api', '', '', 'client_diagnostic', 'unknown')).toBe('api');
    expect(() => logFilter({ module: 'unknown' })).toThrow();
    expect(logSubsystem('linux:journal', '/api/chess', '', 'client_diagnostic', 'chess')).toBe(
      'host',
    );
    expect(logModule('linux:journal', 'chess', 'chess')).toBe('system');
    expect(logSubsystem('scratch', '/api/chess', '', 'client_diagnostic', 'chess')).toBe('scratch');
    expect(logModule('scratch', 'chess', 'chess')).toBe('scratch');
  });
  it('classifies stdout from the actual server error producer for all five route names', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      for (const [index, route] of ANALYTICS_MODULES.entries()) {
        const request = {
          id: String(index),
          method: 'GET',
          headers: {},
          raw: { url: `/api/${route}/fixture?secret=private` },
        } as FastifyRequest;
        recordServerFailure(new Error('synthetic failure'), request, 500, 'abcdef0', null);
      }
      const rows = out.mock.calls.map((call) => JSON.parse(String(call[0])));
      expect(rows).toHaveLength(5);
      expect(rows.map((row) => row.subsystem)).toEqual(ANALYTICS_MODULES.map(logEditorModule));
      for (const row of rows) {
        expect(row.kind).toBe('server_error');
        expect(row.level).toBe('error');
        expect(JSON.stringify(row)).not.toContain('private');
      }
    } finally {
      out.mockRestore();
    }
  });
});
