// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ClassroomStudentSession } from '../../apps/web/src/api';
import {
  AvatarChooser,
  type AvatarChooserProps,
} from '../../apps/web/src/components/AvatarChooser';
import { SeatAvatarPicker } from '../../apps/web/src/components/SeatAvatarPicker';
import { createAvatarDataUrl } from '../../apps/web/src/creator-portal/avatar-file';
import {
  defaultAvatarFile,
  PROFILE_AVATAR_CHANGED_EVENT,
} from '../../apps/web/src/creator-portal/default-avatars';

vi.mock('../../apps/web/src/creator-portal/avatar-file', () => ({ createAvatarDataUrl: vi.fn() }));
vi.mock('../../apps/web/src/creator-portal/default-avatars', async (original) => ({
  ...(await original<object>()),
  defaultAvatarFile: vi.fn(),
}));
const seat: ClassroomStudentSession = {
  authenticated: true,
  student: { seatId: 'seat-1', displayName: 'Ученик', safeMode: true, avatarKey: null },
  classroom: { id: 'class-1', title: 'Класс', teacherDisplayName: 'Преподаватель' },
  expiresAt: '2030-01-01T00:00:00Z',
};
let root: Root;
let container: HTMLElement;
let active: boolean;
let props: AvatarChooserProps;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  active = true;
  props = {
    actor: { kind: 'account', id: 'account-1' },
    currentUrl: 'data:image/webp;base64,current',
    accountAvatarLoaded: true,
    isCurrent: () => active,
    onAccountLoaded: vi.fn(),
    onClose: vi.fn(),
  };
  vi.mocked(defaultAvatarFile).mockResolvedValue(
    new File(['avatar'], 'avatar.webp', { type: 'image/webp' }),
  );
  vi.mocked(createAvatarDataUrl).mockResolvedValue('data:image/webp;base64,chosen');
  vi.spyOn(api, 'updateAccountAvatar').mockResolvedValue({
    ok: true,
    status: 200,
    data: { avatarDataUrl: 'data:image/webp;base64,chosen' },
  });
  vi.spyOn(api, 'setClassroomSeatAvatar').mockResolvedValue({
    ok: true,
    status: 200,
    data: { ...seat, student: { ...seat.student, avatarKey: 'asa-avatar-01' } },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === name,
  )!;
async function render(input = props) {
  await act(async () => root.render(createElement(AvatarChooser, input)));
}
async function click(name: string) {
  await act(async () => button(name).click());
}

describe('avatar confirmation and actor isolation', () => {
  it('ignores a modal opening read after a newer avatar arrives from the shell', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.accountAvatar>>) => void;
    vi.spyOn(api, 'accountAvatar').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render({ ...props, accountAvatarLoaded: false });
    await render({
      ...props,
      currentUrl: 'data:image/webp;base64,newer',
      accountAvatarLoaded: true,
    });
    await act(async () =>
      resolve({ ok: true, status: 200, data: { avatarDataUrl: 'data:image/webp;base64,old' } }),
    );
    expect(props.onAccountLoaded).not.toHaveBeenCalled();
    expect(container.querySelector('img[alt="Предпросмотр аватара"]')?.getAttribute('src')).toBe(
      'data:image/webp;base64,newer',
    );
  });
  it('keeps opaque current data URL and selecting a thumbnail only changes preview', async () => {
    await render();
    expect(container.querySelector('img[alt="Предпросмотр аватара"]')?.getAttribute('src')).toBe(
      props.currentUrl,
    );
    await click('Выбрать: Аватар 1');
    expect(
      container.querySelector('img[alt="Предпросмотр аватара"]')?.getAttribute('src'),
    ).toContain('avatar-01.webp');
    expect(defaultAvatarFile).not.toHaveBeenCalled();
    expect(api.updateAccountAvatar).not.toHaveBeenCalled();
    await click('Отмена');
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(api.updateAccountAvatar).not.toHaveBeenCalled();
  });
  it('excludes a second save while conversion is pending and uses the transformed bitmap once', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(createAvatarDataUrl).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await click('Выбрать: Аватар 1');
    await act(async () => {
      button('Использовать').click();
      button('Использовать').click();
    });
    expect(defaultAvatarFile).toHaveBeenCalledOnce();
    expect(api.updateAccountAvatar).not.toHaveBeenCalled();
    await act(async () => resolve('data:image/webp;base64,safe320'));
    expect(api.updateAccountAvatar).toHaveBeenCalledExactlyOnceWith(
      'data:image/webp;base64,safe320',
    );
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it.each(['download', 'conversion'])(
    'does not mutate a new actor after deferred %s',
    async (stage) => {
      let resolve!: (value: never) => void;
      if (stage === 'download')
        vi.mocked(defaultAvatarFile).mockImplementation(
          () =>
            new Promise((done) => {
              resolve = done as typeof resolve;
            }),
        );
      else
        vi.mocked(createAvatarDataUrl).mockImplementation(
          () =>
            new Promise((done) => {
              resolve = done as typeof resolve;
            }),
        );
      await render();
      await click('Выбрать: Аватар 1');
      await click('Использовать');
      active = false;
      await act(async () =>
        resolve(
          (stage === 'download'
            ? new File(['old'], 'old.webp', { type: 'image/webp' })
            : 'data:image/webp;base64,old') as never,
        ),
      );
      expect(api.updateAccountAvatar).not.toHaveBeenCalled();
      expect(props.onAccountLoaded).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
    },
  );
  it('does not broadcast an Account save response after closing or changing actor', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.updateAccountAvatar>>) => void;
    vi.mocked(api.updateAccountAvatar).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const broadcast = vi.fn();
    window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, broadcast);
    try {
      await render();
      await click('Автоматический аватар');
      await click('Использовать');
      active = false;
      await act(async () => resolve({ ok: true, status: 200, data: { avatarDataUrl: null } }));
      expect(props.onAccountLoaded).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, broadcast);
    }
  });
  it('shows save failure inside chooser, retains preview and retries explicitly', async () => {
    vi.mocked(api.updateAccountAvatar).mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Сохранение недоступно' },
    });
    await render();
    await click('Выбрать: Аватар 2');
    await click('Использовать');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Сохранение недоступно');
    expect(button('Выбрать: Аватар 2').getAttribute('aria-pressed')).toBe('true');
    await click('Использовать');
    expect(api.updateAccountAvatar).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it('Seat has no upload and ignores a late class-scoped response', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.setClassroomSeatAvatar>>) => void;
    vi.mocked(api.setClassroomSeatAvatar).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const changed = vi.fn();
    await render({ ...props, actor: { kind: 'seat', id: 'seat-1' }, seat, onSeatChanged: changed });
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await click('Выбрать: Аватар 1');
    await click('Использовать');
    expect(api.setClassroomSeatAvatar).toHaveBeenCalledExactlyOnceWith('asa-avatar-01');
    active = false;
    await act(async () => resolve({ ok: true, status: 200, data: seat }));
    expect(changed).not.toHaveBeenCalled();
    expect(api.updateAccountAvatar).not.toHaveBeenCalled();
  });
  it('teacher thumbnail selection stages only after Use and never calls either persistence API', async () => {
    const changed = vi.fn();
    await act(async () =>
      root.render(
        createElement(SeatAvatarPicker, { seatId: 'seat-1', value: null, onChange: changed }),
      ),
    );
    await click('Выбрать аватар ученика');
    await click('Выбрать: Аватар 1');
    expect(changed).not.toHaveBeenCalled();
    await click('Использовать аватар');
    expect(changed).toHaveBeenCalledExactlyOnceWith('asa-avatar-01');
    expect(api.setClassroomSeatAvatar).not.toHaveBeenCalled();
    expect(api.updateAccountAvatar).not.toHaveBeenCalled();
  });
});
