import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type {
  AccountManagementUseCase,
  ActiveContext,
  ActiveContextUseCase,
} from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

@Controller('api')
export class AccountC1Controller {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountManagementUseCase)
    private readonly account: AccountManagementUseCase,
  ) {}

  private token(request: FastifyRequest): string | undefined {
    return request.cookies[SESSION_COOKIE];
  }

  private async requireContext(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(this.token(request));
    if (!context) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return context;
  }

  @Get('workspaces')
  async workspaces(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    const profile = await this.account.profile(context.accountId);
    if (!profile) throw new HttpException(error('not_found', 'account was not found'), 404);
    return {
      items: profile.workspaces,
      activeWorkspaceId: context.workspaceId,
    };
  }

  @Post('session/context')
  async switchContext(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['workspaceId']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const result = await this.account.switchContext(this.token(request), shape.body['workspaceId']);
    if (result === 'validation_error') {
      throw new HttpException(error('validation_error', 'workspaceId must be a UUID'), 400);
    }
    if (result === 'unauthorized') {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    if (result === 'forbidden') {
      throw new HttpException(
        error('workspace_forbidden', 'workspace is unavailable for this account'),
        403,
      );
    }
    const context = await this.requireContext(request);
    return {
      activeWorkspace: { workspaceId: context.workspaceId, kind: context.workspaceKind },
    };
  }

  @Post('capabilities/educator/self-attest')
  async selfAttestEducator(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody ?? {}, []);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const result = await this.account.selfAttestEducator(context.accountId);
    if (!result.ok) {
      const status = result.code === 'underage' ? 403 : 409;
      const message =
        result.code === 'underage'
          ? 'подтверждение педагога доступно только совершеннолетним'
          : 'educator capability is suspended or revoked';
      throw new HttpException(error(result.code, message), status);
    }
    return {
      capability: 'educator',
      state: result.state,
      created: result.created,
    };
  }

  @Put('account/role')
  async setAccountRole(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['role']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const result = await this.account.setAccountRole(context.accountId, shape.body['role']);
    if (!result.ok) {
      const status =
        result.code === 'validation_error' ? 400 : result.code === 'underage' ? 403 : 409;
      const message =
        result.code === 'underage'
          ? 'режим педагога доступен только совершеннолетнему пользователю'
          : result.code === 'validation_error'
            ? 'выберите роль creator или educator'
            : 'режим педагога временно недоступен для этого аккаунта';
      throw new HttpException(error(result.code, message), status);
    }
    return result;
  }

  @Post('schools')
  async createSchool(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['title']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const result = await this.account.createSchoolWorkspace(context.accountId, shape.body['title']);
    if (!result.ok) {
      const message =
        result.code === 'educator_required'
          ? 'сначала выберите роль педагога'
          : 'название школы должно содержать от 2 до 120 символов';
      throw new HttpException(
        error(result.code, message),
        result.code === 'educator_required' ? 403 : 400,
      );
    }
    return result;
  }

  @Get('account/profile')
  async profile(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    const profile = await this.account.profile(context.accountId);
    if (!profile) throw new HttpException(error('not_found', 'account was not found'), 404);
    return profile;
  }

  /**
   * The zone every date about this teacher's classes is read in. The browser
   * posts its own zone with `onlyIfUnset` on the first sign-in; the settings
   * page posts without it, which is the person deciding.
   */
  @Put('account/time-zone')
  async setTimeZone(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['timeZone', 'onlyIfUnset']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.account.setTimeZone(context.accountId, {
      timeZone: shape.body['timeZone'],
      onlyIfUnset: shape.body['onlyIfUnset'],
    });
    if (!result.ok) {
      throw new HttpException(error(result.code, 'Неизвестный часовой пояс.'), 400);
    }
    return { timeZone: result.timeZone };
  }

  @Get('account/avatar')
  async avatar(@Req() request: FastifyRequest) {
    const context = await this.requireContext(request);
    const avatar = await this.account.avatar(context.accountId);
    if (!avatar) throw new HttpException(error('not_found', 'account was not found'), 404);
    return avatar;
  }

  @Patch('account/avatar')
  async updateAvatar(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['avatarDataUrl']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const result = await this.account.updateAvatar(context.accountId, shape.body['avatarDataUrl']);
    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : 400;
      throw new HttpException(
        error(
          result.code,
          result.code === 'validation_error'
            ? 'avatar must be a PNG, JPEG or WebP data URL up to 300 KB'
            : 'account was not found',
        ),
        status,
      );
    }
    return result.avatar;
  }

  @Patch('account/profile')
  async updateProfile(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['username', 'displayName', 'bio']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    let bio = shape.body['bio'];
    if (bio === undefined) {
      const existing = await this.account.profile(context.accountId);
      if (!existing) throw new HttpException(error('not_found', 'account was not found'), 404);
      bio = existing.bio;
    }
    const result = await this.account.updateProfile(context.accountId, {
      username: shape.body['username'],
      displayName: shape.body['displayName'],
      bio,
    });
    if (!result.ok) {
      if (result.code === 'username_taken') {
        throw new HttpException(error(result.code, 'это имя пользователя уже занято'), 409);
      }
      const status = result.code === 'not_found' ? 404 : 400;
      throw new HttpException(
        error(result.code, 'проверьте имя пользователя, отображаемое имя и текст «О себе»'),
        status,
      );
    }
    return result.profile;
  }

  @Get('account/sessions')
  async sessions(@Req() request: FastifyRequest) {
    await this.requireContext(request);
    const items = await this.account.listSessions(this.token(request));
    if (items === null) throw new HttpException(error('unauthorized', 'no active session'), 401);
    return { items };
  }

  @Delete('account/sessions/:id')
  async revokeSession(@Req() request: FastifyRequest, @Param('id') sessionId: string) {
    await this.requireContext(request);
    const result = await this.account.revokeSession(this.token(request), sessionId);
    if (result === 'validation_error') {
      throw new HttpException(error('validation_error', 'session id must be a UUID'), 400);
    }
    if (result === 'unauthorized') {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    if (result === 'current_session') {
      throw new HttpException(
        error('current_session', 'use logout to end the current session'),
        409,
      );
    }
    if (result === 'not_found') {
      throw new HttpException(error('not_found', 'session was not found'), 404);
    }
    return { ok: true };
  }

  @Post('account/sessions/revoke-all')
  async revokeOtherSessions(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    await this.requireContext(request);
    const shape = checkBodyShape(rawBody ?? {}, []);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const revoked = await this.account.revokeOtherSessions(this.token(request));
    if (revoked === null) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return { revoked };
  }
}
