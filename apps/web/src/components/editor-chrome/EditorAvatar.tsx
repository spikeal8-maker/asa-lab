import { useEffect, useState } from 'react';
import { api, type PublicUser } from '../../api';
import {
  PROFILE_AVATAR_CHANGED_EVENT,
  defaultAvatarForAccount,
} from '../../creator-portal/default-avatars';

export interface EditorAvatarModel {
  readonly src: string;
  readonly text: string;
  readonly title: string;
  readonly label: string;
}

export function editorAvatarInitials(displayName: string): string {
  const avatarName = displayName.replace(/\([^)]*\)/g, ' ');
  return (
    (avatarName.match(/[\p{L}\p{N}]+/gu) ?? [])
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase('ru-RU') ?? '')
      .join('') || 'A'
  );
}

export function createEditorAvatarModel(
  user: PublicUser,
  uploadedAvatarDataUrl: string | null,
): EditorAvatarModel {
  return {
    src: uploadedAvatarDataUrl ?? defaultAvatarForAccount(user.id).src,
    text: editorAvatarInitials(user.displayName),
    title: user.displayName,
    label: `Профиль: ${user.displayName}`,
  };
}

export function useEditorAvatar(user: PublicUser): EditorAvatarModel {
  const [avatarState, setAvatarState] = useState<{
    readonly userId: string;
    readonly dataUrl: string | null;
  }>({ userId: user.id, dataUrl: null });
  const uploadedAvatarDataUrl = avatarState.userId === user.id ? avatarState.dataUrl : null;

  useEffect(() => {
    let cancelled = false;
    setAvatarState({ userId: user.id, dataUrl: null });

    // StudentSeat is deliberately represented by a PublicUser with no email:
    // it has no Account and therefore no uploaded account avatar. A guaranteed
    // 401 here used to start the account-refresh flow and log the learner out
    // precisely when the assigned project editor opened.
    if (user.email.trim().length > 0) {
      void api.accountAvatar().then((result) => {
        if (!cancelled && result.ok) {
          setAvatarState({ userId: user.id, dataUrl: result.data.avatarDataUrl });
        }
      });
    }

    const onAvatarChanged = (event: Event): void => {
      setAvatarState({
        userId: user.id,
        dataUrl: (event as CustomEvent<string | null>).detail,
      });
    };
    window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);
    };
  }, [user.email, user.id]);

  return createEditorAvatarModel(user, uploadedAvatarDataUrl);
}

export function EditorAvatar({
  avatar,
  className,
}: {
  readonly avatar: EditorAvatarModel;
  readonly className?: string;
}): JSX.Element {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const imageFailed = failedSource === avatar.src;

  return (
    <span className={className} title={avatar.title} aria-label={avatar.label}>
      {imageFailed ? (
        <span aria-hidden="true">{avatar.text}</span>
      ) : (
        <img src={avatar.src} alt="" onError={() => setFailedSource(avatar.src)} />
      )}
    </span>
  );
}
