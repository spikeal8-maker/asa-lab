import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { effectiveAccountActions } from '@asa-lab/identity';
import { createHash, randomUUID } from 'node:crypto';
import type {
  AccountDirectoryPort,
  AccountLoginUseCase,
  ActiveContext,
  ActiveContextUseCase,
  LoginUseCase,
  RegisterAccountUseCase,
} from '@asa-lab/identity';
import { REFRESH_COOKIE, SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, type SeatContextUseCase } from './seat-context.js';
import { requestReceivedAt } from './request-receipt.js';
import { checkBodyShape } from './validation.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { clientAddress, clientConnection, type ClientNetworkKind } from './client-address.js';
import { BotChallengeService, type BotAction } from './bot-challenge.js';
import type { IngressProbeResponse } from './bot-provider-ingress.js';
import { MaxAuthService } from './max-auth.service.js';
import { TelegramAuthService } from './telegram-auth.service.js';
import {
  ProviderConfigurationError,
  ProviderInitDataError,
  ProviderOperationError,
} from './auth-provider-availability.js';
import {
  AccountVerificationService,
  type VerificationState,
} from './account-verification.service.js';
import { AllowUnverifiedAccount } from './account-verification.guard.js';
import {
  REFRESH_TTL_DAYS,
  RefreshSessionService,
  type SessionSource,
} from './refresh-session.service.js';
import {
  ProductAnalyticsService,
  type AnalyticsAuthMethod,
  type AnalyticsEventType,
  type AnalyticsOutcome,
} from './product-analytics.service.js';

// Password hashing costs tens of milliseconds of thread-pool time per attempt,
// so an endpoint without a ceiling lets one client spend the whole runtime on
// failed guesses.
//
// The two ceilings do different jobs, and conflating them locks out schools. A
// class sits behind one NAT address: thirty learners signing in at the start of
// a lesson are indistinguishable from one client hammering the endpoint. So the
// per-address ceiling is deliberately generous — it only caps CPU, and at these
// values a single attacker still cannot buy more than a few percent of one
// hashing thread. Guessing is stopped by the per-identifier ceiling instead,
// which is unaffected by how many people share an address.
export const LOGIN_WINDOW_MS = 5 * 60 * 1000;
export const LOGIN_PER_ADDRESS = 120;
export const LOGIN_PER_IDENTIFIER = 10;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const REGISTER_PER_ADDRESS = 60;
export const BOT_CHALLENGE_WINDOW_MS = 5 * 60 * 1000;
export const BOT_CHALLENGE_PER_ADDRESS = 60;
export const MAX_AUTH_PER_ADDRESS = 60;
// A pending bot confirmation is polled repeatedly. It must not exhaust the
// credential budget and prevent a user from completing the same request.
export const PAIRING_POLL_PER_ADDRESS = 1800;
export const PAIRING_POLL_PER_CHALLENGE = 90;
const AUTH_FLOW_COOKIE = 'asa_auth_flow';
const AUTH_FLOW_MAX_AGE_SECONDS = 20 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PublicUser {
  identityKind?: 'account';
  id: string;
  displayName: string;
  email: string | null;
}

interface SessionPayload {
  authenticated: true;
  verification: VerificationState;
  user: PublicUser;
  account: PublicUser;
  capabilities: { capability: string; state: string }[];
  workspaces: { workspaceId: string; kind: string; title: string; role: string }[];
  activeWorkspace: { workspaceId: string; kind: string };
  actions: readonly string[];
  navigation: { classes: boolean; classroomManagement: boolean; contentAuthoring: boolean };
  /** IANA name, or null until the browser has reported one. */
  timeZone: string | null;
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function summarizeUserAgent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const browser = /Edg\//.test(value)
    ? 'Edge'
    : /Firefox\//.test(value)
      ? 'Firefox'
      : /Chrome\//.test(value)
        ? 'Chrome'
        : /Safari\//.test(value)
          ? 'Safari'
          : 'Браузер';
  const platform = /Windows/.test(value)
    ? 'Windows'
    : /Android/.test(value)
      ? 'Android'
      : /iPhone|iPad/.test(value)
        ? 'iOS'
        : /Macintosh/.test(value)
          ? 'macOS'
          : /Linux/.test(value)
            ? 'Linux'
            : 'устройство';
  return `${browser} · ${platform}`;
}

interface LocalPreviewCredentials {
  email: string;
  password: string;
}

function localPreviewCredentials(request: FastifyRequest): LocalPreviewCredentials | null {
  if (process.env['NODE_ENV'] === 'production' || process.env['ASA_LOCAL_PREVIEW_LOGIN'] !== '1') {
    return null;
  }

  const configuredOrigin = process.env['ASA_LOCAL_PREVIEW_ORIGIN'];
  const email = process.env['ASA_LOCAL_PREVIEW_EMAIL'];
  const password = process.env['ASA_LOCAL_PREVIEW_PASSWORD'];
  if (!configuredOrigin || !email || !password) return null;

  let expectedOrigin: URL;
  try {
    expectedOrigin = new URL(configuredOrigin);
  } catch {
    return null;
  }
  if (
    expectedOrigin.protocol !== 'http:' ||
    (expectedOrigin.hostname !== '127.0.0.1' && expectedOrigin.hostname !== 'localhost')
  ) {
    return null;
  }

  const socketAddress = request.raw.socket.remoteAddress?.toLowerCase();
  if (
    socketAddress !== '127.0.0.1' &&
    socketAddress !== '::1' &&
    socketAddress !== '::ffff:127.0.0.1'
  ) {
    return null;
  }

  if (request.headers.host !== expectedOrigin.host) return null;
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin !== expectedOrigin.origin) return null;
  return { email, password };
}

