import { describe, it, expect, vi } from 'vitest';
import {
  PresentationPreferencesUseCase,
  validPresentationWrite,
} from '../application/presentation-preferences.js';
const good = {
  motion: 'reduce',
  sidebar: 'collapsed',
  revision: 0,
  requestId: '10000000-0000-4000-8000-000000000001',
};
describe('presentation command boundary', () => {
  it.each([
    null,
    [],
    {},
    { ...good, accountId: 'other' },
    { ...good, revision: -1 },
    { ...good, revision: 1.2 },
    { ...good, motion: 'dark' },
    { ...good, sidebar: 'hidden' },
    { ...good, requestId: 'not-a-uuid' },
    { ...good, motion: null },
  ])('rejects unknown or invalid command %j', (input) =>
    expect(validPresentationWrite(input)).toBe(false),
  );
  it('passes only a validated coherent set to the dedicated account port', async () => {
    const port = { read: vi.fn(), write: vi.fn().mockResolvedValue({ code: 'conflict' }) };
    const usecase = new PresentationPreferencesUseCase(port);
    expect(await usecase.write('server-account', { ...good, accountId: 'forged' })).toEqual({
      code: 'validation_error',
    });
    expect(port.write).not.toHaveBeenCalled();
    expect(await usecase.write('server-account', good)).toEqual({ code: 'conflict' });
    expect(port.write).toHaveBeenCalledWith('server-account', good);
  });
});
