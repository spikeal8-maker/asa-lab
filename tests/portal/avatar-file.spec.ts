import { describe, expect, it } from 'vitest';
import { avatarFileError } from '../../apps/web/src/creator-portal/avatar-file';

describe('creator portal avatar upload', () => {
  it('accepts supported raster images within the upload limit', () => {
    expect(avatarFileError({ type: 'image/jpeg', size: 512_000 })).toBeNull();
    expect(avatarFileError({ type: 'image/png', size: 1_024 })).toBeNull();
    expect(avatarFileError({ type: 'image/webp', size: 1_024 })).toBeNull();
  });

  it('rejects SVG, unrelated files and oversized images before decoding', () => {
    expect(avatarFileError({ type: 'image/svg+xml', size: 1_024 })).toContain('PNG');
    expect(avatarFileError({ type: 'application/pdf', size: 1_024 })).toContain('PNG');
    expect(avatarFileError({ type: 'image/png', size: 8 * 1024 * 1024 + 1 })).toContain('8 МБ');
  });
});
