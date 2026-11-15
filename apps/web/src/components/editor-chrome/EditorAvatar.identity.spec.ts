// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { api, type PublicUser } from '../../api';
import { useEditorAvatar } from './EditorAvatar';
vi.mock('../../api', () => ({ api: { accountAvatar: vi.fn() } }));

it('loads an email-less Account avatar but never queries the Account endpoint for a StudentSeat', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  function Avatar({ user }: { user: PublicUser }) {
    return createElement('output', null, useEditorAvatar(user).src);
  }
  vi.mocked(api.accountAvatar).mockResolvedValue({
    ok: true,
    status: 200,
    data: { avatarDataUrl: 'data:image/png;base64,synthetic' },
  });
  try {
    await act(async () =>
      root.render(
        createElement(Avatar, {
          user: { id: 'max-account', displayName: 'MAX', email: null, identityKind: 'account' },
        }),
      ),
    );
    expect(api.accountAvatar).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('data:image/png;base64,synthetic');
    await act(async () =>
      root.render(
        createElement(Avatar, {
          user: { id: 'seat', displayName: 'Ученик', email: '', identityKind: 'student' },
        }),
      ),
    );
    expect(api.accountAvatar).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toBe('data:image/png;base64,synthetic');
  } finally {
    await act(async () => root.unmount());
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  }
});
