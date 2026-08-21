import { describe, expect, it } from 'vitest';
import {
  publicViewFromLocation,
  publicViewToHref,
} from '../../apps/web/src/creator-portal/public-navigation';

describe('public browser routing', () => {
  it('uses clean URLs for public pages', () => {
    expect(publicViewToHref({ kind: 'entry' })).toBe('/');
    expect(publicViewToHref({ kind: 'sign-in' })).toBe('/sign-in');
    expect(publicViewToHref({ kind: 'join-class' })).toBe('/join-class');
  });

  it('opens a clean path directly and tolerates a trailing slash', () => {
    expect(publicViewFromLocation({ pathname: '/sign-in', hash: '' })).toEqual({
      kind: 'sign-in',
    });
    expect(publicViewFromLocation({ pathname: '/sign-up/', hash: '' })).toEqual({
      kind: 'sign-up',
    });
  });

  it('keeps historical hash links working', () => {
    expect(publicViewFromLocation({ pathname: '/', hash: '#/join-class?code=ABC123' })).toEqual({
      kind: 'join-class',
    });
  });
});
