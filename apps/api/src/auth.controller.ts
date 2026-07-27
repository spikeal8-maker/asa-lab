import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AccountDirectoryPort,
  AccountLoginUseCase,
  LoginUseCase,
  RegisterAccountUseCase,
  SessionUseCase,
} from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

interface PublicUser {
  id: string;
  role: 'teacher';
  displayName: string;
  email: string;
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

  /** Adult self-registration: one account, one Personal Workspace, signed in. */
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ account: { id: string; email: string } }> {
    const shape = checkBodyShape(rawBody, [
      'email',
      'password',
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
      displayName: shape.body['displayName'],
      birthDate: shape.body['birthDate'],
      country: shape.body['country'],
    });
    if (!result.ok) {
      const status =
        result.code === 'email_taken' ? 409 : result.code === 'age_restricted' ? 422 : 400;
      throw new HttpException(error(result.code, result.message), status);
    }
    // Registration signs the account in immediately; the pilot policy allows
    // work before email verification, and the state stays explicit.
    const login = await this.accountLoginUseCase.execute({
      email: result.email,
      password: shape.body['password'],
    });
    if (login.ok) {
      this.setSessionCookie(reply, login.token);
    }
    return { account: { id: result.account.accountId, email: result.email } };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: PublicUser }> {
    const shape = checkBodyShape(rawBody, ['workspace', 'email', 'password']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    // No organization code: sign in against the global account identity.
    if (shape.body['workspace'] === undefined) {
      const account = await this.accountLoginUseCase.execute({
        email: shape.body['email'],
        password: shape.body['password'],
      });
      if (!account.ok) {
        if (account.code === 'validation_error') {
          throw new HttpException(
            error('validation_error', 'email and password are required'),
            400,
          );
        }
        throw new HttpException(error('invalid_credentials', 'invalid email or password'), 401);
      }
      this.setSessionCookie(reply, account.token);
      const profile = await this.accounts.profile(account.accountId);
      return {
        user: {
          id: account.accountId,
          role: 'teacher',
          displayName: profile?.displayName ?? (shape.body['email'] as string),
          email: profile?.email ?? (shape.body['email'] as string),
        },
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
    return {
      user: {
        id: context.userId,
        role: 'teacher',
        displayName: context.displayName,
        email: context.email,
      },
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
  async me(@Req() request: FastifyRequest): Promise<{ user: PublicUser }> {
    const context = await this.sessionUseCase.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return {
      user: {
        id: context.userId,
        role: 'teacher',
        displayName: context.displayName,
        email: context.email,
      },
    };
  }
}
