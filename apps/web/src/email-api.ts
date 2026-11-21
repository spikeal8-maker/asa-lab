import { abortable } from './auth-request';
import { call } from './admin/admin-api';
export interface EmailStatus {
  accountId: string;
  email: string | null;
  verified: boolean;
  pending: null | {
    id: string;
    email: string;
    purpose: 'change' | 'verify';
    state: 'sending' | 'sent' | 'failed' | 'cancelled' | 'consumed' | 'expired';
    expiresAt: string;
    createdAt: string;
  };
}
export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: 465 | 587;
  sender: string;
  username: string;
  siteOrigin: string;
}
export interface SmtpStatus {
  config: Partial<SmtpConfig>;
  version: number;
  passwordConfigured: boolean;
  encryptionReady: boolean;
  testedVersion: number | null;
  testedAt: string | null;
  testOk: boolean;
  deliveryVerifiedVersion: number | null;
}
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
export const emailApi = {
  config: (signal?: AbortSignal) =>
    call<SmtpStatus>('/api/admin/v1/auth/email', { ...(signal ? { signal } : {}) }),
  save: (version: number, config: SmtpConfig, password: string, clearPassword: boolean) =>
    call<SmtpStatus>('/api/admin/v1/auth/email', {
      method: 'PUT',
      body: JSON.stringify({ version, config, ...(password ? { password } : {}), clearPassword }),
    }),
  test: (version: number, to: string | null) =>
    call<SmtpStatus>('/api/admin/v1/auth/email/test', post({ version, to })),
  status: (target?: string, signal?: AbortSignal) =>
    call<EmailStatus>(target ? `/api/crm/v1/users/account/${target}/email` : '/api/auth/email', {
      ...(signal ? { signal } : {}),
    }),
  request: (accountId: string, requestId: string) =>
    call<EmailStatus>('/api/auth/email/request', post({ accountId, requestId })),
  change: (target: string, email: string, version: string, reason: string, requestId: string) =>
    call<EmailStatus>(
      `/api/crm/v1/users/account/${target}/email`,
      post({ email, version, reason, requestId }),
    ),
  cancel: (intentId: string, target?: string) =>
    call<EmailStatus>(
      target ? `/api/crm/v1/users/account/${target}/email/cancel` : '/api/auth/email/cancel',
      post({ intentId }),
    ),
  confirm: async (token: string) => {
    // No session refresh, telemetry payload or automatic replay for a bearer proof.
    const controller = new AbortController(),
      timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      return await abortable(async () => {
        const response = await fetch('/api/auth/email/confirm', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        if (!response.ok) return { confirmed: false };
        return (await response.json()) as { confirmed: boolean; changed?: boolean };
      }, controller.signal);
    } catch {
      return { confirmed: false };
    } finally {
      window.clearTimeout(timeout);
    }
  },
};
