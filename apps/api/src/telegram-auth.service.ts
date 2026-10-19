import type pg from 'pg';
import {
  BotProviderAuthService,
  type BotProviderAuthOptions,
} from './bot-provider-auth.service.js';
import { validateProviderInitData } from './provider-init-data.js';

export {
  ProviderInitDataError as TelegramInitDataError,
  ProviderConfigurationError as TelegramConfigurationError,
} from './auth-provider-availability.js';
export type {
  ProviderInitDataErrorCode as TelegramInitDataErrorCode,
  ProviderConfigurationErrorCode as TelegramConfigurationErrorCode,
  ValidatedProviderIdentity as ValidatedTelegramIdentity,
  ProviderSignInResult as TelegramSignInResult,
  ProviderLinkResult as TelegramLinkResult,
  ProviderAccountStatus as TelegramAccountStatus,
  ProviderAdminConfig as TelegramAdminConfig,
  ProviderAdminUpdateInput as TelegramAdminUpdateInput,
  ProviderRegisterResult as TelegramRegisterResult,
  ProviderPairingResult as TelegramPairingResult,
} from './auth-provider-availability.js';

/** Preserve the Telegram API while sharing the provider lifecycle with Telegram. */
export class TelegramAuthService extends BotProviderAuthService {
  constructor(pool: pg.Pool, options: BotProviderAuthOptions = {}) {
    super(pool, 'telegram', options);
  }
}

export function validateTelegramInitData(raw: unknown, botToken: string, nowMs = Date.now()) {
  return validateProviderInitData(raw, botToken, 'telegram', nowMs);
}
