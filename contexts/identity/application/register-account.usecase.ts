import { hashPassword } from '../domain/password.js';
import {
  AGE_POLICY_VERSION,
  isEligibleAdult,
  isValidCountryCode,
  isValidDisplayName,
  isValidPassword,
  parseBirthDate,
  usernameFromEmail,
} from '../domain/age-policy.js';
import { isValidEmail, normalizeEmail } from '../domain/validation.js';
import type { AccountDirectoryPort, RegisteredAccount } from './account.ports.js';

export type RegisterResult =
  | { readonly ok: true; readonly account: RegisteredAccount; readonly email: string }
  | {
      readonly ok: false;
      readonly code: 'validation_error' | 'age_restricted' | 'email_taken';
      readonly message: string;
    };

/**
 * Adult self-registration. The account gets its Personal Workspace and the
 * creator capability; educator is never granted here — that needs an audited
 * attestation of its own.
 */
export class RegisterAccountUseCase {
  constructor(private readonly accounts: AccountDirectoryPort) {}

  async execute(input: {
    email: unknown;
    password: unknown;
    displayName: unknown;
    birthDate: unknown;
    country: unknown;
  }): Promise<RegisterResult> {
    const email = typeof input.email === 'string' ? normalizeEmail(input.email) : input.email;
    if (!isValidEmail(email)) {
      return { ok: false, code: 'validation_error', message: 'введите корректный email' };
    }
    if (!isValidPassword(input.password)) {
      return {
        ok: false,
        code: 'validation_error',
        message: 'пароль должен быть не короче 10 символов',
      };
    }
    if (!isValidDisplayName(input.displayName)) {
      return { ok: false, code: 'validation_error', message: 'укажите имя от 2 до 255 символов' };
    }
    if (!isValidCountryCode(input.country)) {
      return { ok: false, code: 'validation_error', message: 'укажите страну' };
    }
    const birthDate = parseBirthDate(input.birthDate);
    if (birthDate === null) {
      return {
        ok: false,
        code: 'validation_error',
        message: 'укажите дату рождения в формате ГГГГ-ММ-ДД',
      };
    }
    if (!isEligibleAdult(birthDate)) {
      return {
        ok: false,
        code: 'age_restricted',
        message: 'самостоятельная регистрация доступна с 18 лет',
      };
    }

    const registered = await this.accounts.register({
      email,
      passwordHash: hashPassword(input.password),
      displayName: (input.displayName as string).trim(),
      username: usernameFromEmail(email),
      birthDate: input.birthDate as string,
      country: (input.country as string).trim().toUpperCase(),
      policyVersion: AGE_POLICY_VERSION,
    });
    if ('conflict' in registered) {
      return { ok: false, code: 'email_taken', message: 'аккаунт с таким email уже существует' };
    }
    return { ok: true, account: registered, email };
  }
}
