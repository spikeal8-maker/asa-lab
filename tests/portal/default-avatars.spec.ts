import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AVATARS,
  defaultAvatarForAccount,
} from '../../apps/web/src/creator-portal/default-avatars';

describe('ASA Lab default avatars', () => {
  it('publishes a unique curated library', () => {
    expect(DEFAULT_AVATARS).toHaveLength(67);
    expect(new Set(DEFAULT_AVATARS.map((avatar) => avatar.id)).size).toBe(67);
    expect(new Set(DEFAULT_AVATARS.map((avatar) => avatar.src)).size).toBe(67);
    expect(DEFAULT_AVATARS.every((avatar) => avatar.src.endsWith('.webp'))).toBe(true);
  });

  it('assigns the same default avatar to the same account', () => {
    const accountId = '45cf51a5-6792-47aa-9fa2-20f03720a3f7';

    expect(defaultAvatarForAccount(accountId)).toBe(defaultAvatarForAccount(accountId));
    expect(DEFAULT_AVATARS).toContain(defaultAvatarForAccount(accountId));
  });
});