@Controller('api/auth')
export class AuthController {
  private readonly loginByAddress = new FixedWindowRateLimiter({
    limit: LOGIN_PER_ADDRESS,
    windowMs: LOGIN_WINDOW_MS,
  });
  private readonly loginByIdentifier = new FixedWindowRateLimiter({
    limit: LOGIN_PER_IDENTIFIER,
    windowMs: LOGIN_WINDOW_MS,
  });
  private readonly registerByAddress = new FixedWindowRateLimiter({
    limit: REGISTER_PER_ADDRESS,
    windowMs: REGISTER_WINDOW_MS,
  });
  private readonly challengesByAddress = new FixedWindowRateLimiter({
    limit: BOT_CHALLENGE_PER_ADDRESS,
    windowMs: BOT_CHALLENGE_WINDOW_MS,
  });
  private readonly maxAuthByAddress = new FixedWindowRateLimiter({
    limit: MAX_AUTH_PER_ADDRESS,
    windowMs: LOGIN_WINDOW_MS,
  });
  private readonly pairingPollByAddress = new FixedWindowRateLimiter({
    limit: PAIRING_POLL_PER_ADDRESS,
    windowMs: 60_000,
  });
  private readonly pairingPollByChallenge = new FixedWindowRateLimiter({
    limit: PAIRING_POLL_PER_CHALLENGE,
    windowMs: 60_000,
  });

