import { Body, Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { DescribeJoinIntentUseCase, ResolveJoinCodeUseCase } from '@asa-lab/classroom';
import { TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/**
 * Public class-code entry.
 *
 * Resolving a code answers "which class is this" and nothing else: no session,
 * no membership, no roster, and no classroom identifier. What the browser gets
 * back is a signed, short-lived join-intent token that only the server can
 * read, so a page cannot claim a class it was never given.
 */
@Controller('api/join-class')
export class JoinClassController {
  /**
   * Attempts per client address, refilled every window. Codes are short, so an
   * unlimited endpoint would let a caller sweep the code space; the limit is
   * deliberately generous for a classroom where everyone types at once.
   *
   * TEMPORARY — local and pilot safeguard only. The counter lives in this
   * process, so it does not survive a restart and does not add up across
   * instances, and `request.ip` is only trustworthy while the API is reached
   * directly. A public deployment needs a shared limiter (Redis or the edge)
   * and an explicit trusted-proxy configuration before this endpoint is
   * exposed; see the C1.1 PR notes.
   */
  private static readonly WINDOW_MS = 60_000;
  private static readonly MAX_ATTEMPTS = 30;
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @Inject(TOKENS.resolveJoinCodeUseCase)
    private readonly resolveUseCase: ResolveJoinCodeUseCase,
    @Inject(TOKENS.describeJoinIntentUseCase)
    private readonly describeUseCase: DescribeJoinIntentUseCase,
  ) {}

  private rateLimited(request: FastifyRequest): boolean {
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + JoinClassController.WINDOW_MS });
      return false;
    }
    entry.count += 1;
    return entry.count > JoinClassController.MAX_ATTEMPTS;
  }

  private unavailable(): never {
    throw new HttpException(
      error('join_codes_unavailable', 'вход по коду класса временно недоступен на этом сервере'),
      503,
    );
  }

  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{
    classroom: { title: string; educatorDisplayName: string; joinIntentToken: string };
  }> {
    const shape = checkBodyShape(rawBody, ['code']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    if (this.rateLimited(request)) {
      throw new HttpException(
        error('rate_limited', 'слишком много попыток — подождите минуту'),
        429,
      );
    }
    const result = await this.resolveUseCase.execute(shape.body['code']);
    if (!result.ok) {
      if (result.code === 'unavailable') this.unavailable();
      // A malformed code and an unknown code get the same answer: the endpoint
      // must not tell a caller which codes exist.
      throw new HttpException(
        error('class_not_found', 'класс с таким кодом не найден — проверьте код у педагога'),
        404,
      );
    }
    return {
      classroom: {
        title: result.resolved.title,
        educatorDisplayName: result.resolved.educatorDisplayName,
        joinIntentToken: result.resolved.joinIntentToken,
      },
    };
  }

  /**
   * Describes the class behind a join-intent token.
   *
   * The server re-checks the signature, the lifetime and whether the class code
   * it came from is still active, so a stored token cannot outlive a rotation
   * and cannot be edited into another class. Describing is not joining:
   * nothing is created here either.
   */
  @Post('intent')
  @HttpCode(200)
  async intent(
    @Body() rawBody: unknown,
  ): Promise<{ classroom: { title: string; educatorDisplayName: string } }> {
    const shape = checkBodyShape(rawBody, ['joinIntentToken']);
    if (!shape.ok) {
      throw new HttpException(error('validation_error', shape.message), 400);
    }
    const result = await this.describeUseCase.execute(shape.body['joinIntentToken']);
    if (!result.ok) {
      if (result.code === 'unavailable') this.unavailable();
      throw new HttpException(
        error(
          'join_intent_invalid',
          'ссылка на класс больше не действует — введите код класса заново',
        ),
        410,
      );
    }
    return {
      classroom: { title: result.title, educatorDisplayName: result.educatorDisplayName },
    };
  }
}
