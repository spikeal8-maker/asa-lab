import { hashPassword } from '../domain/password.js';
import {
  AGE_POLICY_VERSION,
  isEligibleAdult,
  isValidCountryCode,
  isValidDisplayName,
  isValidPassword,
  isValidUsername,
  parseBirthDate,
  routeForMinor,
  type MinorRoute,
} from '../domain/age-policy.js';
import { isValidEmail, normalizeEmail } from '../domain/validation.js';
import type { AccountDirectoryPort, RegisteredAccount } from './account.ports.js';

export type RegisterResult =
  | { readonly ok: true; readonly account: RegisteredAccount; readonly email: string }
  | {
      readonly ok: false;
      readonly code: 'validation_error' | 'email_taken' | 'username_taken';
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: 'age_routed';
      readonly message: string;
      readonly routes: readonly MinorRoute[];
    };

/**
 * Adult self-registration into a Personal Workspace.
 *
 * The account receives the creator capability only. Educator is a separate
 * audited grant, and nothing here creates a school or a teacher record.
 *
 * Someone below the adult age is not refused into a dead end: the result names
 * the routes they should take instead.
 */
export class RegisterAccountUseCase {
  constructor(private readonly accounts: AccountDirectoryPort) {}

  async execute(input: {
    email: unknown;
    password: unknown;
    username: unknown;
    displayName?: unknown;
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
    if (!isValidUsername(input.username)) {
      return {
        ok: false,
        code: 'validation_error',
        message: 'псевдоним: 3–40 символов, латиница, цифры, точка, дефис или подчёркивание',
      };
    }
    if (!isValidDisplayName(input.displayName)) {
      return { ok: false, code: 'validation_error', message: 'имя не длиннее 255 символов' };
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
        code: 'age_routed',
        message: 'личный аккаунт доступен с 18 лет — ученики заходят по коду класса',
        routes: routeForMinor(),
      };
    }

    const username = (input.username as string).trim().toLowerCase();
    if (!(await this.accounts.isUsernameAvailable(username))) {
      return { ok: false, code: 'username_taken', message: 'этот псевдоним уже занят' };
    }

    const displayName =
      typeof input.displayName === 'string' && input.displayName.trim().length > 0
        ? input.displayName.trim()
        : username;

    const registered = await this.accounts.register({
      email,
      passwordHash: hashPassword(input.password),
      displayName,
      username,
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
