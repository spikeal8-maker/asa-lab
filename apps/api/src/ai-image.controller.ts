import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import {
  AiAccessService,
  aiRequestActor,
  aiSeatSelector,
  requireAiSameOrigin,
} from './ai-access.service.js';
import { AiImageError, AiImageService } from './ai-image.service.js';
import { AiToolPolicyError } from './ai-tool-policy.js';
import { AiServiceError } from './ai-chat.service.js';
import type { SeatContextUseCase } from './seat-context.js';
import { AdminControlPlaneService } from './admin-control-plane.service.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
export const AI_IMAGE_SERVICE = 'AI_IMAGE_SERVICE';
async function safe<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AiImageError || e instanceof AiServiceError || e instanceof AiToolPolicyError)
      throw new HttpException({ error: { code: e.code, message: e.message } }, e.status);
    throw e;
  }
}
@Controller('api/ai')
export class AiImageController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly active: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.aiAccessService) private readonly access: AiAccessService,
    @Inject(AI_IMAGE_SERVICE) private readonly images: AiImageService,
  ) {}
  private owner(request: FastifyRequest) {
    return this.resolveOwner(request);
  }
  private async resolveOwner(request: FastifyRequest) {
    return this.access.owner(
      await aiRequestActor(request, this.active, this.seats),
      aiSeatSelector(request),
    );
  }
  @Get('image-generation/status') status(@Req() request: FastifyRequest) {
    return safe(async () => this.images.status(await this.owner(request)));
  }
  @Post('threads/:threadId/image-generations') create(
    @Req() request: FastifyRequest,
    @Param('threadId') thread: string,
    @Body() body: unknown,
  ) {
    return safe(async () => {
      requireAiSameOrigin(request);
      return this.images.create(await this.owner(request), thread, body);
    });
  }
  @Get('threads/:threadId/tool-image-generations') pendingTools(
    @Req() request: FastifyRequest,
    @Param('threadId') thread: string,
  ) {
    return safe(async () => {
      const owner = await this.owner(request);
      return (await this.images.nativeSchemaReady()) ? this.images.pendingTools(owner, thread) : [];
    });
  }
  @Get('threads/:threadId/requests/:requestId/image-generation') toolReceipt(
    @Req() request: FastifyRequest,
    @Param('threadId') thread: string,
    @Param('requestId') id: string,
  ) {
    return safe(async () => {
      const owner = await this.owner(request);
      return (await this.images.nativeSchemaReady())
        ? this.images.replayTool(owner, thread, id)
        : null;
    });
  }
  @Get('threads/:threadId/image-generations/:requestId') get(
    @Req() request: FastifyRequest,
    @Param('threadId') thread: string,
    @Param('requestId') id: string,
  ) {
    return safe(async () => this.images.get(await this.owner(request), thread, id));
  }
  @Post('threads/:threadId/image-generations/:requestId/cancel') cancel(
    @Req() request: FastifyRequest,
    @Param('threadId') thread: string,
    @Param('requestId') id: string,
  ) {
    return safe(async () => {
      requireAiSameOrigin(request);
      return this.images.cancel(await this.owner(request), thread, id);
    });
  }
  @Get('threads/:threadId/image-generations/:requestId/image') bytes(
    @Req() request: FastifyRequest,
    @Param('threadId') thread: string,
    @Param('requestId') id: string,
    @Res() reply: FastifyReply,
  ) {
    return safe(async () => {
      const owner = await this.owner(request);
      const permit = await this.images.acquireTransfer(owner);
      let finish!: () => void;
      const completed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const raw = reply.raw;
      const end = () => finish();
      raw.once('finish', end);
      raw.once('close', end);
      raw.once('error', end);
      const deadline = setTimeout(() => {
        raw.destroy();
        finish();
      }, 30000);
      deadline.unref();
      try {
        const bytes = await this.images.bytes(owner, thread, id);
        if (raw.destroyed || raw.writableFinished) return;
        reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Disposition', `inline; filename="asa-image-${id}.png"`)
          .type('image/png')
          .send(bytes);
        await completed;
      } finally {
        clearTimeout(deadline);
        raw.off('finish', end);
        raw.off('close', end);
        raw.off('error', end);
        await this.images.releaseTransfer(owner, permit);
      }
    });
  }
}
@Controller('api/admin/v1/ai/images')
export class AiImageAdminController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly active: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane) private readonly control: AdminControlPlaneService,
    @Inject(AI_IMAGE_SERVICE) private readonly images: AiImageService,
  ) {}
  private async actor(request: FastifyRequest) {
    const context = await this.active.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new AiImageError('unauthorized', 401, 'Нужен вход в аккаунт.');
    const access = await this.control.resolveAccess(context);
    if (!access.scopes.some((s) => s.kind === 'platform' && s.role === 'platform_admin'))
      throw new AiImageError(
        'ai_admin_denied',
        403,
        'Настройки доступны администратору платформы.',
      );
    return context.principalId;
  }
  @Get() get(@Req() request: FastifyRequest) {
    return safe(async () => this.images.admin(await this.actor(request)));
  }
  @Put() put(@Req() request: FastifyRequest, @Body() body: unknown) {
    return safe(async () => {
      requireAiSameOrigin(request);
      return this.images.saveAdmin(await this.actor(request), body);
    });
  }
}
