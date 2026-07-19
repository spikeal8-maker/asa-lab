import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashSessionToken,
  isValidEmail,
  isValidClassroomTitle,
} from './security';

describe('password hashing', () => {
  it('verifies the correct password', () => {
    const stored = hashPassword('s3cret-pass');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('s3cret-pass', stored)).toBe(true);
  });

  it('rejects a wrong password and malformed hashes', () => {
    const stored = hashPassword('right');
    expect(verifyPassword('wrong', stored)).toBe(false);
    expect(verifyPassword('right', 'plaintext')).toBe(false);
    expect(verifyPassword('right', 'scrypt$bad')).toBe(false);
  });

  it('never stores the plain password', () => {
    const stored = hashPassword('visible-password');
    expect(stored).not.toContain('visible-password');
  });
});

describe('session tokens', () => {
  it('generates unique tokens and stable hashes', () => {
    const a = createSessionToken();
    const b = createSessionToken();
    expect(a).not.toBe(b);
    expect(hashSessionToken(a)).toBe(hashSessionToken(a));
    expect(hashSessionToken(a)).not.toBe(a);
  });
});

describe('input validation', () => {
  it('validates emails', () => {
    expect(isValidEmail('t@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });

  it('validates classroom titles', () => {
    expect(isValidClassroomTitle('8А Робототехника')).toBe(true);
    expect(isValidClassroomTitle('   ')).toBe(false);
    expect(isValidClassroomTitle('x'.repeat(256))).toBe(false);
    expect(isValidClassroomTitle(null)).toBe(false);
  });
});
