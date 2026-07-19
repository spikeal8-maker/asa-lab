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
import type { LoginUseCase, SessionUseCase } from '@asa-lab/identity';
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
  ) {}

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