  constructor(
    @Inject(TOKENS.loginUseCase) private readonly legacyLoginUseCase: LoginUseCase,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.registerAccountUseCase) private readonly registerUseCase: RegisterAccountUseCase,
    @Inject(TOKENS.accountLoginUseCase) private readonly accountLoginUseCase: AccountLoginUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.botChallengeService) private readonly botChallenges: BotChallengeService,
    @Inject(TOKENS.maxAuthService) private readonly maxAuth: MaxAuthService,
    @Inject(TOKENS.telegramAuthService) private readonly telegramAuth: TelegramAuthService,
    @Inject(TOKENS.accountVerification) private readonly verification: AccountVerificationService,
    @Inject(TOKENS.refreshSessionService)
    private readonly refreshSessions: RefreshSessionService,
    @Inject(TOKENS.productAnalytics)
    private readonly analytics: ProductAnalyticsService,
    @Inject(TOKENS.seatContextUseCase)
    private readonly seats: SeatContextUseCase,
  ) {}

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env['NODE_ENV'] === 'production' || process.env['ASA_SECURE_COOKIES'] === '1',
      maxAge: 12 * 60 * 60,
    });
  }

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      secure: process.env['NODE_ENV'] === 'production' || process.env['ASA_SECURE_COOKIES'] === '1',
      maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
    });
  }

  private clearSessionCookies(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie('asa_student_session', { path: '/' });
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  private authFlow(request: FastifyRequest, reply: FastifyReply): string {
    const existing = request.cookies[AUTH_FLOW_COOKIE];
    const flowId = existing && UUID_PATTERN.test(existing) ? existing : randomUUID();
    if (flowId !== existing) {
      reply.setCookie(AUTH_FLOW_COOKIE, flowId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/auth',
        secure:
          process.env['NODE_ENV'] === 'production' || process.env['ASA_SECURE_COOKIES'] === '1',
        maxAge: AUTH_FLOW_MAX_AGE_SECONDS,
      });
    }
    return flowId;
  }

  private closeAuthFlow(reply: FastifyReply): void {
    reply.clearCookie(AUTH_FLOW_COOKIE, { path: '/api/auth' });
  }

  private analyticsOutcome(failure: unknown): AnalyticsOutcome {
    const status = failure instanceof HttpException ? failure.getStatus() : 500;
    return status === 403 || status === 429 ? 'blocked' : 'failed';
  }

  private recordAuth(input: {
    readonly eventType: AnalyticsEventType;
    readonly method: AnalyticsAuthMethod;
    readonly outcome: AnalyticsOutcome;
    readonly flowId: string;
    readonly receivedAt: string;
    readonly address: string;
    readonly networkKind: ClientNetworkKind;
    readonly userAgent: string | undefined;
    readonly context?: ActiveContext;
  }): void {
    this.analytics.enqueueEvent({
      actor: input.context ? { kind: 'account', context: input.context } : { kind: 'anonymous' },
      eventType: input.eventType,
      outcome: input.outcome,
      authMethod: input.method,
      flowId: input.flowId,
      address: input.address,
      networkKind: input.networkKind,
      userAgent: input.userAgent,
      receivedAt: input.receivedAt,
    });
  }

  private async establishSession(
    reply: FastifyReply,
    accessToken: string,
    source: SessionSource,
  ): Promise<void> {
    const refreshToken = await this.refreshSessions.attach(accessToken, source);
    reply.clearCookie('asa_student_session', { path: '/' });
    this.setSessionCookie(reply, accessToken);
    if (refreshToken) this.setRefreshCookie(reply, refreshToken);
  }

  private async payload(context: ActiveContext): Promise<SessionPayload> {
    const [capabilities, workspaces, timeZone, verification] = await Promise.all([
      this.accounts.capabilities(context.accountId),
      this.accounts.workspaces(context.accountId),
      this.accounts.timeZone(context.accountId),
      this.verification.forAccount(context.accountId),
    ]);
    if (!verification) throw new HttpException(error('unauthorized', 'account is not active'), 401);
    const actions = verification.required
      ? []
      : effectiveAccountActions(context, capabilities, workspaces);
    const account = {
      identityKind: 'account' as const,
      id: context.accountId,
      displayName: context.displayName,
      email: context.email,
    };
    return {
      authenticated: true,
      verification,
      user: account,
      account,
      capabilities: (verification.required ? [] : capabilities).map((entry) => ({
        capability: entry.capability,
        state: entry.state,
      })),
      workspaces: workspaces.map((entry) => ({
        workspaceId: entry.workspaceId,
        kind: entry.kind,
        title: entry.title,
        role: entry.role,
      })),
      activeWorkspace: {
        workspaceId: context.workspaceId,
        kind: context.workspaceKind,
      },
      actions,
      navigation: {
        classes: actions.includes('class.create') || actions.includes('class.read.staff'),
        classroomManagement: actions.includes('class.read.staff'),
        contentAuthoring: actions.includes('content.create.own'),
      },
      timeZone,
    };
  }

  private enforce(limiter: FixedWindowRateLimiter, key: string): void {
    const decision = limiter.consume(key);
    if (!decision.allowed) {
      throw new HttpException(
        {
          error: {
            code: 'too_many_attempts',
            message: 'Слишком много попыток. Подождите несколько минут.',
            retryAfterSeconds: decision.retryAfterSeconds,
          },
        },
        429,
      );
    }
  }

  private async requireContext(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return context;
  }

  private throwMaxValidation(problem: unknown): never {
    this.throwProviderFailure(problem, 'max');
  }

  @Get('max/config')
  @AllowUnverifiedAccount()
  async maxConfig(): Promise<{ enabled: boolean; launchUrl: string | null }> {
    return this.maxAuth.config();
  }

  @Get('providers')
  @AllowUnverifiedAccount()
  async providers(@Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('Cache-Control', 'no-store');
    return { providers: await this.verification.getProviders() };
  }

  @Get('verification')
  @AllowUnverifiedAccount()
  async verificationStatus(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('Cache-Control', 'no-store');
    const context = await this.requireContext(request);
    const state = await this.verification.forAccount(context.accountId);
    if (!state) throw new HttpException(error('unauthorized', 'account is not active'), 401);
    return state;
  }

  private providerService(provider: 'max' | 'telegram') {
    return provider === 'max' ? this.maxAuth : this.telegramAuth;
  }

  private pairingCookieName(provider: 'max' | 'telegram', pairingToken: string): string {
    return `asa_pairing_${provider}_${createHash('sha256').update(pairingToken).digest('hex').slice(0, 24)}`;
  }

  private validPairingToken(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value))
      throw new HttpException(error('validation_error', 'pairingToken is invalid'), 400);
    return value;
  }

  private throwProviderFailure(problem: unknown, _provider: 'max' | 'telegram'): never {
    if (problem instanceof ProviderConfigurationError)
      throw new HttpException(
        error(
          `${_provider}_auth_unavailable`,
          'Этот способ входа временно недоступен. Используйте пароль.',
        ),
        503,
      );
    if (problem instanceof ProviderOperationError) {
      const messages: Record<ProviderOperationError['code'], string> = {
        last_sign_in_method: 'Сначала настройте пароль или подключите другой способ входа.',
        identity_revoked: 'Эта привязка отозвана администратором. Обратитесь к администратору.',
        identity_taken: 'Этот профиль уже связан с другим аккаунтом ASA Lab.',
        account_already_linked: 'К вашему аккаунту уже привязан другой профиль этого сервиса.',
        account_suspended: 'Доступ к аккаунту приостановлен.',
      };
      throw new HttpException(
        error(problem.code, messages[problem.code]),
        problem.code === 'account_suspended' ? 403 : 409,
      );
    }
    if (problem instanceof ProviderInitDataError) {
      const unavailable =
        problem.code.endsWith('_auth_disabled') || problem.code.endsWith('_auth_unavailable');
      throw new HttpException(
        error(
          problem.code,
          unavailable
            ? 'Этот способ входа сейчас недоступен. Используйте пароль.'
            : 'Не удалось подтвердить данные входа. Откройте приложение заново.',
        ),
        unavailable ? 503 : 401,
      );
    }
    throw problem;
  }

  private async startProviderPairing(
    provider: 'max' | 'telegram',
    rawBody: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    this.enforce(this.maxAuthByAddress, clientAddress(request));
    this.authFlow(request, reply);
    const shape = checkBodyShape(rawBody ?? {}, ['purpose']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const purpose = shape.body['purpose'] ?? 'login';
    if (purpose !== 'login' && purpose !== 'register' && purpose !== 'link')
      throw new HttpException(error('validation_error', 'unknown pairing purpose'), 400);
    const requestedAccountId =
      purpose === 'link' ? (await this.requireContext(request)).accountId : undefined;
    try {
      const result = await this.providerService(provider).startPairing(requestedAccountId, purpose);
      reply.setCookie(this.pairingCookieName(provider, result.pairingToken), result.browserNonce, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/auth',
        secure:
          process.env['NODE_ENV'] === 'production' || process.env['ASA_SECURE_COOKIES'] === '1',
        maxAge: 10 * 60,
      });
      void reply.header('Cache-Control', 'no-store');
      return {
        pairingToken: result.pairingToken,
        launchUrl: result.launchUrl,
        expiresAt: result.expiresAt,
      };
    } catch (problem) {
      this.throwProviderFailure(problem, provider);
    }
  }

  private async finishProviderSession(
    provider: 'max' | 'telegram',
    token: string,
    request: FastifyRequest,
    reply: FastifyReply,
    registration = false,
  ): Promise<SessionPayload> {
    await this.establishSession(reply, token, provider);
    const context = await this.activeContext.resolve(token);
    if (!context) throw new HttpException(error('server_error', 'session was not created'), 500);
    const connection = clientConnection(request);
    this.recordAuth({
      receivedAt: requestReceivedAt(request),
      eventType: registration ? 'auth.register' : provider === 'max' ? 'auth.max' : 'auth.telegram',
      method: provider,
      outcome: 'succeeded',
      flowId: this.authFlow(request, reply),
      address: connection.address,
      networkKind: connection.networkKind,
      userAgent: request.headers['user-agent'],
      context,
    });
    this.closeAuthFlow(reply);
    return this.payload(context);
  }

  private async completeProviderPairing(
    provider: 'max' | 'telegram',
    rawBody: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    this.enforce(this.pairingPollByAddress, clientAddress(request));
    const shape = checkBodyShape(rawBody, ['pairingToken']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const token = this.validPairingToken(shape.body['pairingToken']);
    const cookie = this.pairingCookieName(provider, token);
    this.enforce(this.pairingPollByChallenge, cookie);
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    let result;
    try {
      result = await this.providerService(provider).consumePairing(
        token,
        summarizeUserAgent(request.headers['user-agent']),
        request.cookies[cookie],
        context?.accountId,
      );
    } catch (problem) {
      if (problem instanceof ProviderOperationError)
        reply.clearCookie(cookie, { path: '/api/auth' });
      this.throwProviderFailure(problem, provider);
    }
    if (result.status === 'pending') return { status: 'pending' as const };
    if (result.status === 'registration_required')
      return { status: 'registration_required' as const, profile: result.profile };
    reply.clearCookie(cookie, { path: '/api/auth' });
    if (result.status === 'expired' || result.status === 'consumed')
      throw new HttpException(
        error(`${provider}_pairing_expired`, 'Запрос входа истёк. Начните вход заново.'),
        410,
      );
    if (result.status === 'unavailable')
      throw new HttpException(
        error(
          `${provider}_auth_unavailable`,
          'Этот способ входа временно недоступен. Используйте пароль.',
        ),
        503,
      );
    if (result.status === 'linked') {
      if (context?.accountId !== result.accountId)
        throw new HttpException(
          error('unauthorized', 'link requires the original account session'),
          401,
        );
      return { status: 'linked' as const, linked: true as const };
    }
    if (result.status !== 'authenticated')
      throw new HttpException(
        error(`${provider}_pairing_invalid`, 'Запрос входа недействителен.'),
        400,
      );
    return {
      status: 'authenticated' as const,
      session: await this.finishProviderSession(provider, result.token, request, reply),
    };
  }

  private registrationFailure(
    result: { status: string; message?: string; routes?: readonly unknown[] },
    provider: 'max' | 'telegram',
  ): never {
    if (result.status === 'age_routed')
      throw new HttpException(
        { error: { code: result.status, message: result.message, routes: result.routes } },
        422,
      );
    const messages: Record<string, string> = {
      email_taken:
        'Аккаунт с таким email уже существует. Войдите с паролем и подключите этот способ к нему.',
      username_taken: 'Это имя пользователя уже занято.',
      identity_taken: 'Этот профиль уже связан с другим аккаунтом ASA Lab.',
      assertion_replayed: 'Запрос уже использован. Начните вход заново.',
      unavailable: 'Регистрация этим способом временно недоступна.',
      expired: 'Запрос регистрации истёк. Начните заново.',
      invalid: 'Запрос регистрации недействителен.',
    };
    const status = [
      'email_taken',
      'username_taken',
      'identity_taken',
      'assertion_replayed',
    ].includes(result.status)
      ? 409
      : result.status === 'unavailable'
        ? 503
        : result.status === 'expired'
          ? 410
          : 400;
    throw new HttpException(
      error(
        result.status === 'unavailable' ? `${provider}_auth_unavailable` : result.status,
        result.message ?? messages[result.status] ?? 'Проверьте данные профиля.',
      ),
      status,
    );
  }

  private async registerProviderPairing(
    provider: 'max' | 'telegram',
    rawBody: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionPayload> {
    this.enforce(this.registerByAddress, clientAddress(request));
    this.enforce(this.maxAuthByAddress, clientAddress(request));
    const shape = checkBodyShape(rawBody, [
      'pairingToken',
      'email',
      'username',
      'displayName',
      'birthDate',
      'country',
      'password',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const token = this.validPairingToken(shape.body['pairingToken']);
    const cookie = this.pairingCookieName(provider, token);
    // Registration belongs to the anonymous attempt. A later password login
    // must not be replaced by a delayed profile submission from that attempt.
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (context) {
      reply.clearCookie(cookie, { path: '/api/auth' });
      throw new HttpException(
        error(`${provider}_pairing_invalid`, 'Запрос регистрации недействителен.'),
        400,
      );
    }
    let result;
    try {
      result = await this.providerService(provider).registerPairing(
        token,
        request.cookies[cookie],
        {
          email: shape.body['email'],
          username: shape.body['username'],
          displayName: shape.body['displayName'],
          birthDate: shape.body['birthDate'],
          country: shape.body['country'],
          password: shape.body['password'],
        },
        summarizeUserAgent(request.headers['user-agent']),
      );
    } catch (problem) {
      if (problem instanceof ProviderOperationError)
        reply.clearCookie(cookie, { path: '/api/auth' });
      this.throwProviderFailure(problem, provider);
    }
    if (result.status !== 'authenticated') {
      // Profile corrections can reuse the approved proof until its expiry.
      // Invalid/used proofs and provider failures require a new browser challenge.
      if (
        !['validation_error', 'age_routed', 'email_taken', 'username_taken'].includes(result.status)
      )
        reply.clearCookie(cookie, { path: '/api/auth' });
      this.registrationFailure(result, provider);
    }
    reply.clearCookie(cookie, { path: '/api/auth' });
    return this.finishProviderSession(provider, result.token, request, reply, true);
  }

  @Post('max/pairing/start')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async startMaxPairing(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.startProviderPairing('max', body, request, reply);
  }

  @Post('telegram/pairing/start')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async startTelegramPairing(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.startProviderPairing('telegram', body, request, reply);
  }

  @Post('max/pairing/complete')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async completeMaxPairing(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.completeProviderPairing('max', body, request, reply);
  }

  @Post('telegram/pairing/complete')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async completeTelegramPairing(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.completeProviderPairing('telegram', body, request, reply);
  }

  @Post('max/pairing/register')
  @HttpCode(201)
  @AllowUnverifiedAccount()
  async registerMaxPairing(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.registerProviderPairing('max', body, request, reply);
  }

  @Post('telegram/pairing/register')
  @HttpCode(201)
  @AllowUnverifiedAccount()
  async registerTelegramPairing(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.registerProviderPairing('telegram', body, request, reply);
  }

  @Get('max/status')
  @AllowUnverifiedAccount()
  async maxStatus(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    const status = await this.maxAuth.status(context.accountId);
    if (!status) throw new HttpException(error('unauthorized', 'account is not active'), 401);
    return { ...status, available: (await this.maxAuth.availability()).available };
  }

  @Post('max/prompt/dismiss')
  @HttpCode(200)
  async dismissMaxPrompt(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    return { dismissedUntil: await this.maxAuth.dismissPrompt(context.accountId) };
  }

  @Post('max/unlink')
  @HttpCode(200)
  async unlinkMax(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    try {
      return { unlinked: await this.maxAuth.unlink(context.accountId, context.principalId) };
    } catch (problem) {
      this.throwProviderFailure(problem, 'max');
    }
  }

  @Post('max/session')
  @AllowUnverifiedAccount()
  @HttpCode(200)
  async maxSession(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    const connection = clientConnection(request);
    const address = connection.address;
    const flowId = this.authFlow(request, reply);
    try {
      this.enforce(this.maxAuthByAddress, address);
      const shape = checkBodyShape(rawBody, ['initData']);
      if (!shape.ok || typeof shape.body['initData'] !== 'string') {
        throw new HttpException(error('validation_error', 'initData is required'), 400);
      }
      let result;
      try {
        result = await this.maxAuth.signIn(
          shape.body['initData'],
          summarizeUserAgent(request.headers['user-agent']),
        );
      } catch (problem) {
        this.throwMaxValidation(problem);
      }
      if (result.status === 'link_required') {
        throw new HttpException(
          error('max_link_required', 'Сначала привяжите MAX к существующему аккаунту ASA Lab.'),
          409,
        );
      }
      if (result.status === 'assertion_replayed') {
        throw new HttpException(
          error(
            'max_assertion_replayed',
            'Эта ссылка MAX уже использована. Откройте приложение заново.',
          ),
          409,
        );
      }
      if (result.status === 'account_suspended') {
        throw new HttpException(error('account_suspended', 'Учётная запись приостановлена.'), 403);
      }
      if (result.status === 'identity_revoked')
        this.throwProviderFailure(new ProviderOperationError('identity_revoked'), 'max');
      if (result.status !== 'authenticated') {
        throw new HttpException(
          error('max_auth_unavailable', 'Вход через MAX временно недоступен.'),
          503,
        );
      }

      await this.establishSession(reply, result.token, 'max');
      const context = await this.activeContext.resolve(result.token);
      if (!context) {
        throw new HttpException(error('server_error', 'session was not created'), 500);
      }
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.max',
        method: 'max',
        outcome: 'succeeded',
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
        context,
      });
      this.closeAuthFlow(reply);
      return this.payload(context);
    } catch (failure) {
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.max',
        method: 'max',
        outcome: this.analyticsOutcome(failure),
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
      });
      throw failure;
    }
  }

  @Post('max/register')
  @AllowUnverifiedAccount()
  @HttpCode(201)
  async maxRegister(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    const connection = clientConnection(request);
    const address = connection.address;
    const flowId = this.authFlow(request, reply);
    try {
      this.enforce(this.registerByAddress, address);
      this.enforce(this.maxAuthByAddress, address);
      const shape = checkBodyShape(rawBody, [
        'initData',
        'email',
        'username',
        'displayName',
        'birthDate',
        'country',
        'password',
      ]);
      if (!shape.ok || typeof shape.body['initData'] !== 'string') {
        throw new HttpException(
          error('validation_error', shape.ok ? 'initData is required' : shape.message),
          400,
        );
      }
      let result;
      try {
        result = await this.maxAuth.register(shape.body['initData'], {
          email: shape.body['email'],
          username: shape.body['username'],
          displayName: shape.body['displayName'],
          birthDate: shape.body['birthDate'],
          country: shape.body['country'],
          password: shape.body['password'],
        });
      } catch (problem) {
        this.throwMaxValidation(problem);
      }
      if (result.status !== 'authenticated') {
        const messages: Record<string, string> = {
          email_taken: 'Аккаунт с таким email уже существует. Выберите «У меня есть аккаунт».',
          username_taken: 'Это имя пользователя уже занято.',
          identity_taken: 'Этот профиль MAX уже связан с другим аккаунтом.',
          assertion_replayed: 'Откройте бота MAX заново.',
          unavailable: 'Регистрация через MAX временно недоступна.',
        };
        if (result.status === 'age_routed') {
          throw new HttpException(
            { error: { code: result.status, message: result.message, routes: result.routes } },
            422,
          );
        }
        const status =
          result.status === 'email_taken' ||
          result.status === 'username_taken' ||
          result.status === 'identity_taken' ||
          result.status === 'assertion_replayed'
            ? 409
            : result.status === 'unavailable'
              ? 503
              : 400;
        throw new HttpException(
          error(result.status, result.message ?? messages[result.status] ?? 'Проверьте данные.'),
          status,
        );
      }
      await this.establishSession(reply, result.token, 'max');
      const context = await this.activeContext.resolve(result.token);
      if (!context) throw new HttpException(error('server_error', 'session was not created'), 500);
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.register',
        method: 'max',
        outcome: 'succeeded',
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
        context,
      });
      this.closeAuthFlow(reply);
      return this.payload(context);
    } catch (failure) {
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.register',
        method: 'max',
        outcome: this.analyticsOutcome(failure),
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
      });
      throw failure;
    }
  }

  @Post('max/webhook')
  @AllowUnverifiedAccount()
  @HttpCode(200)
  async maxWebhook(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ ok: true } | IngressProbeResponse> {
    let result;
    try {
      result = await this.maxAuth.handleWebhook(request.headers['x-max-bot-api-secret'], body);
    } catch (problem) {
      this.throwProviderFailure(problem, 'max');
    }
    if (result === 'unauthorized') {
      throw new HttpException(error('unauthorized', 'invalid MAX webhook secret'), 401);
    }
    return typeof result === 'object' ? result : { ok: true };
  }

  @Post('max/link')
  @AllowUnverifiedAccount()
  @HttpCode(200)
  async maxLink(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ linked: true }> {
    this.enforce(this.maxAuthByAddress, clientAddress(request));
    const shape = checkBodyShape(rawBody, ['initData']);
    if (!shape.ok || typeof shape.body['initData'] !== 'string') {
      throw new HttpException(error('validation_error', 'initData is required'), 400);
    }
    const context = await this.requireContext(request);
    let result;
    try {
      result = await this.maxAuth.link(context.accountId, shape.body['initData']);
    } catch (problem) {
      this.throwMaxValidation(problem);
    }
    if (result.status === 'linked' || result.status === 'already_linked') {
      return { linked: true };
    }
    if (result.status === 'identity_taken') {
      throw new HttpException(
        error('max_identity_taken', 'Этот профиль MAX уже связан с другим аккаунтом.'),
        409,
      );
    }
    if (result.status === 'account_already_linked') {
      throw new HttpException(
        error('max_account_already_linked', 'К аккаунту уже привязан другой профиль MAX.'),
        409,
      );
    }
    if (result.status === 'assertion_replayed') {
      throw new HttpException(
        error(
          'max_assertion_replayed',
          'Эта ссылка MAX уже использована. Откройте приложение заново.',
        ),
        409,
      );
    }
    if (result.status === 'account_suspended') {
      throw new HttpException(error('account_suspended', 'Учётная запись приостановлена.'), 403);
    }
    if (result.status === 'identity_revoked')
      this.throwProviderFailure(new ProviderOperationError('identity_revoked'), 'max');
    throw new HttpException(
      error('max_auth_unavailable', 'Привязка MAX временно недоступна.'),
      503,
    );
  }

  @Get('telegram/config')
  @AllowUnverifiedAccount()
  async telegramConfig() {
    return this.telegramAuth.config();
  }

  @Get('telegram/status')
  @AllowUnverifiedAccount()
  async telegramStatus(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    const status = await this.telegramAuth.status(context.accountId);
    if (!status) throw new HttpException(error('unauthorized', 'account is not active'), 401);
    return { ...status, available: (await this.telegramAuth.availability()).available };
  }

  @Post('telegram/unlink')
  @HttpCode(200)
  async unlinkTelegram(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    try {
      return { unlinked: await this.telegramAuth.unlink(context.accountId, context.principalId) };
    } catch (problem) {
      this.throwProviderFailure(problem, 'telegram');
    }
  }

  @Post('telegram/webhook')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async telegramWebhook(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ ok: true } | IngressProbeResponse> {
    let result;
    try {
      result = await this.telegramAuth.handleWebhook(
        request.headers['x-telegram-bot-api-secret-token'],
        body,
      );
    } catch (problem) {
      this.throwProviderFailure(problem, 'telegram');
    }
    if (result === 'unauthorized')
      throw new HttpException(error('unauthorized', 'invalid Telegram webhook secret'), 401);
    return typeof result === 'object' ? result : { ok: true };
  }

  @Post('telegram/session')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async telegramSession(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    this.enforce(this.maxAuthByAddress, clientAddress(request));
    const shape = checkBodyShape(body, ['initData']);
    if (!shape.ok || typeof shape.body['initData'] !== 'string')
      throw new HttpException(error('validation_error', 'initData is required'), 400);
    let result;
    try {
      result = await this.telegramAuth.signIn(
        shape.body['initData'],
        summarizeUserAgent(request.headers['user-agent']),
      );
    } catch (problem) {
      this.throwProviderFailure(problem, 'telegram');
    }
    if (result.status === 'link_required')
      throw new HttpException(
        error(
          'telegram_link_required',
          'Войдите в существующий аккаунт или завершите регистрацию профиля.',
        ),
        409,
      );
    if (result.status === 'account_suspended')
      throw new HttpException(error('account_suspended', 'Доступ к аккаунту приостановлен.'), 403);
    if (result.status === 'identity_revoked')
      this.throwProviderFailure(new ProviderOperationError('identity_revoked'), 'telegram');
    if (result.status === 'assertion_replayed')
      throw new HttpException(
        error('telegram_assertion_replayed', 'Запрос уже использован. Откройте приложение заново.'),
        409,
      );
    if (result.status !== 'authenticated')
      throw new HttpException(
        error('telegram_auth_unavailable', 'Telegram сейчас недоступен. Используйте пароль.'),
        503,
      );
    return this.finishProviderSession('telegram', result.token, request, reply);
  }

  @Post('telegram/register')
  @HttpCode(201)
  @AllowUnverifiedAccount()
  async telegramRegister(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    this.enforce(this.registerByAddress, clientAddress(request));
    this.enforce(this.maxAuthByAddress, clientAddress(request));
    const shape = checkBodyShape(body, [
      'initData',
      'email',
      'username',
      'displayName',
      'birthDate',
      'country',
      'password',
    ]);
    if (!shape.ok || typeof shape.body['initData'] !== 'string')
      throw new HttpException(error('validation_error', 'initData is required'), 400);
    let result;
    try {
      result = await this.telegramAuth.register(shape.body['initData'], {
        email: shape.body['email'],
        username: shape.body['username'],
        displayName: shape.body['displayName'],
        birthDate: shape.body['birthDate'],
        country: shape.body['country'],
        password: shape.body['password'],
      });
    } catch (problem) {
      this.throwProviderFailure(problem, 'telegram');
    }
    if (result.status !== 'authenticated') this.registrationFailure(result, 'telegram');
    return this.finishProviderSession('telegram', result.token, request, reply, true);
  }

  @Post('telegram/link')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async telegramLink(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ linked: true }> {
    this.enforce(this.maxAuthByAddress, clientAddress(request));
    const context = await this.requireContext(request);
    const shape = checkBodyShape(body, ['initData']);
    if (!shape.ok || typeof shape.body['initData'] !== 'string')
      throw new HttpException(error('validation_error', 'initData is required'), 400);
    let result;
    try {
      result = await this.telegramAuth.link(context.accountId, shape.body['initData']);
    } catch (problem) {
      this.throwProviderFailure(problem, 'telegram');
    }
    if (result.status === 'linked' || result.status === 'already_linked') return { linked: true };
    if (result.status === 'account_suspended')
      throw new HttpException(error('account_suspended', 'Доступ к аккаунту приостановлен.'), 403);
    if (result.status === 'identity_revoked')
      this.throwProviderFailure(new ProviderOperationError('identity_revoked'), 'telegram');
    if (result.status === 'unavailable')
      throw new HttpException(
        error('telegram_auth_unavailable', 'Привязка Telegram временно недоступна.'),
        503,
      );
    const messages: Record<string, string> = {
      identity_taken: 'Этот Telegram уже привязан к другому аккаунту.',
      account_already_linked: 'К аккаунту уже подключён другой Telegram.',
      assertion_replayed: 'Запрос уже использован. Откройте приложение заново.',
    };
    throw new HttpException(
      error(`telegram_${result.status}`, messages[result.status] ?? 'Привязка не выполнена.'),
      409,
    );
  }

  @Get('bot-challenge')
  @AllowUnverifiedAccount()
  botChallenge(@Query('action') action: string | undefined, @Req() request: FastifyRequest) {
    if (action !== 'login' && action !== 'register' && action !== 'class_join') {
      throw new HttpException(error('validation_error', 'unknown bot-check action'), 400);
    }
    const address = clientAddress(request);
    this.enforce(this.challengesByAddress, address);
    return {
      required: this.botChallenges.isRequired(),
      challenge: this.botChallenges.issue(action as BotAction, request.headers['user-agent']),
    };
  }

  @Get('local-preview/config')
  @AllowUnverifiedAccount()
  localPreviewConfig(@Req() request: FastifyRequest): { enabled: boolean } {
    return { enabled: localPreviewCredentials(request) !== null };
  }

  @Post('local-preview/session')
  @AllowUnverifiedAccount()
  @HttpCode(200)
  async localPreviewSession(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    const credentials = localPreviewCredentials(request);
    if (!credentials) {
      throw new HttpException(error('not_found', 'not found'), 404);
    }

    const summary = summarizeUserAgent(request.headers['user-agent']);
    const login = await this.accountLoginUseCase.execute({
      identifier: credentials.email,
      password: credentials.password,
      ...(summary === undefined ? {} : { userAgentSummary: summary }),
    });
    let token: string;
    if (login.ok) {
      token = login.token;
    } else {
      const registered = await this.registerUseCase.execute({
        email: credentials.email,
        password: credentials.password,
        username: 'preview-owner',
        displayName: 'Локальный preview',
        birthDate: '1990-01-01',
        country: 'RU',
      });
      if (!registered.ok) {
        throw new HttpException(
          error('preview_login_unavailable', 'Локальный preview-вход недоступен.'),
          503,
        );
      }
      token = registered.token;
    }

    await this.establishSession(reply, token, 'password');
    const context = await this.activeContext.resolve(token);
    if (!context) {
      throw new HttpException(error('server_error', 'session was not created'), 500);
    }
    return this.payload(context);
  }

  @Post('register')
  @AllowUnverifiedAccount()
  @HttpCode(201)
  async register(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    const connection = clientConnection(request);
    const address = connection.address;
    const flowId = this.authFlow(request, reply);
    try {
      this.enforce(this.registerByAddress, address);
      const shape = checkBodyShape(rawBody, [
        'email',
        'password',
        'username',
        'displayName',
        'birthDate',
        'country',
        'botProof',
      ]);
      if (!shape.ok) {
        throw new HttpException(error('validation_error', shape.message), 400);
      }
      if (
        !this.botChallenges.verify(
          'register',
          shape.body['botProof'],
          request.headers['user-agent'],
        )
      ) {
        throw new HttpException(error('bot_check_required', 'Подтвердите, что вы не робот.'), 403);
      }
      const result = await this.registerUseCase.execute({
        email: shape.body['email'],
        password: shape.body['password'],
        username: shape.body['username'],
        displayName: shape.body['displayName'],
        birthDate: shape.body['birthDate'],
        country: shape.body['country'],
      });
      if (!result.ok) {
        if (result.code === 'age_routed') {
          throw new HttpException(
            { error: { code: result.code, message: result.message, routes: result.routes } },
            422,
          );
        }
        const status =
          result.code === 'email_taken' || result.code === 'username_taken' ? 409 : 400;
        throw new HttpException(error(result.code, result.message), status);
      }
      await this.establishSession(reply, result.token, 'password');
      const context = await this.activeContext.resolve(result.token);
      if (!context) {
        throw new HttpException(error('server_error', 'session was not created'), 500);
      }
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.register',
        method: 'password',
        outcome: 'succeeded',
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
        context,
      });
      this.closeAuthFlow(reply);
      return this.payload(context);
    } catch (failure) {
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.register',
        method: 'password',
        outcome: this.analyticsOutcome(failure),
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
      });
      throw failure;
    }
  }

  @Get('username-available')
  @AllowUnverifiedAccount()
  async usernameAvailable(
    @Query('username') username: string | undefined,
  ): Promise<{ available: boolean }> {
    if (typeof username !== 'string' || username.trim().length < 3) {
      return { available: false };
    }
    return { available: await this.accounts.isUsernameAvailable(username.trim().toLowerCase()) };
  }

  @Post('login')
  @AllowUnverifiedAccount()
  @HttpCode(200)
  async login(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    const connection = clientConnection(request);
    const address = connection.address;
    const flowId = this.authFlow(request, reply);
    let method: AnalyticsAuthMethod = 'password';
    try {
      this.enforce(this.loginByAddress, address);
      const shape = checkBodyShape(rawBody, [
        'workspace',
        'identifier',
        'email',
        'password',
        'botProof',
      ]);
      if (!shape.ok) {
        throw new HttpException(error('validation_error', shape.message), 400);
      }
      if (
        !this.botChallenges.verify('login', shape.body['botProof'], request.headers['user-agent'])
      ) {
        throw new HttpException(error('bot_check_required', 'Подтвердите, что вы не робот.'), 403);
      }
      const identifier = shape.body['identifier'] ?? shape.body['email'];
      if (typeof identifier === 'string' && identifier.length > 0) {
        this.enforce(this.loginByIdentifier, identifier.trim().toLowerCase());
      }
      const organizationLogin = shape.body['workspace'] !== undefined;
      method = organizationLogin ? 'organization' : 'password';
      const token = organizationLogin
        ? await this.legacySignIn(shape.body)
        : await this.accountSignIn(shape.body, summarizeUserAgent(request.headers['user-agent']));
      await this.establishSession(reply, token, method);
      const context = await this.activeContext.resolve(token);
      if (!context) {
        throw new HttpException(error('server_error', 'session was not created'), 500);
      }
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.login',
        method,
        outcome: 'succeeded',
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
        context,
      });
      this.closeAuthFlow(reply);
      return this.payload(context);
    } catch (failure) {
      this.recordAuth({
        receivedAt: requestReceivedAt(request),
        eventType: 'auth.login',
        method,
        outcome: this.analyticsOutcome(failure),
        flowId,
        address,
        networkKind: connection.networkKind,
        userAgent: request.headers['user-agent'],
      });
      throw failure;
    }
  }

  private async accountSignIn(
    body: Record<string, unknown>,
    userAgentSummary: string | undefined,
  ): Promise<string> {
    const credentials = {
      identifier: body['identifier'] ?? body['email'],
      password: body['password'],
      ...(userAgentSummary === undefined ? {} : { userAgentSummary }),
    };
    const result = await this.accountLoginUseCase.execute(credentials);
    if (!result.ok) {
      if (result.code === 'validation_error') {
        throw new HttpException(
          error('validation_error', 'identifier and password are required'),
          400,
        );
      }
      throw new HttpException(
        error('invalid_credentials', 'invalid email, username or password'),
        401,
      );
    }
    return result.token;
  }

  private async legacySignIn(body: Record<string, unknown>): Promise<string> {
    const result = await this.legacyLoginUseCase.execute({
      workspace: body['workspace'],
      email: body['email'],
      password: body['password'],
    });
    if (!result.ok) {
      if (result.code === 'validation_error') {
        throw new HttpException(
          error('validation_error', 'workspace, email and password are required'),
          400,
        );
      }
      throw new HttpException(
        error('invalid_credentials', 'invalid workspace, email or password'),
        401,
      );
    }
    return result.token;
  }

  @Post('logout')
  @AllowUnverifiedAccount()
  @HttpCode(200)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.refreshSessions.revoke(
      request.cookies[REFRESH_COOKIE],
      request.cookies[SESSION_COOKIE],
      request.cookies[STUDENT_SESSION_COOKIE],
    );
    await this.activeContext.logout(request.cookies[SESSION_COOKIE]);
    this.clearSessionCookies(reply);
    return { ok: true };
  }

  @Post('refresh')
  @AllowUnverifiedAccount()
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ refreshed: true }> {
    const observe = (
      reason: 'seat_active' | 'refresh_required' | 'stale' | 'invalid' | 'reused' | 'rotated',
    ) => {
      try {
        process.stdout.write(
          `${JSON.stringify({
            time: new Date().toISOString(),
            kind: 'auth_session_recovery',
            subsystem: 'access',
            module: 'auth',
            level: reason === 'rotated' || reason === 'seat_active' ? 'info' : 'warn',
            requestId: request.id,
            actorKind:
              reason === 'seat_active' ? 'student' : reason === 'rotated' ? 'account' : 'unknown',
            sessionKind: reason === 'seat_active' ? 'student' : 'account_refresh',
            outcome:
              reason === 'rotated' ? 'succeeded' : reason === 'seat_active' ? 'skipped' : 'failed',
            reason,
          })}\n`,
        );
      } catch {
        /* Diagnostics cannot change authentication outcomes. */
      }
    };
    // Resolve the same Account-first priority as product endpoints. A stale
    // Account refresh cookie cannot replace a currently authenticated Seat.
    if (
      request.cookies[STUDENT_SESSION_COOKIE] &&
      !(await this.activeContext.resolve(request.cookies[SESSION_COOKIE])) &&
      (await this.seats.resolve(request.cookies[STUDENT_SESSION_COOKIE]))
    ) {
      observe('seat_active');
      throw new HttpException(error('refresh_not_applicable', 'student session is active'), 409);
    }
    const refreshToken = request.cookies[REFRESH_COOKIE];
    if (!refreshToken) {
      observe('refresh_required');
      throw new HttpException(error('refresh_required', 'no refresh session'), 401);
    }
    const result = await this.refreshSessions.rotate(refreshToken);
    observe(result.status);
    if (result.status === 'stale') {
      throw new HttpException(error('refresh_stale', 'session was refreshed in another tab'), 409);
    }
    if (result.status !== 'rotated') {
      // A failed refresh is not logout. In particular a delayed response must
      // never delete cookies established by a newer login in another tab.
      throw new HttpException(
        error(
          result.status === 'reused' ? 'refresh_reused' : 'refresh_invalid',
          'refresh session is no longer active',
        ),
        401,
      );
    }
    this.setSessionCookie(reply, result.accessToken);
    this.setRefreshCookie(reply, result.refreshToken);
    return { refreshed: true };
  }

  @Get('me')
  @AllowUnverifiedAccount()
  async me(@Req() request: FastifyRequest): Promise<SessionPayload | { authenticated: false }> {
    if (request.cookies[SESSION_COOKIE] === undefined) {
      return { authenticated: false };
    }
    const context = await this.requireContext(request);
    const connection = clientConnection(request);
    this.analytics.enqueueEvent({
      receivedAt: requestReceivedAt(request),
      actor: { kind: 'account', context },
      eventType: 'session.observed',
      outcome: 'succeeded',
      address: connection.address,
      networkKind: connection.networkKind,
      userAgent: request.headers['user-agent'],
    });
    return this.payload(context);
  }
}
