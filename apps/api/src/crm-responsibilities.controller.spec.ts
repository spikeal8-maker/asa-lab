import { describe, it, expect } from 'vitest';
import { responsibilityInput } from './crm-responsibilities.controller';
const id = '11111111-1111-4111-8111-111111111111';
describe('responsibility command validation', () => {
  it('accepts exact scope and strict version/reason', () =>
    expect(
      responsibilityInput('organization', id, id, {
        version: 'a'.repeat(64),
        role: 'owner',
        state: 'active',
        reason: 'Owner request',
      }),
    ).toMatchObject({ role: 'owner' }));
  it.each([
    { role: 'student' },
    { version: 'stale' },
    { reason: ' ' },
    { globalRole: 'platform_admin' },
    { state: 'invited' },
  ])('rejects malformed or authority-bearing inputs %j', (patch) =>
    expect(() =>
      responsibilityInput('organization', id, id, {
        version: 'a'.repeat(64),
        role: 'member',
        state: 'active',
        reason: 'Authorized change',
        ...patch,
      }),
    ).toThrow(),
  );
  it('rejects personal and invented scopes', () =>
    expect(() => responsibilityInput('personal', id, id)).toThrow());
});
