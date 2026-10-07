import { Body, Controller, Get, HttpException, Inject, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase, PresentationPreferencesUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
@Controller('api/account/presentation')
export class PresentationPreferencesController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly context: ActiveContextUseCase,
    @Inject(TOKENS.presentationPreferences)
    private readonly preferences: PresentationPreferencesUseCase,
  ) {}
  private async account(request: FastifyRequest): Promise<string> {
    const context = await this.context.resolve(request.cookies[SESSION_COOKIE]);
    if (!context)
      throw new HttpException(
        { error: { code: 'unauthorized', message: 'no active Account session' } },
        401,
      );
    // A precondition for the mounted presentation, never an authorization source.
    const expected = request.headers['x-asa-presentation-account'];
    if (
      typeof expected !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected)
    )
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: 'presentation Account precondition required',
          },
        },
        400,
      );
    if (expected !== context.accountId)
      throw new HttpException(
        { error: { code: 'actor_changed', message: 'Account changed; reload the page' } },
        409,
      );
    return context.accountId;
  }
  @Get() async read(@Req() request: FastifyRequest) {
    const id = await this.account(request);
    const value = await this.preferences.read(id);
    if (!value)
      throw new HttpException(
        { error: { code: 'not_found', message: 'account was not found' } },
        404,
      );
    return value;
  }
  @Put() async write(@Req() request: FastifyRequest, @Body() body: unknown) {
    const id = await this.account(request);
    const result = await this.preferences.write(id, body);
    if (result.code === 'ok') return result.snapshot;
    throw new HttpException(
      {
        error: {
          code: result.code,
          message: result.code === 'conflict' ? 'Presentation was changed elsewhere' : result.code,
        },
      },
      result.code === 'validation_error' ? 400 : result.code === 'not_found' ? 404 : 409,
    );
  }
}
