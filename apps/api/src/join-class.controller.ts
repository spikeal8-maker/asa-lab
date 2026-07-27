import { Body, Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ResolveJoinCodeUseCase } from '@asa-lab/classroom';
import { TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/**
 * Public class-code entry.
 *
 * Resolving a code answers "which class is this" and nothing else: no session,
 * no membership, no roster. The student still chooses on the next screen
 * whether they sign in with an account or with the login name their teacher
 * gave them.
 */
@Controller('api/join-class')
export class JoinClassController {
  /**
   * Attempts per client address, refilled every window. Codes are short, so an
   * unlimited endpoint would let a caller sweep the code space; the limit is
   * deliberately generous for a classroom where everyone types at once.
   */
  private static readonly WINDOW_MS = 60_000;
  private static readonly MAX_ATTEMPTS = 30;
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @Inject(TOKENS.resolveJoinCodeUseCase)
    private readonly resolveUseCase: ResolveJoinCodeUseCase,
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

  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ classroom: { id: string; title: string; educatorDisplayName: string } }> {
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
      // A malformed code and an unknown code get the same answer: the endpoint
      // must not tell a caller which codes exist.
      throw new HttpException(
        error('class_not_found', 'класс с таким кодом не найден — проверьте код у педагога'),
        404,
      );
    }
    return {
      classroom: {
        id: result.preview.classroomId,
        title: result.preview.title,
        educatorDisplayName: result.preview.educatorDisplayName,
      },
    };
  }
}
