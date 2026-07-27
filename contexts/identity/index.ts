export { hashPassword, verifyPassword } from './domain/password.js';
export { createSessionToken, hashSessionToken } from './domain/session-token.js';
export { isValidEmail, isValidWorkspace, normalizeEmail } from './domain/validation.js';
export type {
  SessionContext,
  SessionStorePort,
  SessionUser,
  TenantLocatorPort,
  UserDirectoryPort,
} from './application/ports.js';
export { LoginUseCase, type LoginResult } from './application/login.usecase.js';
export { SessionUseCase } from './application/session.usecase.js';
export {
  PgSessionStore,
  PgTenantLocator,
  PgUserDirectory,
} from './infrastructure/pg-identity.adapter.js';
export {
  AGE_POLICY_VERSION,
  ADULT_MIN_AGE_YEARS,
  EDUCATOR_MIN_AGE_YEARS,
  ageInYears,
  isEligibleAdult,
  isValidCountryCode,
  isValidDisplayName,
  isValidPassword,
  maySelfAttestEducator,
  parseBirthDate,
  usernameFromEmail,
} from './domain/age-policy.js';
export type {
  AccountDirectoryPort,
  AccountProfile,
  AccountRecord,
  CapabilityRef,
  RegisterAccountInput,
  RegisteredAccount,
  WorkspaceRef,
} from './application/account.ports.js';
export {
  RegisterAccountUseCase,
  type RegisterResult,
} from './application/register-account.usecase.js';
export {
  AccountLoginUseCase,
  type AccountLoginResult,
} from './application/account-login.usecase.js';
export { PgAccountDirectory } from './infrastructure/pg-account.adapter.js';
