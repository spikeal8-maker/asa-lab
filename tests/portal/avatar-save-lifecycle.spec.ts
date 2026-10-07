// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ClassroomStudentSession } from '../../apps/web/src/api';
import type { AvatarActor } from '../../apps/web/src/components/avatar-chooser-events';
import { useAvatarSave, type AvatarSave } from '../../apps/web/src/components/use-avatar-save';
import { PROFILE_AVATAR_CHANGED_EVENT } from '../../apps/web/src/creator-portal/default-avatars';

const seat: ClassroomStudentSession = {
  authenticated: true,
  student: { seatId: 'seat-1', displayName: 'Ученик', safeMode: true, avatarKey: 'asa-avatar-07' },
  classroom: { id: 'class-1', title: 'Класс', teacherDisplayName: 'Преподаватель' },
  expiresAt: '2030-01-01T00:00:00Z',
};
const accountResult = {
  ok: true as const,
  status: 200,
  data: { avatarDataUrl: 'data:image/webp;base64,saved' },
};
const seatResult = { ok: true as const, status: 200, data: seat };
let root: Root;
let container: HTMLElement;
let writer: ReturnType<typeof useAvatarSave>;
const accountSaved = vi.fn();
const seatSaved = vi.fn();
const broadcast = vi.fn();

function Owner({ actor, dialog }: { actor: AvatarActor; dialog: boolean }) {
  writer = useAvatarSave({ actor, onAccountSaved: accountSaved, onSeatSaved: seatSaved });
  return createElement(
    'div',
    {},
    createElement('output', {}, writer.saving ? 'pending' : (writer.error ?? 'idle')),
    dialog ? createElement('section', { role: 'dialog' }, 'Chooser') : null,
  );
}
async function render(actor: AvatarActor, dialog = true) {
  await act(async () => root.render(createElement(Owner, { actor, dialog })));
}
const actor = (
  kind: 'account' | 'seat',
  id = kind === 'account' ? 'account-1' : 'seat-1',
): AvatarActor => ({ kind, id });
const input = (kind: 'account' | 'seat'): AvatarSave =>
  kind === 'account'
    ? { kind, dataUrl: accountResult.data.avatarDataUrl }
    : { kind, avatarKey: 'asa-avatar-07' };
function deferred() {
  let resolve!: (result: typeof accountResult | typeof seatResult) => void;
  const promise = new Promise<typeof accountResult | typeof seatResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function delay(kind: 'account' | 'seat') {
  const gate = deferred();
  if (kind === 'account')
    vi.spyOn(api, 'updateAccountAvatar').mockImplementation(
      () => gate.promise as Promise<typeof accountResult>,
    );
  else
    vi.spyOn(api, 'setClassroomSeatAvatar').mockImplementation(
      () => gate.promise as Promise<typeof seatResult>,
    );
  return gate;
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, broadcast);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, broadcast);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('shell-owned avatar write lifecycle', () => {
  it.each(['account', 'seat'] as const)(
    '%s retains a sent write across close/reopen and prevents a second mutation',
    async (kind) => {
      const gate = delay(kind);
      await render(actor(kind));
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = writer.save(input(kind));
      });
      await render(actor(kind), false);
      await render(actor(kind));
      expect(writer.saving).toBe(true);
      await act(async () => {
        expect(await writer.save(input(kind))).toBe(false);
      });
      expect(
        kind === 'account' ? api.updateAccountAvatar : api.setClassroomSeatAvatar,
      ).toHaveBeenCalledOnce();
      await act(async () => gate.resolve(kind === 'account' ? accountResult : seatResult));
      expect(await pending).toBe(true);
      expect(writer.saving).toBe(false);
      expect(kind === 'account' ? accountSaved : seatSaved).toHaveBeenCalledExactlyOnceWith(
        kind === 'account' ? accountResult.data.avatarDataUrl : seat,
      );
      expect(broadcast).toHaveBeenCalledTimes(kind === 'account' ? 1 : 0);
      if (kind === 'account')
        expect((broadcast.mock.calls[0][0] as CustomEvent).detail).toBe(
          accountResult.data.avatarDataUrl,
        );
    },
  );

  it.each(['account', 'seat'] as const)(
    '%s ignores a late response after the actor changes and changes back',
    async (kind) => {
      const gate = delay(kind);
      await render(actor(kind));
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = writer.save(input(kind));
      });
      await render(actor(kind, 'other'));
      await render(actor(kind));
      await act(async () => gate.resolve(kind === 'account' ? accountResult : seatResult));
      expect(await pending).toBe(false);
      expect(accountSaved).not.toHaveBeenCalled();
      expect(seatSaved).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    },
  );

  it.each(['account', 'seat'] as const)(
    '%s ignores its late response when the shell unmounts',
    async (kind) => {
      const gate = delay(kind);
      await render(actor(kind));
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = writer.save(input(kind));
      });
      await act(async () => root.render(null));
      await act(async () => gate.resolve(kind === 'account' ? accountResult : seatResult));
      expect(await pending).toBe(false);
      expect(accountSaved).not.toHaveBeenCalled();
      expect(seatSaved).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    },
  );

  it('an old actor response cannot clear a new actor pending write or overwrite it', async () => {
    const old = deferred(),
      next = deferred();
    vi.spyOn(api, 'updateAccountAvatar')
      .mockImplementationOnce(() => old.promise as Promise<typeof accountResult>)
      .mockImplementationOnce(() => next.promise as Promise<typeof accountResult>);
    await render(actor('account'));
    let oldWrite!: Promise<boolean>, nextWrite!: Promise<boolean>;
    await act(async () => {
      oldWrite = writer.save(input('account'));
    });
    await render(actor('account', 'account-2'));
    await act(async () => {
      nextWrite = writer.save(input('account'));
    });
    await act(async () => old.resolve(accountResult));
    expect(await oldWrite).toBe(false);
    expect(writer.saving).toBe(true);
    await act(async () => {
      expect(await writer.save(input('account'))).toBe(false);
    });
    expect(api.updateAccountAvatar).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(accountResult));
    expect(await nextWrite).toBe(true);
    expect(accountSaved).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it('retains a save failure after dialog close/reopen and permits an explicit retry', async () => {
    let release!: (result: Awaited<ReturnType<typeof api.updateAccountAvatar>>) => void;
    vi.spyOn(api, 'updateAccountAvatar')
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            release = done;
          }),
      )
      .mockResolvedValueOnce(accountResult);
    await render(actor('account'));
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = writer.save(input('account'));
    });
    const failed = pending.catch((reason) => reason.message);
    await render(actor('account'), false);
    await act(async () =>
      release({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Попробуйте снова' },
      }),
    );
    await render(actor('account'));
    expect(await failed).toBe('Попробуйте снова');
    expect(writer.error).toBe('Попробуйте снова');
    expect(writer.saving).toBe(false);
    await act(async () => {
      expect(await writer.save(input('account'))).toBe(true);
    });
    expect(writer.error).toBeNull();
    expect(api.updateAccountAvatar).toHaveBeenCalledTimes(2);
    expect(accountSaved).toHaveBeenCalledOnce();
  });

  it('never applies a Seat response with a different server-issued Seat id', async () => {
    vi.spyOn(api, 'setClassroomSeatAvatar').mockResolvedValue({
      ...seatResult,
      data: { ...seat, student: { ...seat.student, seatId: 'other-seat' } },
    });
    await render(actor('seat'));
    await act(async () => {
      expect(await writer.save(input('seat'))).toBe(false);
    });
    expect(seatSaved).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
