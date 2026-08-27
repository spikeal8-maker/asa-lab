import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../LoginPage';

describe('LoginPage entry methods', () => {
  it('keeps the class-code entrance visible beside the personal account form', () => {
    const html = renderToStaticMarkup(
      createElement(LoginPage, {
        onSignedIn: vi.fn(),
        onCreateAccount: vi.fn(),
        onClassCodeLogin: vi.fn(),
        onOrganizationLogin: vi.fn(),
        onBack: vi.fn(),
      }),
    );

    expect(html).toContain('Выберите способ входа');
    expect(html).toContain('Личная учётная запись');
    expect(html).toContain('data-testid="auth-home"');
    expect(html).toContain('aria-label="На главную ASA Lab"');
    expect(html).toContain('data-testid="login-class-code"');
    expect(html).toContain('Войти по коду класса');
  });

  it('does not interrupt a MAX account-linking login with unrelated entry methods', () => {
    const html = renderToStaticMarkup(
      createElement(LoginPage, {
        onSignedIn: vi.fn(),
        onCreateAccount: vi.fn(),
        onOrganizationLogin: vi.fn(),
        onBack: vi.fn(),
        contextMessage: 'Войдите, чтобы продолжить привязку MAX.',
      }),
    );

    expect(html).not.toContain('data-testid="login-class-code"');
    expect(html).toContain('Войдите, чтобы продолжить привязку MAX.');
  });
});
