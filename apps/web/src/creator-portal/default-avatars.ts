export interface DefaultAvatar {
  readonly id: string;
  readonly label: string;
  readonly src: string;
}

const DEFAULT_AVATAR_COUNT = 67;

export const DEFAULT_AVATARS: readonly DefaultAvatar[] = Array.from(
  { length: DEFAULT_AVATAR_COUNT },
  (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return {
      id: `asa-avatar-${number}`,
      label: `Аватар ${index + 1}`,
      src: `/assets/avatars/default/avatar-${number}.webp`,
    };
  },
);

export const PROFILE_AVATAR_CHANGED_EVENT = 'asa-profile-avatar-changed';

export function defaultAvatarForAccount(accountId: string): DefaultAvatar {
  let hash = 2166136261;
  for (const character of accountId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return DEFAULT_AVATARS[Math.abs(hash) % DEFAULT_AVATARS.length] as DefaultAvatar;
}

export function notifyProfileAvatarChanged(avatarDataUrl: string | null): void {
  window.dispatchEvent(
    new CustomEvent<string | null>(PROFILE_AVATAR_CHANGED_EVENT, { detail: avatarDataUrl }),
  );
}

export async function defaultAvatarFile(avatar: DefaultAvatar): Promise<File> {
  const response = await fetch(avatar.src, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Не удалось загрузить выбранный аватар.');
  const blob = await response.blob();
  return new File([blob], `${avatar.id}.webp`, { type: 'image/webp' });
}
