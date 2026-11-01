import { expect, it } from 'vitest';
import { projectDatabaseEntry } from './database-diagnostics';
import { logSubsystem } from './log-subsystems';
import type { LogEntry } from './admin-logs.worker';

const entry = (origin: string, value: unknown): LogEntry => ({
  id: 'a'.repeat(64),
  time: '2026-11-02T01:00:00.000Z',
  source: 'audit',
  module: 'system',
  level: 'info',
  message: JSON.stringify(value),
  requestId: null,
  revision: null,
  origin,
  truncated: false,
});
it('exposes only recorded AI operational scalars and classifies async failures independently of HTTP polling', () => {
  const privateValue = 'synthetic-private-prompt-owner-workflow-key';
  const result = projectDatabaseEntry(
    entry('ai_image_jobs', {
      image_state: 'failed',
      image_error_code: 'ai_image_provider_failed',
      image_created_at: '2026-11-02T00:30:00Z',
      prompt: privateValue,
      recipe: privateValue,
      owner_principal_id: privateValue,
      sha256: privateValue,
      settings_snapshot: { credential: privateValue },
    }),
  );
  expect(result.level).toBe('error');
  expect(result.subsystem).toBe('diagnostics');
  expect(result.message).not.toContain(privateValue);
  expect(JSON.parse(result.message)).toEqual({
    image_state: 'failed',
    image_error_code: 'ai_image_provider_failed',
    image_created_at: '2026-11-02T00:30:00Z',
  });
  expect(logSubsystem('audit', '', 'ai_usage_journal')).toBe('diagnostics');
  const usage = projectDatabaseEntry(
    entry('ai_usage_journal', {
      generation_status: 'failed',
      generation_duration_ms: 123,
      generation_error_code: privateValue,
      actual_model: privateValue,
    }),
  );
  expect(usage.level).toBe('error');
  expect(JSON.parse(usage.message)).toEqual({
    generation_status: 'failed',
    generation_duration_ms: 123,
  });
});
it('does not mistake provider health or ordinary HTTP payloads for a database row', () => {
  for (const value of [
    {
      kind: 'provider_health',
      healthService: 'ollama',
      availability: 'reachable',
      loadedModels: 1,
      vramBytes: 100,
    },
    {
      kind: 'http_response',
      status: 200,
      path: '/api/ai/threads/example/image-generations/example',
    },
  ]) {
    const row = { ...entry('', value), source: 'metrics' };
    expect(projectDatabaseEntry(row)).toBe(row);
  }
});
