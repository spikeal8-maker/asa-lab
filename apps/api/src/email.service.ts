import { HttpException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AuthProviderAvailability } from './auth-provider-availability.js';

export interface MailConfig {
  enabled: boolean;
  host: string;
  port: 465 | 587;
  sender: string;
  username: string;
  siteOrigin: string;
}
interface Envelope {
  iv: string;
  tag: string;
  ciphertext: string;
}
interface Runtime {
  config: Partial<MailConfig>;
  passwordEnvelope: Envelope | null;
  version: number;
  testedVersion: number | null;
  testedAt: string | null;
  testOk: boolean;
  deliveryVerifiedVersion: number | null;
}
interface MailTransport {
  verify(): Promise<unknown>;
  sendMail(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
    disableFileAccess: boolean;
    disableUrlAccess: boolean;
  }): Promise<{ accepted: unknown[]; rejected: unknown[] }>;
  close(): void;
}
export interface MailOptions {
  encryptionKey?: string;
  transport?: (config: MailConfig, password: string) => Promise<MailTransport>;
}
export function mailFailure(code: string, status = 400): never {
  const messages: Record<string, string> = {
    mail_invalid: 'Проверьте поля почты и адрес сайта.',
    mail_unavailable:
      'Почта не настроена или проверка подключения не пройдена. Обратитесь к администратору.',
    mail_delivery_failed: 'Письмо не отправлено. Проверьте подключение и повторите позже.',
    mail_test_failed: 'Подключение не прошло проверку. Проверьте сервер, пароль и доступ к почте.',
    mail_conflict: 'Данные изменились. Обновите страницу и повторите.',
    mail_denied: 'Нет доступа к настройкам или аккаунту.',
    mail_cooldown: 'Подождите минуту перед повторной отправкой. Не более пяти писем в час.',
    mail_email_taken: 'Этот адрес уже используется другим аккаунтом.',
  };
  throw new HttpException(
    { error: { code, message: messages[code] ?? messages['mail_invalid'] } },
    status,
  );
}
const hasControl = (value: string) =>
  [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

export function mailAddress(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(
      value,
    )
  )
    mailFailure('mail_invalid');
  const [local, domain] = value.split('@');
  if (
    !local ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !domain ||
    domain.split('.').some((x) => !x || x.length > 63 || x.startsWith('-') || x.endsWith('-'))
  )
    mailFailure('mail_invalid');
  return value.toLowerCase();
}
export function mailConfiguration(raw: unknown): MailConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) mailFailure('mail_invalid');
  const v = raw as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) => !['enabled', 'host', 'port', 'sender', 'username', 'siteOrigin'].includes(k),
    ) ||
    typeof v['enabled'] !== 'boolean' ||
    (v['port'] !== 465 && v['port'] !== 587)
  )
    mailFailure('mail_invalid');
  const host = v['host'],
    username = v['username'],
    site = v['siteOrigin'];
  if (
    typeof host !== 'string' ||
    host.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i.test(host) ||
    typeof username !== 'string' ||
    username.length < 1 ||
    username.length > 254 ||
    /\s/.test(username) ||
    hasControl(username) ||
    typeof site !== 'string' ||
    site.length > 2048
  )
    mailFailure('mail_invalid');
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    mailFailure('mail_invalid');
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    mailFailure('mail_invalid');
  return {
    enabled: v['enabled'],
    host: host.toLowerCase(),
    port: v['port'],
    sender: mailAddress(v['sender']),
    username,
    siteOrigin: url.origin,
  };
}
export function mailKey(raw: string | undefined): Buffer | null {
  const text = raw?.trim() ?? '';
  const key = /^[a-f0-9]{64}$/i.test(text)
    ? Buffer.from(text, 'hex')
    : /^[A-Za-z0-9_-]{43}$/.test(text)
      ? Buffer.from(text, 'base64url')
      : Buffer.alloc(0);
  return key.length === 32 ? key : null;
}
const AAD = Buffer.from('asa.settings.smtp.password.v1');
// The envelope is authenticated for this purpose, never reusable as a bot token.
export function sealMailPassword(password: string, key: Buffer): Envelope {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}
export function openMailPassword(envelope: Envelope, key: Buffer): string {
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  cipher.setAAD(AAD);
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    cipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    cipher.final(),
  ]).toString('utf8');
}
export const emailTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function smtpTransportOptions(config: MailConfig, password: string) {
  return {
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port === 587,
    auth: { user: config.username, pass: password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const, servername: config.host },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
    dnsTimeout: 5000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export class EmailService {
  private readonly key: Buffer | null;
  constructor(
    private readonly pool: pg.Pool,
    private readonly options: MailOptions = {},
  ) {
    this.key = mailKey(options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY']);
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T> {
    try {
      const result = await this.pool.query<{ value: T }>(sql, params);
      const value = result.rows[0]?.value;
      if (value === undefined) throw new Error('MAIL_UNAVAILABLE');
      return value;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = (error as { code?: string }).code;
      if (code === '42501') mailFailure('mail_denied', 403);
      if (code === '40001') mailFailure('mail_conflict', 409);
      if (code === '23505') mailFailure('mail_email_taken', 409);
      if (code === '54000') mailFailure('mail_cooldown', 429);
      if (code === '22023') mailFailure('mail_invalid');
      mailFailure('mail_unavailable', 503);
    }
  }
  private runtime() {
    return this.query<Runtime>('SELECT mail_runtime() AS value');
  }
  async adminConfig(actor: string) {
    const value = await this.query<
      Omit<Runtime, 'passwordEnvelope'> & { passwordConfigured: boolean }
    >('SELECT mail_admin_config($1) AS value', [actor]);
    return { ...value, encryptionReady: this.key !== null };
  }
  async save(actor: string, raw: unknown, request: string) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) mailFailure('mail_invalid');
    const v = raw as Record<string, unknown>;
    if (
      Object.keys(v).some((k) => !['version', 'config', 'password', 'clearPassword'].includes(k)) ||
      !Number.isSafeInteger(v['version']) ||
      Number(v['version']) < 1 ||
      (v['clearPassword'] !== undefined && typeof v['clearPassword'] !== 'boolean')
    )
      mailFailure('mail_invalid');
    const config = mailConfiguration(v['config']);
    let envelope: Envelope | null = null;
    if (v['password'] !== undefined) {
      const password = v['password'];
      if (
        typeof password !== 'string' ||
        password.length < 1 ||
        password.length > 1024 ||
        hasControl(password) ||
        v['clearPassword'] === true
      )
        mailFailure('mail_invalid');
      if (!this.key) mailFailure('mail_unavailable', 503);
      envelope = sealMailPassword(password, this.key);
    }
    if (config.enabled && !this.key) mailFailure('mail_unavailable', 503);
    await this.query('SELECT mail_config_save($1,$2,$3::jsonb,$4::jsonb,$5,$6) AS value', [
      actor,
      v['version'],
      JSON.stringify(config),
      envelope === null ? null : JSON.stringify(envelope),
      v['clearPassword'] === true,
      request,
    ]);
    return this.adminConfig(actor);
  }
  private configured(runtime: Runtime): { config: MailConfig; password: string } {
    if (!this.key || !runtime.passwordEnvelope || !runtime.config.enabled)
      mailFailure('mail_unavailable', 503);
    try {
      return {
        config: mailConfiguration(runtime.config),
        password: openMailPassword(runtime.passwordEnvelope, this.key),
      };
    } catch {
      mailFailure('mail_unavailable', 503);
    }
  }
  private async transport(runtime: Runtime): Promise<MailTransport> {
    const { config, password } = this.configured(runtime);
    if (this.options.transport) return this.options.transport(config, password);
    const { default: nodemailer } = await import('nodemailer');
    return nodemailer.createTransport(smtpTransportOptions(config, password));
  }
  private async deliver(runtime: Runtime, to: string, text: string, subject: string) {
    const transport = await this.transport(runtime);
    try {
      const result = await transport.sendMail({
        from: mailAddress(runtime.config.sender),
        to,
        subject,
        text,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (
        result.rejected.length ||
        !result.accepted.some((x) => typeof x === 'string' && x.toLowerCase() === to.toLowerCase())
      )
        throw new Error('MAIL_REJECTED');
    } finally {
      transport.close();
    }
  }
  async test(actor: string, version: number, to: string | null, request: string) {
    await this.adminConfig(actor);
    const runtime = await this.runtime();
    if (runtime.version !== version) mailFailure('mail_conflict', 409);
    let ok = false;
    try {
      if (to !== null)
        await this.deliver(
          runtime,
          mailAddress(to),
          'Это проверочное письмо ASA Lab. Оно проверяет отправку и не подтверждает ваш аккаунт.',
          'Проверка почты ASA Lab',
        );
      else {
        const transport = await this.transport(runtime);
        try {
          if (!(await transport.verify())) throw new Error('MAIL_TEST_FAILED');
        } finally {
          transport.close();
        }
      }
      ok = true;
    } catch {
      /* Never return upstream diagnostics containing credentials or recipients. */
    }
    await this.query('SELECT mail_test_result($1,$2,$3,$4) AS value', [
      actor,
      version,
      ok,
      request,
    ]);
    if (!ok) mailFailure('mail_test_failed', 503);
    return { ...(await this.adminConfig(actor)), testKind: to === null ? 'connection' : 'message' };
  }
  async availability(): Promise<AuthProviderAvailability> {
    let runtime: Runtime | null = null,
      available = false;
    try {
      runtime = await this.runtime();
      this.configured(runtime);
      available = runtime.testedVersion === runtime.version && runtime.testOk;
    } catch {
      /* Fail open only for the existing verification policy's outage fallback. */
    }
    const eligible = available && runtime?.deliveryVerifiedVersion === runtime?.version;
    return {
      id: 'email',
      available,
      reason: available ? 'ready' : runtime?.config.enabled ? 'unavailable' : 'not_configured',
      checkedAt: runtime?.testedAt ?? null,
      enforcementEligible: eligible,
      enforcementReason: eligible
        ? 'ready'
        : available
          ? 'delivery_unverified'
          : runtime?.config.enabled
            ? 'unavailable'
            : 'not_configured',
    };
  }
  status(actor: string, account: string, admin: boolean) {
    return this.query('SELECT mail_intent_status($1,$2,$3) AS value', [actor, account, admin]);
  }
  cancel(actor: string, account: string, admin: boolean, intent: string, request: string) {
    return this.query('SELECT mail_intent_cancel($1,$2,$3,$4,$5) AS value', [
      actor,
      account,
      admin,
      intent,
      request,
    ]);
  }
  async request(
    actor: string,
    account: string,
    admin: boolean,
    email: string,
    version: string | null,
    reason: string,
    request: string,
  ) {
    email = mailAddress(email);
    // Authorize before reading delivery configuration or sending anything.
    await this.status(actor, account, admin);
    const runtime = await this.runtime();
    this.configured(runtime);
    if (!runtime.testOk || runtime.testedVersion !== runtime.version)
      mailFailure('mail_unavailable', 503);
    const token = randomBytes(32).toString('base64url'),
      hash = emailTokenHash(token),
      id = randomUUID();
    const result = await this.query<{ created: boolean; status: unknown }>(
      'SELECT mail_intent_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',
      [actor, account, admin, email, version, reason, request, id, hash, runtime.version],
    );
    if (!result.created) {
      const state = (result.status as { pending?: { state: string } })?.pending?.state;
      if (state === 'failed') mailFailure('mail_delivery_failed', 503);
      if (state !== 'sent' && state !== 'sending') mailFailure('mail_conflict', 409);
      return result.status;
    }
    let sent = false;
    try {
      await this.deliver(
        runtime,
        email,
        `Подтвердите ${admin ? 'новый адрес' : 'почту аккаунта'} ASA Lab. Ссылка действует 30 минут и используется один раз.\n\n${runtime.config.siteOrigin}/confirm-email#${token}\n\nЕсли вы не ожидали это письмо, не подтверждайте адрес.`,
        'Подтверждение почты ASA Lab',
      );
      sent = true;
    } catch {
      /* Secret and token never escape through an error. */
    }
    await this.query('SELECT mail_intent_delivery($1,$2,$3) AS value', [id, hash, sent]);
    if (!sent) mailFailure('mail_delivery_failed', 503);
    const status = (await this.status(actor, account, admin)) as { pending?: { state: string } };
    if (!['sent', 'consumed'].includes(status.pending?.state ?? ''))
      mailFailure('mail_conflict', 409);
    return status;
  }
  consume(token: unknown) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
      mailFailure('mail_invalid');
    return this.query('SELECT mail_intent_consume($1) AS value', [emailTokenHash(token)]);
  }
}
