// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AI_ADMIN_SECTIONS,
  navigateAiAdmin,
  readAiAdminNavigation,
  rememberAiAdminNavigation,
} from '../ai-admin-navigation';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/#/admin/ai');
});
afterEach(() => vi.restoreAllMocks());

it('opens Overview on first visit and puts Settings second', () => {
  expect(AI_ADMIN_SECTIONS.slice(0, 2).map((item) => item.label)).toEqual(['Обзор', 'Настройки']);
  expect(readAiAdminNavigation('administrator-a')).toEqual({
    section: 'overview',
    provider: 'ollama',
  });
});
it('restores the same administrator selection without exposing it to another owner', () => {
  rememberAiAdminNavigation('administrator-a', { section: 'connections', provider: 'deepseek' });
  expect(readAiAdminNavigation('administrator-a')).toEqual({
    section: 'connections',
    provider: 'deepseek',
  });
  expect(readAiAdminNavigation('administrator-b')).toEqual({
    section: 'overview',
    provider: 'ollama',
  });
});
it('prioritizes a valid explicit link and preserves unrelated query parameters on navigation', () => {
  rememberAiAdminNavigation('administrator-a', { section: 'connections', provider: 'deepseek' });
  window.history.replaceState(null, '', '/#/admin/ai?section=settings&provider=openai&view=owner');
  expect(readAiAdminNavigation('administrator-a')).toEqual({
    section: 'settings',
    provider: 'openai',
  });
  navigateAiAdmin({ section: 'overview', provider: 'ollama-cloud' });
  expect(window.location.hash).toContain('section=overview');
  expect(window.location.hash).toContain('provider=ollama-cloud');
  expect(window.location.hash).toContain('view=owner');
  expect(readAiAdminNavigation('administrator-a').section).toBe('overview');
});
it('rejects unrecognized stored/URL values and keeps navigation available when storage is blocked', () => {
  localStorage.setItem(
    'asa-ai-admin-navigation:v1:administrator-a',
    '{"section":"private-data","provider":"unknown"}',
  );
  window.history.replaceState(null, '', '/#/admin/ai?section=invalid&provider=invalid');
  expect(readAiAdminNavigation('administrator-a')).toEqual({
    section: 'overview',
    provider: 'ollama',
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  expect(() =>
    rememberAiAdminNavigation('administrator-a', { section: 'settings', provider: 'openai' }),
  ).not.toThrow();
  navigateAiAdmin({ section: 'settings', provider: 'openai' });
  expect(readAiAdminNavigation('administrator-a')).toEqual({
    section: 'settings',
    provider: 'openai',
  });
});
