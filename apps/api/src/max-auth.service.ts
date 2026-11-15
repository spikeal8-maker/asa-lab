import type pg from 'pg';
import {
  BotProviderAuthService,
  type BotProviderAuthOptions,
} from './bot-provider-auth.service.js';
import { validateProviderInitData } from './provider-init-data.js';

export {
  ProviderInitDataError as MaxInitDataError,
  ProviderConfigurationError as MaxConfigurationError,
} from './auth-provider-availability.js';
export type {
  ProviderInitDataErrorCode as MaxInitDataErrorCode,
  ProviderConfigurationErrorCode as MaxConfigurationErrorCode,
  ValidatedProviderIdentity as ValidatedMaxIdentity,
  ProviderSignInResult as MaxSignInResult,
  ProviderLinkResult as MaxLinkResult,
  ProviderAccountStatus as MaxAccountStatus,
  ProviderAdminConfig as MaxAdminConfig,
  ProviderAdminUpdateInput as MaxAdminUpdateInput,
  ProviderRegisterResult as MaxRegisterResult,
  ProviderPairingResult as MaxPairingResult,
} from './auth-provider-availability.js';

/** Preserve the MAX API while sharing the provider lifecycle with Telegram. */
export class MaxAuthService extends BotProviderAuthService {
  constructor(pool: pg.Pool, options: BotProviderAuthOptions = {}) {
    super(pool, 'max', options);
  }
}

export function validateMaxInitData(raw: unknown, botToken: string, nowMs = Date.now()) {
  return validateProviderInitData(raw, botToken, 'max', nowMs);
}
