import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimNewInvitations } from './game-notifications';

describe('game invitation delivery', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('deduplicates polling, reloads and different tabs through persistent player-specific delivery ids', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    const invite = { id: 'first', expiresAt: Date.now() + 60000 };
    expect(claimNewInvitations('one', [invite])).toBe(true);
    expect(claimNewInvitations('one', [invite])).toBe(false);
    // A response no longer containing the invitation does not make it new again.
    expect(claimNewInvitations('one', [])).toBe(false);
    expect(claimNewInvitations('one', [invite])).toBe(false);
    expect(claimNewInvitations('two', [invite])).toBe(true);
    data.set(
      'asa:game-alerts:v1:one',
      JSON.stringify([invite, { id: 'from-other-tab', expiresAt: invite.expiresAt }]),
    );
    expect(
      claimNewInvitations('one', [{ id: 'from-other-tab', expiresAt: invite.expiresAt }]),
    ).toBe(false);
    expect(claimNewInvitations('one', [{ id: 'next', expiresAt: invite.expiresAt }])).toBe(true);
  });
  it('keeps delivery ids when storage reads work but writes exceed quota', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    const invite = { id: 'quota-invite', expiresAt: Date.now() + 60000 };
    expect(claimNewInvitations('quota', [invite])).toBe(true);
    expect(claimNewInvitations('quota', [invite])).toBe(false);
  });
  it('keeps delivery deduplication when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const invite = { id: 'private-first', expiresAt: Date.now() + 60000 };
    expect(claimNewInvitations('private', [invite])).toBe(true);
    expect(claimNewInvitations('private', [invite])).toBe(false);
  });
});
