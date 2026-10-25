import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import { AllowUnverifiedAccount } from './account-verification.guard.js';
import { requireAiSameOrigin } from './ai-access.service.js';
import { EmailService, mailFailure } from './email.service.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function mailId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) mailFailure('mail_invalid');
  return value;
}
export function mailBody(raw: unknown, keys: string[]): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !keys.includes(k))
  )
    mailFailure('mail_invalid');
  return raw as Record<string, unknown>;
}
@Controller('api')
export class EmailController {
  private readonly proofLimit = new FixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
  private readonly testLimit = new FixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.emailService) private readonly mail: EmailService,
  ) {}
  private async actor(request: FastifyRequest) {
    const actor = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) mailFailure('mail_denied', 401);
    return actor;
  }
  private origin(request: FastifyRequest) {
    try {
      requireAiSameOrigin(request);
    } catch {
      mailFailure('mail_denied', 403);
    }
  }
  @AllowUnverifiedAccount()
  @Get('admin/v1/auth/email')
  async config(@Req() req: FastifyRequest) {
    return this.mail.adminConfig((await this.actor(req)).principalId);
  }
  @AllowUnverifiedAccount()
  @Put('admin/v1/auth/email')
  async save(@Req() req: FastifyRequest, @Body() body: unknown) {
    this.origin(req);
    return this.mail.save((await this.actor(req)).principalId, body, req.id);
  }
  @AllowUnverifiedAccount()
  @HttpCode(200)
  @Post('admin/v1/auth/email/test')
  async test(@Req() req: FastifyRequest, @Body() raw: unknown) {
    this.origin(req);
    const actor = await this.actor(req),
      body = mailBody(raw, ['version', 'to']);
    if (
      !Number.isSafeInteger(body['version']) ||
      Number(body['version']) < 1 ||
      (body['to'] !== null && typeof body['to'] !== 'string')
    )
      mailFailure('mail_invalid');
    if (!this.testLimit.consume(actor.principalId).allowed) mailFailure('mail_cooldown', 429);
    return this.mail.test(
      actor.principalId,
      Number(body['version']),
      body['to'] as string | null,
      req.id,
    );
  }
  @Get('crm/v1/users/account/:target/email')
  async status(@Req() req: FastifyRequest, @Param('target') target: string) {
    return this.mail.status((await this.actor(req)).principalId, mailId(target), true);
  }
  @HttpCode(200)
  @Post('crm/v1/users/account/:target/email')
  async change(@Req() req: FastifyRequest, @Param('target') target: string, @Body() raw: unknown) {
    this.origin(req);
    const actor = await this.actor(req),
      body = mailBody(raw, ['email', 'version', 'reason', 'requestId']);
    if (
      typeof body['email'] !== 'string' ||
      typeof body['version'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body['version']) ||
      typeof body['reason'] !== 'string' ||
      body['reason'].trim().length < 3 ||
      body['reason'].length > 500
    )
      mailFailure('mail_invalid');
    return this.mail.request(
      actor.principalId,
      mailId(target),
      true,
      body['email'],
      body['version'],
      body['reason'],
      mailId(body['requestId']),
    );
  }
  @HttpCode(200)
  @Post('crm/v1/users/account/:target/email/cancel')
  async cancel(@Req() req: FastifyRequest, @Param('target') target: string, @Body() raw: unknown) {
    this.origin(req);
    const body = mailBody(raw, ['intentId']);
    return this.mail.cancel(
      (await this.actor(req)).principalId,
      mailId(target),
      true,
      mailId(body['intentId']),
      req.id,
    );
  }
  @AllowUnverifiedAccount()
  @Get('auth/email')
  async ownStatus(@Req() req: FastifyRequest) {
    const actor = await this.actor(req);
    return this.mail.status(actor.principalId, actor.accountId, false);
  }
  @AllowUnverifiedAccount()
  @HttpCode(200)
  @Post('auth/email/request')
  async verify(@Req() req: FastifyRequest, @Body() raw: unknown) {
    this.origin(req);
    const actor = await this.actor(req),
      body = mailBody(raw, ['requestId', 'accountId']);
    if (mailId(body['accountId']) !== actor.accountId) mailFailure('mail_conflict', 409);
    const status = (await this.mail.status(actor.principalId, actor.accountId, false)) as {
      email: string;
    };
    return this.mail.request(
      actor.principalId,
      actor.accountId,
      false,
      status.email,
      null,
      'Подтверждение собственной почты',
      mailId(body['requestId']),
    );
  }
  @AllowUnverifiedAccount()
  @HttpCode(200)
  @Post('auth/email/cancel')
  async ownCancel(@Req() req: FastifyRequest, @Body() raw: unknown) {
    this.origin(req);
    const actor = await this.actor(req),
      body = mailBody(raw, ['intentId']);
    return this.mail.cancel(
      actor.principalId,
      actor.accountId,
      false,
      mailId(body['intentId']),
      req.id,
    );
  }
  @AllowUnverifiedAccount()
  @HttpCode(200)
  @Post('auth/email/confirm')
  async consume(@Req() req: FastifyRequest, @Body() raw: unknown) {
    this.origin(req);
    if (!this.proofLimit.consume(req.ip).allowed) mailFailure('mail_cooldown', 429);
    const body = mailBody(raw, ['token']);
    return this.mail.consume(body['token']);
  }
}
