import type { MinorRoute } from '@asa-lab/identity';

export type BotAuthProvider = 'max' | 'telegram';
export type AuthProviderId = BotAuthProvider | 'email';
export type AuthProviderAvailabilityReason =
  | 'ready'
  | 'disabled'
  | 'not_configured'
  | 'invalid_token'
  | 'delivery_unavailable'
  | 'unavailable';

export type AuthProviderEnforcementReason = AuthProviderAvailabilityReason | 'delivery_unverified';
export type ProviderReadinessDiagnosticReason =
  | 'disabled'
  | 'not_configured'
  | 'invalid_token'
  | 'bot_mismatch'
  | 'subscription_missing'
  | 'subscription_mismatch'
  | 'ingress_invalid_url'
  | 'ingress_dns_unavailable'
  | 'ingress_network_unavailable'
  | 'ingress_invalid_response'
  | 'unavailable';
export interface ProviderReadinessCheck {
  readonly state: 'not_checked' | 'ok' | 'failed';
  readonly reason: ProviderReadinessDiagnosticReason | null;
  readonly checkedAt: string | null;
}
export interface ProviderReadinessDiagnostics {
  readonly token: ProviderReadinessCheck;
  readonly subscription: ProviderReadinessCheck;
  readonly ingress: ProviderReadinessCheck;
  readonly nativeConfirmation: {
    readonly current: boolean;
    readonly configurationVersion: number | null;
    readonly verifiedAt: string | null;
  };
}

export interface AuthProviderAvailability {
  readonly id: AuthProviderId;
  readonly available: boolean;
  readonly reason: AuthProviderAvailabilityReason;
  readonly checkedAt: string | null;
  readonly launchUrl?: string | null;
  readonly enforcementEligible: boolean;
  readonly enforcementReason: AuthProviderEnforcementReason;
}

export type ProviderInitDataErrorCode =
  | `${BotAuthProvider}_auth_disabled`
  | `${BotAuthProvider}_init_data_invalid`
  | `${BotAuthProvider}_init_data_expired`;

export class ProviderInitDataError extends Error {
  constructor(readonly code: ProviderInitDataErrorCode) {
    super(code);
    this.name = 'ProviderInitDataError';
  }
}

export type ProviderConfigurationErrorCode =
  | `${BotAuthProvider}_encryption_key_missing`
  | `${BotAuthProvider}_token_missing`
  | `${BotAuthProvider}_token_invalid`
  | `${BotAuthProvider}_token_bot_mismatch`
  | `${BotAuthProvider}_webhook_url_invalid`
  | `${BotAuthProvider}_webhook_conflict`
  | `${BotAuthProvider}_service_unavailable`;

export class ProviderConfigurationError extends Error {
  constructor(readonly code: ProviderConfigurationErrorCode) {
    super(code);
    this.name = 'ProviderConfigurationError';
  }
}

export type ProviderOperationErrorCode =
  | 'last_sign_in_method'
  | 'identity_revoked'
  | 'identity_taken'
  | 'account_already_linked'
  | 'account_suspended';

export class ProviderOperationError extends Error {
  constructor(readonly code: ProviderOperationErrorCode) {
    super(code);
    this.name = 'ProviderOperationError';
  }
}

export interface ValidatedProviderIdentity {
  readonly subject: string;
  readonly queryId: string;
  readonly authDate: number;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly startParam: string | null;
}

export type ProviderSignInResult =
  | { readonly status: 'authenticated'; readonly token: string; readonly accountId: string }
  | {
      readonly status:
        | 'link_required'
        | 'assertion_replayed'
        | 'account_suspended'
        | 'identity_revoked'
        | 'unavailable';
    };

export type ProviderLinkResult = {
  readonly status:
    | 'linked'
    | 'already_linked'
    | 'identity_taken'
    | 'account_already_linked'
    | 'identity_revoked'
    | 'assertion_replayed'
    | 'account_suspended'
    | 'unavailable';
};

export interface ProviderAccountStatus {
  readonly linked: boolean;
  readonly verifiedAt: string | null;
  readonly firstAuthenticatedAt: string | null;
  readonly promptDue: boolean;
  readonly promptDismissedUntil: string | null;
  readonly canUnlink: boolean;
}

export interface ProviderAdminConfig {
  readonly enabled: boolean;
  readonly featureEnabled: boolean;
  readonly available: boolean;
  readonly availabilityReason: AuthProviderAvailabilityReason;
  readonly healthCheckedAt: string | null;
  readonly tokenConfigured: boolean;
  readonly botUsername: string | null;
  readonly launchUrl: string | null;
  readonly miniAppUrl: string | null;
  readonly encryptionReady: boolean;
  readonly tokenFingerprint: string | null;
  readonly verifiedBotId: string | null;
  readonly verifiedBotName: string | null;
  readonly tokenVerifiedAt: string | null;
  readonly configurationVersion: number;
  readonly updatedAt: string | null;
  readonly webhookUrl: string | null;
  readonly webhookVerifiedAt: string | null;
  readonly webhookLastError: string | null;
  readonly enforcementEligible: boolean;
  readonly enforcementReason: AuthProviderEnforcementReason;
  readonly diagnostics: ProviderReadinessDiagnostics;
}

export interface ProviderAdminUpdateInput {
  readonly enabled: boolean;
  readonly botUsername: string;
  readonly miniAppUrl: string;
  readonly botToken?: string;
  readonly clearToken?: boolean;
}

export interface ProviderRegistrationInput {
  readonly email: unknown;
  readonly password: unknown;
  readonly username: unknown;
  readonly displayName: unknown;
  readonly birthDate: unknown;
  readonly country: unknown;
}

export type ProviderRegisterResult =
  | { readonly status: 'authenticated'; readonly token: string; readonly accountId: string }
  | {
      readonly status:
        | 'validation_error'
        | 'age_routed'
        | 'email_taken'
        | 'username_taken'
        | 'identity_taken'
        | 'assertion_replayed'
        | 'unavailable';
      readonly message?: string;
      readonly routes?: readonly MinorRoute[];
    };

export type ProviderPairingResult =
  | { readonly status: 'pending' | 'expired' | 'invalid' | 'consumed' | 'unavailable' }
  | { readonly status: 'authenticated'; readonly token: string; readonly accountId: string }
  | { readonly status: 'linked'; readonly accountId: string }
  | {
      readonly status: 'registration_required';
      readonly profile: { readonly displayName: string | null; readonly username: string | null };
    };
