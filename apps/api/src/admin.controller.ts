import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import type { AdminScopeKind } from '@asa-lab/authz';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import {
  AdminControlPlaneService,
  type AdminAuditCursor,
  type AdminListCursor,
  type ResolvedAdminAccess,
} from './admin-control-plane.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

@Controller('api/admin/v1')
export class AdminController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane)
    private readonly controlPlane: AdminControlPlaneService,
  ) {}

  private async requireContext(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    return context;
  }

  private async requireAdmin(
    request: FastifyRequest,
  ): Promise<{ readonly context: ActiveContext; readonly access: ResolvedAdminAccess }> {
    const context = await this.requireContext(request);
    const access = await this.controlPlane.resolveAccess(context);
    if (access.scopes.length === 0) {
      throw new HttpException(
        error('admin_forbidden', 'administrative access is not granted'),
        403,
      );
    }
    return { context, access };
  }

  @Get('me')
  async me(@Req() request: FastifyRequest) {
    const { context, access } = await this.requireAdmin(request);
    return {
      administrator: true as const,
      principalId: context.principalId,
      accountId: context.accountId,
      displayName: context.displayName,
      activeWorkspaceId: context.workspaceId,
      scopes: access.scopes,
    };
  }

  @Get('scopes')
  async scopes(@Req() request: FastifyRequest) {
    const { access } = await this.requireAdmin(request);
    return { items: access.scopes };
  }

  @Get('audit-events')
  async auditEvents(
    @Req() request: FastifyRequest,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('before') beforeRaw: string | undefined,
    @Query('beforeId') beforeIdRaw: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    const scope = this.scope(scopeKindRaw, scopeIdRaw);
    const limit = this.limit(limitRaw);
    const cursor = this.cursor(beforeRaw, beforeIdRaw);
    try {
      return await this.controlPlane.listAuditEvents(access, {
        scope,
        limit,
        cursor,
        requestId: request.id,
      });
    } catch (failure) {
      const pgCode = (failure as { code?: string }).code;
      if ((failure as Error).message === 'ADMIN_SCOPE_DENIED' || pgCode === '42501') {
        throw new HttpException(error('admin_scope_forbidden', 'administrative scope denied'), 403);
      }
      throw failure;
    }
  }

  @Get('accounts')
  async accounts(
    @Req() request: FastifyRequest,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
    @Query('search') searchRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('before') beforeRaw: string | undefined,
    @Query('beforeId') beforeIdRaw: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.listAccounts(access, {
        scope: this.scope(scopeKindRaw, scopeIdRaw),
        search: this.search(searchRaw),
        limit: this.limit(limitRaw),
        cursor: this.listCursor(beforeRaw, beforeIdRaw),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Get('organizations')
  async organizations(
    @Req() request: FastifyRequest,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
    @Query('search') searchRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('before') beforeRaw: string | undefined,
    @Query('beforeId') beforeIdRaw: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.listOrganizations(access, {
        scope: this.scope(scopeKindRaw, scopeIdRaw),
        search: this.search(searchRaw),
        limit: this.limit(limitRaw),
        cursor: this.listCursor(beforeRaw, beforeIdRaw),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Get('security/sessions')
  async securitySessions(
    @Req() request: FastifyRequest,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
    @Query('search') searchRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('before') beforeRaw: string | undefined,
    @Query('beforeId') beforeIdRaw: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.listSecuritySessions(access, {
        scope: this.scope(scopeKindRaw, scopeIdRaw),
        search: this.search(searchRaw),
        limit: this.limit(limitRaw),
        cursor: this.listCursor(beforeRaw, beforeIdRaw),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Get('operations/status')
  async operationsStatus(@Req() request: FastifyRequest) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.operationsStatus(access, { requestId: request.id });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Post('accounts/:accountId/status')
  @HttpCode(200)
  async setAccountStatus(
    @Req() request: FastifyRequest,
    @Param('accountId') accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const { access } = await this.requireAdmin(request);
    const accountId = this.uuid(accountIdRaw, 'accountId');
    const value = this.object(body);
    const status = value['status'];
    if (status !== 'active' && status !== 'suspended') {
      throw new HttpException(error('validation_error', 'status must be active or suspended'), 400);
    }
    try {
      return await this.controlPlane.setAccountStatus(access, {
        targetAccountId: accountId,
        status,
        reason: this.reason(value['reason']),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Post('accounts/:accountId/platform-admin')
  @HttpCode(200)
  async setPlatformAdmin(
    @Req() request: FastifyRequest,
    @Param('accountId') accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const { access } = await this.requireAdmin(request);
    const accountId = this.uuid(accountIdRaw, 'accountId');
    const value = this.object(body);
    if (typeof value['enabled'] !== 'boolean') {
      throw new HttpException(error('validation_error', 'enabled must be boolean'), 400);
    }
    try {
      return await this.controlPlane.setPlatformAdmin(access, {
        targetAccountId: accountId,
        enabled: value['enabled'],
        reason: this.reason(value['reason']),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Post('security/sessions/:sessionId/revoke')
  @HttpCode(200)
  async revokeSession(
    @Req() request: FastifyRequest,
    @Param('sessionId') sessionIdRaw: string,
    @Body() body: unknown,
  ) {
    const { access } = await this.requireAdmin(request);
    const value = this.object(body);
    try {
      return await this.controlPlane.revokeSession(access, {
        sessionId: this.uuid(sessionIdRaw, 'sessionId'),
        reason: this.reason(value['reason']),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  private scope(
    kind: string | undefined,
    id: string | undefined,
  ): { readonly kind: AdminScopeKind; readonly id: string | null } {
    if (kind === 'platform' && id === undefined) return { kind, id: null };
    if (kind === 'organization' && typeof id === 'string' && UUID.test(id)) {
      return { kind, id };
    }
    throw new HttpException(
      error(
        'validation_error',
        'platform scope has no scopeId; organization scope requires a UUID scopeId',
      ),
      400,
    );
  }

  private uuid(value: string, field: string): string {
    if (!UUID.test(value)) {
      throw new HttpException(error('validation_error', `${field} must be a UUID`), 400);
    }
    return value;
  }

  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpException(error('validation_error', 'JSON object is required'), 400);
    }
    return value as Record<string, unknown>;
  }

  private reason(value: unknown): string {
    if (typeof value !== 'string') {
      throw new HttpException(error('validation_error', 'reason is required'), 400);
    }
    const reason = value.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new HttpException(
        error('validation_error', 'reason must contain 3 to 500 characters'),
        400,
      );
    }
    return reason;
  }

  private limit(value: string | undefined): number {
    if (value === undefined) return 50;
    if (!/^\d{1,3}$/.test(value)) {
      throw new HttpException(error('validation_error', 'limit must be between 1 and 200'), 400);
    }
    const limit = Number.parseInt(value, 10);
    if (limit < 1 || limit > 200) {
      throw new HttpException(error('validation_error', 'limit must be between 1 and 200'), 400);
    }
    return limit;
  }

  private search(value: string | undefined): string | null {
    if (value === undefined) return null;
    const search = value.trim();
    if (search.length > 100) {
      throw new HttpException(
        error('validation_error', 'search must not exceed 100 characters'),
        400,
      );
    }
    return search.length === 0 ? null : search;
  }

  private listCursor(
    before: string | undefined,
    beforeId: string | undefined,
  ): AdminListCursor | null {
    if (before === undefined && beforeId === undefined) return null;
    if (
      before === undefined ||
      beforeId === undefined ||
      !UUID.test(beforeId) ||
      !Number.isFinite(Date.parse(before))
    ) {
      throw new HttpException(
        error(
          'validation_error',
          'list cursor requires a valid before timestamp and beforeId UUID',
        ),
        400,
      );
    }
    return { before: new Date(before).toISOString(), id: beforeId };
  }

  private rethrowAdminFailure(failure: unknown): never {
    const pgCode = (failure as { code?: string }).code;
    const message = (failure as Error).message;
    if (message === 'ADMIN_SELF_PROTECTION' || message.includes('administrator cannot')) {
      throw new HttpException(
        error('admin_self_protection', 'you cannot remove your own administrative access'),
        409,
      );
    }
    if (message === 'ADMIN_SCOPE_DENIED' || pgCode === '42501') {
      throw new HttpException(error('admin_scope_forbidden', 'administrative scope denied'), 403);
    }
    if (pgCode === '22023') {
      throw new HttpException(error('validation_error', 'invalid administrative query'), 400);
    }
    throw failure;
  }

  private cursor(
    before: string | undefined,
    beforeId: string | undefined,
  ): AdminAuditCursor | null {
    if (before === undefined && beforeId === undefined) return null;
    if (
      before === undefined ||
      beforeId === undefined ||
      !UUID.test(beforeId) ||
      !Number.isFinite(Date.parse(before))
    ) {
      throw new HttpException(
        error(
          'validation_error',
          'audit cursor requires a valid before timestamp and beforeId UUID',
        ),
        400,
      );
    }
    return { occurredAt: new Date(before).toISOString(), id: beforeId };
  }
}
