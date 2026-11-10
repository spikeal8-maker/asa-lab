import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ANALYTICS_MODULES } from './analytics-envelope.js';
import { logEditorModule, logModule, logSubsystem } from './log-subsystems.js';
import { recordServerFailure } from './server-diagnostics.js';
import { logFilter } from './admin-logs.controller.js';

describe('editor log classification contract', () => {
  it.each([
    ['/api/games/chess/tickets?view=1', 'chess'],
    ['/api/games/checkers/tickets', 'checkers'],
    ['/api/ai/chat', 'ai'],
    ['/api/admin/v1/ai/images', 'ai'],
    ['/api/robotics/fixture', 'robotics'],
    ['/api/three-d/fixture', 'three-d'],
  ])('gives %s the trusted route category %s at both HTTP layers', (path, module) => {
    for (const source of ['api', 'web']) {
      const group = logSubsystem(source, path, '', 'http_response', 'electronics');
      expect(group).toBe(module);
      expect(logModule(source, group, 'electronics', 'portal')).toBe(module);
      expect(logFilter({ module, subsystem: module })).toMatchObject({ module, subsystem: module });
    }
    expect(logSubsystem('api', '/api/games/chess-fake')).toBe('api');
    expect(logSubsystem('api', '/api/admin/v1/ai-fake')).toBe('administration');
  });
  it('recognizes the real module registry names and keeps source and route authority', () => {
    expect(ANALYTICS_MODULES.map(logEditorModule).sort()).toEqual(
      ['scratch', 'electronics', 'robotics', 'three-d', 'chess', 'checkers'].sort(),
    );
    for (const reported of ANALYTICS_MODULES) {
      const module = reported === 'blocks' ? 'scratch' : reported;
      expect(logSubsystem('api', '', '', 'client_diagnostic', reported)).toBe(module);
      expect(
        logSubsystem('api', `/api/${reported}/fixture`, '', 'client_diagnostic', 'electronics'),
      ).toBe(module);
      expect(logModule('api', module, 'electronics', 'portal')).toBe(module);
      expect(logFilter({ module: reported, subsystem: module })).toMatchObject({
        module,
        subsystem: module,
      });
    }
    for (const reported of ['chess', 'robotics']) {
      expect(logSubsystem('api', '/api/projects/fixture', '', 'http_response', reported)).toBe(
        'projects',
      );
      expect(
        logSubsystem('linux:journal', `/api/${reported}`, '', 'client_diagnostic', reported),
      ).toBe('host');
      expect(logModule('linux:journal', reported, reported)).toBe('system');
      expect(logSubsystem('scratch', `/api/${reported}`, '', 'client_diagnostic', reported)).toBe(
        'scratch',
      );
      expect(logModule('scratch', reported, reported)).toBe('scratch');
    }
    expect(logSubsystem('api', '', '', 'client_diagnostic', 'unknown')).toBe('api');
    expect(() => logFilter({ module: 'unknown' })).toThrow();
  });
  it.each(['unknown', 'robotics-extra', 'robotics.invalid'])(
    'keeps unregistered module and route %s outside the allowlists',
    (unregistered) => {
      expect(logEditorModule(unregistered)).toBeUndefined();
      expect(
        logSubsystem('api', `/api/${unregistered}/fixture`, '', 'http_response', 'robotics'),
      ).toBe('api');
      expect(() => logFilter({ module: unregistered })).toThrow();
      expect(() => logFilter({ subsystem: unregistered })).toThrow();
    },
  );
  it('classifies stdout from the actual server error producer for all six route names', () => {
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
      expect(rows).toHaveLength(6);
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
