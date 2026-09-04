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
import { randomUUID } from 'node:crypto';
import type {
  AccountDirectoryPort,
  AccountLoginUseCase,
  ActiveContext,
  ActiveContextUseCase,
  LoginUseCase,
  RegisterAccountUseCase,
} from '@asa-lab/identity';
import { REFRESH_COOKIE, SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { clientAddress, clientConnection, type ClientNetworkKind } from './client-address.js';
import { BotChallengeService, type BotAction } from './bot-challenge.js';
import { MaxAuthService, MaxInitDataError } from './max-auth.service.js';
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
const AUTH_FLOW_COOKIE = 'asa_auth_flow';
const AUTH_FLOW_MAX_AGE_SECONDS = 20 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PublicUser {
  id: string;
  displayName: string;
  email: string;
}

interface SessionPayload {
  authenticated: true;
  user: PublicUser;
  account: PublicUser;
  capabilities: { capability: string; state: string }[];
  workspaces: { workspaceId: string; kind: string; title: string; role: string }[];
  activeWorkspace: { workspaceId: string; kind: string };
  navigation: { classes: boolean; classroomManagement: boolean };
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

  constructor(
    @Inject(TOKENS.loginUseCase) private readonly legacyLoginUseCase: LoginUseCase,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.registerAccountUseCase) private readonly registerUseCase: RegisterAccountUseCase,
    @Inject(TOKENS.accountLoginUseCase) private readonly accountLoginUseCase: AccountLoginUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.botChallengeService) private readonly botChallenges: BotChallengeService,
    @Inject(TOKENS.maxAuthService) private readonly maxAuth: MaxAuthService,
    @Inject(TOKENS.refreshSessionService)
    private readonly refreshSessions: RefreshSessionService,
    @Inject(TOKENS.productAnalytics)
    private readonly analytics: ProductAnalyticsService,
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

  private async recordAuth(input: {
    readonly eventType: AnalyticsEventType;
    readonly method: AnalyticsAuthMethod;
    readonly outcome: AnalyticsOutcome;
    readonly flowId: string;
    readonly address: string;
    readonly networkKind: ClientNetworkKind;
    readonly userAgent: string | undefined;
    readonly context?: ActiveContext;
  }): Promise<void> {
    await this.analytics.record({
      actor: input.context ? { kind: 'account', context: input.context } : { kind: 'anonymous' },
      eventType: input.eventType,
      outcome: input.outcome,
      authMethod: input.method,
      flowId: input.flowId,
      address: input.address,
      networkKind: input.networkKind,
      userAgentSummary: summarizeUserAgent(input.userAgent) ?? null,
    });
  }

  private async establishSession(
    reply: FastifyReply,
    accessToken: string,
    source: SessionSource,
  ): Promise<void> {
    const refreshToken = await this.refreshSessions.attach(accessToken, source);
    this.setSessionCookie(reply, accessToken);
    if (refreshToken) this.setRefreshCookie(reply, refreshToken);
  }

  private async payload(context: ActiveContext): Promise<SessionPayload> {
    const [capabilities, workspaces, timeZone] = await Promise.all([
      this.accounts.capabilities(context.accountId),
      this.accounts.workspaces(context.accountId),
      this.accounts.timeZone(context.accountId),
    ]);
    const educator = capabilities.some(
      (entry) =>
        entry.capability === 'educator' &&
        (entry.state === 'verified' || entry.state === 'provisional'),
    );
    const account = {
      id: context.accountId,
      displayName: context.displayName,
      email: context.email,
    };
    return {
      authenticated: true,
      user: account,
      account,
      capabilities: capabilities.map((entry) => ({
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
      navigation: {
        classes: educator,
        classroomManagement: educator,
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
    if (problem instanceof MaxInitDataError) {
      if (problem.code === 'max_auth_disabled') {
        throw new HttpException(
          error('max_auth_disabled', 'Вход через MAX пока не подключён.'),
          503,
        );
      }
      if (problem.code === 'max_init_data_expired') {
        throw new HttpException(
          error('max_init_data_expired', 'Ссылка MAX устарела. Откройте бота заново.'),
          401,
        );
      }
      throw new HttpException(
        error('max_init_data_invalid', 'MAX не подтвердил данные входа.'),
        401,
      );
    }
    throw problem;
  }

  @Get('max/config')
  async maxConfig(): Promise<{ enabled: boolean; launchUrl: string | null }> {
    return this.maxAuth.config();
  }

  @Post('max/pairing/start')
  @HttpCode(200)
  async startMaxPairing(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ pairingToken: string; launchUrl: string }> {
    this.enforce(this.maxAuthByAddress, clientAddress(request));
    this.authFlow(request, reply);
    const purpose =
      rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)['purpose']
        : undefined;
    if (purpose !== undefined && purpose !== 'login' && purpose !== 'link') {
      throw new HttpException(error('validation_error', 'unknown MAX pairing purpose'), 400);
    }
    const requestedAccountId =
      purpose === 'link' ? (await this.requireContext(request)).accountId : undefined;
    try {
      return await this.maxAuth.startPairing(requestedAccountId);
    } catch (problem) {
      this.throwMaxValidation(problem);
    }
  }

  @Post('max/pairing/complete')
  @HttpCode(200)
  async completeMaxPairing(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ status: 'pending' } | { status: 'authenticated'; session: SessionPayload }> {
    const connection = clientConnection(request);
    this.enforce(this.maxAuthByAddress, connection.address);
    const shape = checkBodyShape(rawBody, ['pairingToken']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.maxAuth.consumePairing(
      shape.body['pairingToken'],
      summarizeUserAgent(request.headers['user-agent']),
    );
    if (result.status === 'pending') return { status: 'pending' };
    if (result.status === 'expired' || result.status === 'consumed') {
      throw new HttpException(
        error('max_pairing_expired', 'Запрос входа истёк. Откройте MAX заново.'),
        410,
      );
    }
    if (result.status !== 'authenticated') {
      throw new HttpException(error('max_pairing_invalid', 'Запрос входа недействителен.'), 400);
    }
    await this.establishSession(reply, result.token, 'max');
    const context = await this.activeContext.resolve(result.token);
    if (!context) throw new HttpException(error('server_error', 'session was not created'), 500);
    await this.recordAuth({
      eventType: 'auth.max',
      method: 'max',
      outcome: 'succeeded',
      flowId: this.authFlow(request, reply),
      address: connection.address,
      networkKind: connection.networkKind,
      userAgent: request.headers['user-agent'],
      context,
    });
    this.closeAuthFlow(reply);
    return { status: 'authenticated', session: await this.payload(context) };
  }

  @Get('max/status')
  async maxStatus(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    const status = await this.maxAuth.status(context.accountId);
    if (!status) throw new HttpException(error('unauthorized', 'account is not active'), 401);
    return { ...status, available: (await this.maxAuth.config()).enabled };
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
    return {
      unlinked: await this.maxAuth.unlink(context.accountId, context.principalId),
    };
  }

  @Post('max/session')
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
      await this.recordAuth({
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
      await this.recordAuth({
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
      await this.recordAuth({
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
      await this.recordAuth({
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
  @HttpCode(200)
  async maxWebhook(@Body() body: unknown, @Req() request: FastifyRequest): Promise<{ ok: true }> {
    const result = await this.maxAuth.handleWebhook(request.headers['x-max-bot-api-secret'], body);
    if (result === 'unauthorized') {
      throw new HttpException(error('unauthorized', 'invalid MAX webhook secret'), 401);
    }
    return { ok: true };
  }

  @Post('max/link')
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
    throw new HttpException(
      error('max_auth_unavailable', 'Привязка MAX временно недоступна.'),
      503,
    );
  }

  @Get('bot-challenge')
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
  localPreviewConfig(@Req() request: FastifyRequest): { enabled: boolean } {
    return { enabled: localPreviewCredentials(request) !== null };
  }

  @Post('local-preview/session')
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
      await this.recordAuth({
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
      await this.recordAuth({
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
  async usernameAvailable(
    @Query('username') username: string | undefined,
  ): Promise<{ available: boolean }> {
    if (typeof username !== 'string' || username.trim().length < 3) {
      return { available: false };
    }
    return { available: await this.accounts.isUsernameAvailable(username.trim().toLowerCase()) };
  }

  @Post('login')
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
      await this.recordAuth({
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
      await this.recordAuth({
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
  @HttpCode(200)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.refreshSessions.revoke(
      request.cookies[REFRESH_COOKIE],
      request.cookies[SESSION_COOKIE],
    );
    await this.activeContext.logout(request.cookies[SESSION_COOKIE]);
    this.clearSessionCookies(reply);
    return { ok: true };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ refreshed: true }> {
    const refreshToken = request.cookies[REFRESH_COOKIE];
    if (!refreshToken) {
      this.clearSessionCookies(reply);
      throw new HttpException(error('refresh_required', 'no refresh session'), 401);
    }
    const result = await this.refreshSessions.rotate(refreshToken);
    if (result.status === 'stale') {
      throw new HttpException(error('refresh_stale', 'session was refreshed in another tab'), 409);
    }
    if (result.status !== 'rotated') {
      this.clearSessionCookies(reply);
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
  async me(@Req() request: FastifyRequest): Promise<SessionPayload | { authenticated: false }> {
    if (request.cookies[SESSION_COOKIE] === undefined) {
      return { authenticated: false };
    }
    const context = await this.requireContext(request);
    const connection = clientConnection(request);
    await this.analytics.record({
      actor: { kind: 'account', context },
      eventType: 'session.observed',
      outcome: 'succeeded',
      address: connection.address,
      networkKind: connection.networkKind,
      userAgentSummary: summarizeUserAgent(request.headers['user-agent']) ?? null,
    });
    return this.payload(context);
  }
}
