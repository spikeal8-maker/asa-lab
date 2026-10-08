import { useEffect, useRef, useState } from 'react';
import { api, type ClassroomStudentSession } from '../api';
import { notifyProfileAvatarChanged } from '../creator-portal/default-avatars';
import type { AvatarActor } from './avatar-chooser-events';

export type AvatarSave =
  | { readonly kind: 'account'; readonly dataUrl: string | null }
  | { readonly kind: 'seat'; readonly avatarKey: string | null };

/** A sent write belongs to the mounted shell actor, independently of its dialog. */
export function useAvatarSave({
  actor,
  onAccountSaved,
  onSeatSaved,
}: {
  readonly actor: AvatarActor;
  readonly onAccountSaved: (url: string | null) => void;
  readonly onSeatSaved?: ((seat: ClassroomStudentSession) => void) | undefined;
}) {
  const key = `${actor.kind}:${actor.id}`;
  const owner = useRef({ key, alive: false, locked: false });
  if (owner.current.key !== key) owner.current = { key, alive: owner.current.alive, locked: false };
  const [state, setState] = useState({ key, saving: false, error: null as string | null });
  useEffect(() => {
    owner.current.alive = true;
    return () => {
      owner.current.alive = false;
    };
  }, []);

  async function save(input: AvatarSave): Promise<boolean> {
    const requestOwner = owner.current;
    if (
      !requestOwner.alive ||
      requestOwner.key !== key ||
      requestOwner.locked ||
      input.kind !== actor.kind ||
      (input.kind === 'seat' && !onSeatSaved)
    )
      return false;
    const current = () => requestOwner.alive && owner.current === requestOwner;
    requestOwner.locked = true;
    setState({ key, saving: true, error: null });
    try {
      if (input.kind === 'account') {
        const result = await api.updateAccountAvatar(input.dataUrl);
        if (!current()) return false;
        if (!result.ok) throw new Error(result.error.message || 'Не удалось сохранить аватар.');
        onAccountSaved(result.data.avatarDataUrl);
        if (current()) notifyProfileAvatarChanged(result.data.avatarDataUrl);
      } else {
        const result = await api.setClassroomSeatAvatar(input.avatarKey);
        if (!current()) return false;
        if (!result.ok) throw new Error(result.error.message || 'Не удалось сохранить аватар.');
        if (result.data.student.seatId !== actor.id) return false;
        onSeatSaved?.(result.data);
      }
      return true;
    } catch (reason) {
      if (!current()) return false;
      const message = reason instanceof Error ? reason.message : 'Не удалось сохранить аватар.';
      setState({ key, saving: false, error: message });
      throw reason;
    } finally {
      requestOwner.locked = false;
      if (current()) setState((value) => ({ ...value, saving: false }));
    }
  }

  return {
    saving: state.key === key && state.saving,
    error: state.key === key ? state.error : null,
    clearError: () => {
      if (owner.current.alive && owner.current.key === key)
        setState((value) => ({ ...value, error: null }));
    },
    save,
  };
}
