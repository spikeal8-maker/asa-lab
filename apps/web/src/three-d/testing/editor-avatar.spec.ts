import { describe, expect, it } from 'vitest';
import type { PublicUser } from '../../api';
import {
  createEditorAvatarModel,
  editorAvatarInitials,
} from '../../components/editor-chrome/EditorAvatar';

const USER: PublicUser = {
  id: 'account-3d-avatar',
  displayName: 'Александр Аликин (преподаватель)',
  email: 'avatar@example.test',
};

describe('3D editor avatar', () => {
  it('uses the uploaded account avatar and keeps accessible profile text', () => {
    const avatar = createEditorAvatarModel(USER, 'data:image/png;base64,owner-avatar');

    expect(avatar).toEqual({
      src: 'data:image/png;base64,owner-avatar',
      text: 'АА',
      title: USER.displayName,
      label: `Профиль: ${USER.displayName}`,
    });
  });

  it('falls back to a stable built-in ASA avatar when no upload exists', () => {
    const first = createEditorAvatarModel(USER, null);
    const second = createEditorAvatarModel(USER, null);

    expect(first.src).toMatch(/^\/assets\/avatars\/default\/avatar-\d{2}\.webp$/);
    expect(second.src).toBe(first.src);
  });

  it('builds initials from visible name words and has a safe empty fallback', () => {
    expect(editorAvatarInitials('  Мария   Иванова (ученик) ')).toBe('МИ');
    expect(editorAvatarInitials('---')).toBe('A');
  });
});
