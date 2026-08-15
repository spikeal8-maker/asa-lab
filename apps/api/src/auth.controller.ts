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
  constructor(
    @Inject(TOKENS.loginUseCase) private readonly legacyLoginUseCase: LoginUseCase,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.registerAccountUseCase) private readonly registerUseCase: RegisterAccountUseCase,
    @Inject(TOKENS.accountLoginUseCase) private readonly accountLoginUseCase: AccountLoginUseCase,
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

  private async payload(context: ActiveContext): Promise<SessionPayload> {
    const [capabilities, workspaces] = await Promise.all([
      this.accounts.capabilities(context.accountId),
      this.accounts.workspaces(context.accountId),
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
    };
  }

  private async requireContext(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return context;
  }

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionPayload> {
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
    const shape = checkBodyShape(rawBody, ['workspace', 'identifier', 'email', 'password']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
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
