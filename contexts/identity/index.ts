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
  ADULT_MIN_AGE_YEARS,
  AGE_POLICY_VERSION,
  ageInYears,
  isEligibleAdult,
  isValidCountryCode,
  isValidDisplayName,
  isValidPassword,
  isValidUsername,
  parseBirthDate,
  routeForMinor,
  type MinorRoute,
} from './domain/account-policy.js';
export type {
  AccountDirectoryPort,
  AccountAvatarRecord,
  AccountProfileRecord,
  AccountRecord,
  AccountSessionRef,
  ActiveContext,
  CapabilityRef,
  EducatorAttestation,
  LinkedAccount,
  LegacyActor,
  PersonalWorkspaceRef,
  RegisterAccountInput,
  RegisteredAccount,
  RegistrationConflict,
  SessionV2StorePort,
  WorkspaceRef,
} from './application/account.ports.js';
export {
  RegisterAccountUseCase,
  SESSION_TTL_HOURS,
  type RegisterResult,
} from './application/register-account.usecase.js';
export {
  AccountLoginUseCase,
  type AccountLoginResult,
} from './application/account-login.usecase.js';
export {
  AccountManagementUseCase,
  isValidAvatarDataUrl,
  type AccountProfileView,
  type EducatorAttestationResult,
  type UpdateAvatarResult,
  type UpdateProfileResult,
} from './application/account-management.usecase.js';
export { ActiveContextUseCase } from './application/active-context.usecase.js';
export { PgAccountDirectory } from './infrastructure/pg-account.adapter.js';
export { PgSessionV2Store } from './infrastructure/pg-session-v2.store.js';
