export type AvatarActor = { readonly kind: 'account' | 'seat'; readonly id: string };

export const OPEN_AVATAR_CHOOSER_EVENT = 'asa-open-avatar-chooser';

/** A UI shortcut only. Persistence still uses the authenticated scoped API. */
export function requestAvatarChooser(actor: AvatarActor): void {
  window.dispatchEvent(new CustomEvent<AvatarActor>(OPEN_AVATAR_CHOOSER_EVENT, { detail: actor }));
}
