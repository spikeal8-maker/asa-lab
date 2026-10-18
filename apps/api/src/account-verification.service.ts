import { HttpException } from '@nestjs/common';
import type pg from 'pg';
import type { AuthProviderAvailability } from './auth-provider-availability.js';

export const VERIFICATION_GRACE_HOURS = 24;
const GRACE_MS = VERIFICATION_GRACE_HOURS * 60 * 60 * 1000;
const POLICY_CACHE_MS = 1000;
type ProviderId = AuthProviderAvailability['id'];

export interface VerificationPolicy {
  readonly enabled: boolean;
  readonly activatedAt: string | null;
  readonly graceHours: 24;
}

export interface VerificationState {
  readonly policyEnabled: boolean;
  readonly required: boolean;
  readonly reason:
    'disabled' | 'verified' | 'grace_period' | 'providers_unavailable' | 'verification_required';
  readonly dueAt: string | null;
  readonly verifiedProvider: ProviderId | null;
  readonly providers: readonly AuthProviderAvailability[];
}

export interface AvailabilityProvider {
  availability(): Promise<AuthProviderAvailability>;
}

interface PolicyRow {
  enabled: boolean;
  activated_at: Date | string | null;
}
interface AccountStateRow extends PolicyRow {
  first_authenticated_at: Date | string;
  verified_provider: string | null;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid verification timestamp');
  return date.toISOString();
}

function policyFrom(row: PolicyRow): VerificationPolicy {
  return {
    enabled: row.enabled === true,
    activatedAt: row.activated_at === null ? null : iso(row.activated_at),
    graceHours: VERIFICATION_GRACE_HOURS,
  };
}

/** The clock and provider health are server inputs, never values from a request. */
export function evaluateAccountVerification(input: {
  readonly policy: VerificationPolicy;
  readonly firstAuthenticatedAt: string;
  readonly verifiedProvider: ProviderId | null;
  readonly providers: readonly AuthProviderAvailability[];
  readonly now: number;
}): VerificationState {
  const { policy, verifiedProvider, providers } = input;
  const activated = policy.activatedAt === null ? null : Date.parse(policy.activatedAt);
  const firstAuthentication = Date.parse(input.firstAuthenticatedAt);
  if (
    !Number.isFinite(firstAuthentication) ||
    !Number.isFinite(input.now) ||
    (activated !== null && !Number.isFinite(activated)) ||
    (policy.enabled && activated === null)
  ) {
    throw new Error('invalid account verification policy state');
  }
  const due = activated === null ? null : Math.max(firstAuthentication, activated) + GRACE_MS;
  let reason: VerificationState['reason'];
  if (!policy.enabled) reason = 'disabled';
  else if (verifiedProvider !== null) reason = 'verified';
  else if (due !== null && input.now < due) reason = 'grace_period';
  else if (!providers.some((provider) => provider.available && provider.reason === 'ready'))
    reason = 'providers_unavailable';
  else reason = 'verification_required';
  return {
    policyEnabled: policy.enabled,
    required: reason === 'verification_required',
    reason,
    dueAt: due === null ? null : new Date(due).toISOString(),
    verifiedProvider,
    providers,
  };
}

export function verificationRequired(state: VerificationState): HttpException {
  return new HttpException(
    {
      error: {
        code: 'account_verification_required',
        message: 'Подтвердите аккаунт одним из доступных способов, чтобы продолжить.',
      },
      verification: state,
    },
    403,
  );
}

export class AccountVerificationService {
  private cachedPolicy: { expiresAt: number; value: VerificationPolicy } | null = null;
  constructor(
    private readonly pool: pg.Pool,
    private readonly providers: readonly AvailabilityProvider[],
    private readonly now: () => number = Date.now,
  ) {}

  async getProviders(): Promise<AuthProviderAvailability[]> {
    const providers = await Promise.all(this.providers.map((provider) => provider.availability()));
    return [
      ...providers,
      { id: 'email', available: false, reason: 'not_configured', checkedAt: null },
    ];
  }

  async isEnabled(): Promise<boolean> {
    const cached = this.cachedPolicy;
    if (cached && cached.expiresAt > this.now()) return cached.value.enabled;
    const result = await this.pool.query<PolicyRow>('SELECT * FROM auth_verification_policy()');
    const row = result.rows[0];
    if (!row) throw new Error('account verification policy is missing');
    const value = policyFrom(row);
    this.cachedPolicy = { value, expiresAt: this.now() + POLICY_CACHE_MS };
    return value.enabled;
  }

  async forAccount(accountId: string): Promise<VerificationState | null> {
    const result = await this.pool.query<AccountStateRow>(
      'SELECT * FROM auth_account_verification_state($1)',
      [accountId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const verified = row.verified_provider;
    if (verified !== null && verified !== 'max' && verified !== 'telegram' && verified !== 'email')
      throw new Error('unknown account verification provider');
    return evaluateAccountVerification({
      policy: policyFrom(row),
      firstAuthenticatedAt: iso(row.first_authenticated_at),
      verifiedProvider: verified,
      providers: await this.getProviders(),
      now: this.now(),
    });
  }

  async requireAccount(accountId: string): Promise<VerificationState> {
    const state = await this.forAccount(accountId);
    if (!state)
      throw new HttpException(
        { error: { code: 'unauthorized', message: 'account is not active' } },
        401,
      );
    if (state.required) throw verificationRequired(state);
    return state;
  }

  async requirePrincipal(principalId: string): Promise<void> {
    if (!(await this.isEnabled())) return;
    const result = await this.pool.query<{ account_id: string | null }>(
      'SELECT auth_verification_principal_account($1) AS account_id',
      [principalId],
    );
    const accountId = result.rows[0]?.account_id;
    if (accountId) await this.requireAccount(accountId);
  }

  async adminPolicy(principalId: string): Promise<VerificationPolicy> {
    const result = await this.pool.query<PolicyRow>(
      'SELECT * FROM admin_get_verification_policy($1)',
      [principalId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('account verification policy is missing');
    return policyFrom(row);
  }

  async updatePolicy(
    principalId: string,
    enabled: boolean,
    requestId: string,
  ): Promise<VerificationPolicy> {
    const result = await this.pool.query<PolicyRow>(
      'SELECT * FROM admin_set_verification_policy($1, $2, $3)',
      [principalId, enabled, requestId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('account verification policy was not updated');
    const value = policyFrom(row);
    this.cachedPolicy = null;
    return value;
  }
}
