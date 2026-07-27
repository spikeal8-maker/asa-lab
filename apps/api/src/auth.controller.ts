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
  SessionContext,
  AccountLoginUseCase,
  LoginUseCase,
  RegisterAccountUseCase,
  SessionUseCase,
} from '@asa-lab/identity';
import { isEligibleAdult, parseBirthDate, routeForMinor } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import { isPublicRegistrationEnabled } from './feature-flags.js';

interface PublicUser {
  id: string;
  displayName: string;
  email: string;
}

interface SessionPayload {
  user: PublicUser;
  /** Capabilities the server granted; the client never states a role. */
  capabilities: { capability: string; state: string }[];
  workspaces: { workspaceId: string; kind: string; title: string; role: string }[];
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(TOKENS.loginUseCase) private readonly loginUseCase: LoginUseCase,
    @Inject(TOKENS.sessionUseCase) private readonly sessionUseCase: SessionUseCase,
    @Inject(TOKENS.registerAccountUseCase)
    private readonly registerUseCase: RegisterAccountUseCase,
    @Inject(TOKENS.accountLoginUseCase)
    private readonly accountLoginUseCase: AccountLoginUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
  ) {}

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env['NODE_ENV'] === 'production',
      maxAge: 12 * 60 * 60,
    });
  }

  /**
   * Adult self-registration into a Personal Workspace.
   *
   * Disabled by default: the mutation waits for principal-aware sessions.
   * The endpoint still answers honestly so the interface can explain the
   * state instead of failing silently.
   */
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ account: { id: string; email: string } }> {
    const shape = checkBodyShape(rawBody, [
      'email',
      'password',
      'username',
      'displayName',
      'birthDate',
      'country',
    ]);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    // Age routing answers before the flag: a minor must always be told where
    // to go, whether or not adult registration happens to be open.
    const birthDate = parseBirthDate(shape.body['birthDate']);
    if (birthDate !== null && !isEligibleAdult(birthDate)) {
      throw new HttpException(
        {
          error: {
            code: 'age_routed',
            message: 'личный аккаунт доступен с 18 лет — ученики заходят по коду класса',
            routes: routeForMinor(),
          },
        },
        422,
      );
    }
    if (!isPublicRegistrationEnabled()) {
      throw new HttpException(
        error(
          'registration_disabled',
          'публичная регистрация откроется на следующем этапе; сейчас доступен вход по коду класса или через организацию',
        ),
        503,
      );
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
        // Not a dead end: the answer names where this person should go.
        throw new HttpException(
          { error: { code: result.code, message: result.message, routes: result.routes } },
          422,
        );
      }
      const status = result.code === 'email_taken' || result.code === 'username_taken' ? 409 : 400;
      throw new HttpException(error(result.code, result.message), status);
    }
    const login = await this.accountLoginUseCase.execute({
      identifier: result.email,
      password: shape.body['password'],
    });
    if (login.ok) {
      this.setSessionCookie(reply, login.token);
    }
    return { account: { id: result.account.accountId, email: result.email } };
  }

  /** Is this pseudonym free? Usernames are never derived from the email. */
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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
    const shape = checkBodyShape(rawBody, ['workspace', 'identifier', 'email', 'password']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    // No organization code: sign in against the global account identity. The
    // identifier is an email address or a username; `email` stays accepted so
    // the legacy organization form keeps its own field name.
    if (shape.body['workspace'] === undefined) {
      const account = await this.accountLoginUseCase.execute({
        identifier: shape.body['identifier'] ?? shape.body['email'],
        password: shape.body['password'],
      });
      if (!account.ok) {
        if (account.code === 'context_unavailable') {
          throw new HttpException(
            error(
              'context_unavailable',
              'для этого аккаунта ещё нет рабочего контекста; вход откроется вместе со следующим этапом',
            ),
            503,
          );
        }
        if (account.code === 'validation_error') {
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
      this.setSessionCookie(reply, account.token);
      const profile = await this.accounts.profile(account.accountId);
      const identifier = (shape.body['identifier'] ?? shape.body['email']) as string;
      return {
        user: {
          id: account.accountId,
          displayName: profile?.displayName ?? identifier,
          email: profile?.email ?? identifier,
        },
        capabilities: account.capabilities.map((entry) => ({
          capability: entry.capability,
          state: entry.state,
        })),
        workspaces: account.workspaces.map((entry) => ({
          workspaceId: entry.workspaceId,
          kind: entry.kind,
          title: entry.title,
          role: entry.role,
        })),
      };
    }
    const result = await this.loginUseCase.execute({
      workspace: shape.body['workspace'],
      email: shape.body['email'],
      password: shape.body['password'],
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
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env['NODE_ENV'] === 'production',
      maxAge: 12 * 60 * 60,
    });
    const { context } = result;
    return this.sessionPayload(context);
  }

  /**
   * Session answer: identity plus server-granted capabilities and workspaces.
   *
   * A session that maps to no account comes from the tenant-scoped `users`
   * table, whose CHECK constraint admits `role = 'teacher'` only. The educator
   * capability reported for it is therefore read from the database schema, not
   * assumed by the client and not written into the answer by the browser.
   */
  private async sessionPayload(context: SessionContext): Promise<SessionPayload> {
    const accountId = await this.accounts.accountForUser(context.tenantId, context.userId);
    const capabilities = accountId
      ? await this.accounts.capabilities(accountId)
      : [{ capability: 'educator', state: 'verified' }];
    const workspaces = accountId ? await this.accounts.workspaces(accountId) : [];
    return {
      user: {
        id: context.userId,
        displayName: context.displayName,
        email: context.email,
      },
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
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.sessionUseCase.logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() request: FastifyRequest): Promise<SessionPayload> {
    const context = await this.sessionUseCase.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return this.sessionPayload(context);
  }
}
