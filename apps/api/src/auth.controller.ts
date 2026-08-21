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
import type {
  AccountDirectoryPort,
  AccountLoginUseCase,
  ActiveContext,
  ActiveContextUseCase,
  LoginUseCase,
  RegisterAccountUseCase,
} from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { clientAddress } from './client-address.js';
import { BotChallengeService, type BotAction } from './bot-challenge.js';

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

  constructor(
    @Inject(TOKENS.loginUseCase) private readonly legacyLoginUseCase: LoginUseCase,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.registerAccountUseCase) private readonly registerUseCase: RegisterAccountUseCase,
    @Inject(TOKENS.accountLoginUseCase) private readonly accountLoginUseCase: AccountLoginUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.botChallengeService) private readonly botChallenges: BotChallengeService,
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

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    const address = clientAddress(request);
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
      !this.botChallenges.verify('register', shape.body['botProof'], request.headers['user-agent'])
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
      const status = result.code === 'email_taken' || result.code === 'username_taken' ? 409 : 400;
      throw new HttpException(error(result.code, result.message), status);
    }
    this.setSessionCookie(reply, result.token);
    const context = await this.activeContext.resolve(result.token);
    if (!context) {
      throw new HttpException(error('server_error', 'session was not created'), 500);
    }
    return this.payload(context);
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
    const address = clientAddress(request);
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
    const token =
      shape.body['workspace'] === undefined
        ? await this.accountSignIn(shape.body, summarizeUserAgent(request.headers['user-agent']))
        : await this.legacySignIn(shape.body);
    this.setSessionCookie(reply, token);
    const context = await this.activeContext.resolve(token);
    if (!context) {
      throw new HttpException(error('server_error', 'session was not created'), 500);
    }
    return this.payload(context);
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
    await this.activeContext.logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() request: FastifyRequest): Promise<SessionPayload | { authenticated: false }> {
    if (request.cookies[SESSION_COOKIE] === undefined) {
      return { authenticated: false };
    }
    return this.payload(await this.requireContext(request));
  }
}
