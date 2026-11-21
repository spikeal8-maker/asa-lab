import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import type { ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import type { AdminScopeKind } from '@asa-lab/authz';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import {
  AdminControlPlaneService,
  type AdminAuditCursor,
  type AdminDashboardRange,
  type AdminIpLabelKind,
  type AdminListCursor,
  type ResolvedAdminAccess,
} from './admin-control-plane.service.js';
import { MaxAuthService } from './max-auth.service.js';
import { TelegramAuthService } from './telegram-auth.service.js';
import { ProviderConfigurationError } from './auth-provider-availability.js';
import { AccountVerificationService } from './account-verification.service.js';
import { AllowUnverifiedAccount } from './account-verification.guard.js';
import { parseCatalogQuery, parseCatalogFilters } from './admin-user-catalog.js';
import { parseHistoryQuery } from './admin-user-history.js';

const DASHBOARD_RANGES = new Set<AdminDashboardRange>([
  '1h',
  '6h',
  '12h',
  '24h',
  '7d',
  '30d',
  '90d',
  '1y',
]);

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
    @Inject(TOKENS.maxAuthService) private readonly maxAuth: MaxAuthService,
    @Inject(TOKENS.telegramAuthService) private readonly telegramAuth: TelegramAuthService,
    @Inject(TOKENS.accountVerification) private readonly verification: AccountVerificationService,
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
  @AllowUnverifiedAccount()
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
  @AllowUnverifiedAccount()
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

  @Get('users')
  async users(
    @Req() request: FastifyRequest,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
    @Query('search') searchRaw: string | undefined,
    @Query('kind') kind: string | undefined,
    @Query('status') status: string | undefined,
    @Query('sort') sort: string | undefined,
    @Query('direction') direction: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query() advanced: Record<string, unknown> = {},
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      const query = parseCatalogQuery({
        kind,
        status,
        sort,
        direction,
        limit,
        cursor,
        search: searchRaw,
        scopeKind: scopeKindRaw,
        scopeId: scopeIdRaw,
      });
      return await this.controlPlane.listUsers(access, {
        scope: this.scope(scopeKindRaw, scopeIdRaw),
        search: this.search(searchRaw),
        ...query,
        filters: parseCatalogFilters(advanced),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Get('users-export')
  async usersExport(
    @Req() request: FastifyRequest,
    @Query() raw: Record<string, string | undefined>,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      const prepared = await this.controlPlane.exportUsers(access, {
        ...parseCatalogQuery(raw),
        scope: this.scope(raw.scopeKind, raw.scopeId),
        search: this.search(raw.search),
        requestId: request.id,
      });
      const fresh = await this.requireAdmin(request);
      if (
        fresh.access.subject.principalId !== access.subject.principalId ||
        !this.controlPlane.authorize(
          fresh.access,
          'administration.accounts.read',
          this.scope(raw.scopeKind, raw.scopeId),
        )
      )
        throw Object.assign(new Error('ADMIN_SCOPE_DENIED'), { code: '42501' });
      return prepared;
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }
  @Get('users-filter-options')
  async catalogFilterOptions(
    @Req() request: FastifyRequest,
    @Query('scopeKind') kind: string | undefined,
    @Query('scopeId') id: string | undefined,
    @Query('search') search: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.catalogFilterOptions(access, {
        scope: this.scope(kind, id),
        search: this.search(search),
        requestId: request.id,
      });
    } catch (problem) {
      this.rethrowAdminFailure(problem);
    }
  }
  @Get('organization-class-bindings')
  async classBindings(@Req() request: FastifyRequest, @Query('search') search: string | undefined) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.classBindings(access, this.search(search));
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }
  @Put('organization-class-bindings')
  async bindClass(
    @Req() request: FastifyRequest,
    @Body()
    raw: {
      classId: string;
      workspaceId: string | null;
      expectedWorkspaceId: string | null;
      reason: string;
    },
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      if (
        !raw ||
        typeof raw.reason !== 'string' ||
        raw.reason.trim().length < 3 ||
        raw.reason.length > 500
      )
        throw Object.assign(new Error('invalid'), { code: '22023' });
      return await this.controlPlane.bindClass(access, {
        classId: this.uuid(raw.classId, 'classId'),
        workspaceId: raw.workspaceId === null ? null : this.uuid(raw.workspaceId, 'workspaceId'),
        expectedWorkspaceId:
          raw.expectedWorkspaceId === null
            ? null
            : this.uuid(raw.expectedWorkspaceId, 'expectedWorkspaceId'),
        reason: raw.reason,
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Get('users/:kind/:targetId/history')
  async userHistory(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('targetId') targetId: string,
    @Query('scopeKind') scopeKind: string | undefined,
    @Query('scopeId') scopeId: string | undefined,
    @Query('category') category: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      if (kind !== 'account' && kind !== 'student')
        throw new HttpException(error('validation_error', 'invalid user kind'), 400);
      return await this.controlPlane.userHistory(access, {
        ...parseHistoryQuery({ category, limit, cursor, scopeKind, scopeId }),
        kind,
        targetId: this.uuid(targetId, 'targetId'),
        scope: this.scope(scopeKind, scopeId),
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

  @Get('accounts/:accountId/crm')
  async accountCrm(
    @Req() request: FastifyRequest,
    @Param('accountId') accountIdRaw: string,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.accountCrm(access, {
        scope: this.scope(scopeKindRaw, scopeIdRaw),
        targetAccountId: this.uuid(accountIdRaw, 'accountId'),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Post('accounts/:accountId/notes')
  @HttpCode(201)
  async addAccountNote(
    @Req() request: FastifyRequest,
    @Param('accountId') accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const { access } = await this.requireAdmin(request);
    const value = this.object(body);
    try {
      return await this.controlPlane.addAccountNote(access, {
        targetAccountId: this.uuid(accountIdRaw, 'accountId'),
        note: this.text(value['note'], 'note', 1, 2000),
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Post('accounts/:accountId/ip-labels')
  @HttpCode(200)
  async setAccountIpLabel(
    @Req() request: FastifyRequest,
    @Param('accountId') accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const { access } = await this.requireAdmin(request);
    const value = this.object(body);
    const ipAddress = this.text(value['ipAddress'], 'ipAddress', 2, 45);
    if (isIP(ipAddress) === 0) {
      throw new HttpException(error('validation_error', 'ipAddress must be IPv4 or IPv6'), 400);
    }
    const labelKind = value['labelKind'];
    if (!['school', 'home', 'mobile', 'organization', 'other'].includes(String(labelKind))) {
      throw new HttpException(error('validation_error', 'unknown IP label kind'), 400);
    }
    const label =
      value['label'] === undefined || value['label'] === null || value['label'] === ''
        ? null
        : this.text(value['label'], 'label', 1, 120);
    try {
      return await this.controlPlane.setAccountIpLabel(access, {
        targetAccountId: this.uuid(accountIdRaw, 'accountId'),
        ipAddress,
        labelKind: labelKind as AdminIpLabelKind,
        label,
        requestId: request.id,
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Delete('accounts/:accountId/ip-labels')
  @HttpCode(200)
  async clearAccountIpLabel(
    @Req() request: FastifyRequest,
    @Param('accountId') accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const { access } = await this.requireAdmin(request);
    const value = this.object(body);
    const ipAddress = this.text(value['ipAddress'], 'ipAddress', 2, 45);
    if (isIP(ipAddress) === 0) {
      throw new HttpException(error('validation_error', 'ipAddress must be IPv4 or IPv6'), 400);
    }
    try {
      return await this.controlPlane.clearAccountIpLabel(access, {
        targetAccountId: this.uuid(accountIdRaw, 'accountId'),
        ipAddress,
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

  @Get('dashboard')
  async dashboard(
    @Req() request: FastifyRequest,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
    @Query('range') rangeRaw: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.productDashboard(access, {
        scope: this.scope(scopeKindRaw, scopeIdRaw),
        range: this.dashboardRange(rangeRaw),
      });
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Get('auth/verification-policy')
  @AllowUnverifiedAccount()
  async verificationPolicy(@Req() request: FastifyRequest) {
    const { context } = await this.requireAdmin(request);
    try {
      return await this.verification.adminPolicy(context.principalId);
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Post('auth/verification-policy')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async updateVerificationPolicy(@Req() request: FastifyRequest, @Body() body: unknown) {
    const { context } = await this.requireAdmin(request);
    const value = this.object(body);
    if (
      typeof value['enabled'] !== 'boolean' ||
      Object.keys(value).some((key) => key !== 'enabled')
    )
      throw new HttpException(error('validation_error', 'enabled must be boolean'), 400);
    try {
      return await this.verification.updatePolicy(
        context.principalId,
        value['enabled'],
        request.id,
      );
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Get('integrations/telegram')
  @AllowUnverifiedAccount()
  async telegramConfiguration(@Req() request: FastifyRequest) {
    const { context } = await this.requireAdmin(request);
    try {
      return await this.telegramAuth.adminConfig(context.principalId);
    } catch (failure) {
      this.rethrowMaxConfigurationFailure(failure);
    }
  }

  @Post('integrations/telegram/check')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async checkTelegramConfiguration(@Req() request: FastifyRequest) {
    const { context } = await this.requireAdmin(request);
    try {
      return await this.telegramAuth.checkAdminConfig(context.principalId);
    } catch (failure) {
      this.rethrowMaxConfigurationFailure(failure);
    }
  }

  @Put('integrations/telegram')
  @AllowUnverifiedAccount()
  async updateTelegramConfiguration(@Req() request: FastifyRequest, @Body() body: unknown) {
    const { context } = await this.requireAdmin(request);
    const value = this.object(body);
    if (typeof value['enabled'] !== 'boolean')
      throw new HttpException(error('validation_error', 'enabled must be boolean'), 400);
    if (value['clearToken'] !== undefined && typeof value['clearToken'] !== 'boolean')
      throw new HttpException(error('validation_error', 'clearToken must be boolean'), 400);
    const token = value['botToken'];
    if (token !== undefined && (typeof token !== 'string' || token.trim().length > 2048))
      throw new HttpException(error('validation_error', 'botToken is invalid'), 400);
    try {
      return await this.telegramAuth.updateAdminConfig(
        context.principalId,
        {
          enabled: value['enabled'],
          botUsername: value['enabled']
            ? this.text(value['botUsername'], 'botUsername', 3, 64)
            : '',
          miniAppUrl: value['enabled']
            ? this.text(value['miniAppUrl'], 'miniAppUrl', 12, 2048)
            : '',
          ...(typeof token === 'string' && token.trim().length > 0
            ? { botToken: token.trim() }
            : {}),
          clearToken: value['clearToken'] === true,
        },
        request.id,
      );
    } catch (failure) {
      this.rethrowMaxConfigurationFailure(failure);
    }
  }

  @Get('integrations/max')
  @AllowUnverifiedAccount()
  async maxConfiguration(@Req() request: FastifyRequest) {
    const { context } = await this.requireAdmin(request);
    try {
      return await this.maxAuth.adminConfig(context.principalId);
    } catch (failure) {
      this.rethrowMaxConfigurationFailure(failure);
    }
  }

  @Post('integrations/max/check')
  @HttpCode(200)
  @AllowUnverifiedAccount()
  async checkMaxConfiguration(@Req() request: FastifyRequest) {
    const { context } = await this.requireAdmin(request);
    try {
      return await this.maxAuth.checkAdminConfig(context.principalId);
    } catch (failure) {
      this.rethrowMaxConfigurationFailure(failure);
    }
  }

  @Put('integrations/max')
  @AllowUnverifiedAccount()
  async updateMaxConfiguration(@Req() request: FastifyRequest, @Body() body: unknown) {
    const { context } = await this.requireAdmin(request);
    const value = this.object(body);
    if (typeof value['enabled'] !== 'boolean') {
      throw new HttpException(error('validation_error', 'enabled must be boolean'), 400);
    }
    if (value['clearToken'] !== undefined && typeof value['clearToken'] !== 'boolean') {
      throw new HttpException(error('validation_error', 'clearToken must be boolean'), 400);
    }
    const token = value['botToken'];
    if (token !== undefined && (typeof token !== 'string' || token.trim().length > 2048)) {
      throw new HttpException(error('validation_error', 'botToken is invalid'), 400);
    }
    try {
      return await this.maxAuth.updateAdminConfig(
        context.principalId,
        {
          enabled: value['enabled'],
          botUsername: value['enabled']
            ? this.text(value['botUsername'], 'botUsername', 3, 64)
            : '',
          miniAppUrl: value['enabled']
            ? this.text(value['miniAppUrl'], 'miniAppUrl', 12, 2048)
            : '',
          ...(typeof token === 'string' && token.trim().length > 0
            ? { botToken: token.trim() }
            : {}),
          clearToken: value['clearToken'] === true,
        },
        request.id,
      );
    } catch (failure) {
      this.rethrowMaxConfigurationFailure(failure);
    }
  }

  @Get('security/ip-activity')
  async ipActivity(
    @Req() request: FastifyRequest,
    @Query('scopeKind') scopeKindRaw: string | undefined,
    @Query('scopeId') scopeIdRaw: string | undefined,
    @Query('range') rangeRaw: string | undefined,
    @Query('minimumDistinct') minimumDistinctRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
  ) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.listIpActivity(access, {
        scope: this.scope(scopeKindRaw, scopeIdRaw),
        range: this.dashboardRange(rangeRaw),
        minimumDistinct: this.minimumDistinct(minimumDistinctRaw),
        limit: this.limit(limitRaw),
      });
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

  @Get('accounts/:accountId/max')
  async maxIdentity(@Req() request: FastifyRequest, @Param('accountId') accountIdRaw: string) {
    const { access } = await this.requireAdmin(request);
    try {
      return await this.controlPlane.maxIdentityStatus(
        access,
        this.uuid(accountIdRaw, 'accountId'),
      );
    } catch (failure) {
      this.rethrowAdminFailure(failure);
    }
  }

  @Post('accounts/:accountId/max/revoke')
  @HttpCode(200)
  async revokeMaxIdentity(
    @Req() request: FastifyRequest,
    @Param('accountId') accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const { access } = await this.requireAdmin(request);
    const value = this.object(body);
    try {
      return await this.controlPlane.revokeMaxIdentity(access, {
        targetAccountId: this.uuid(accountIdRaw, 'accountId'),
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

  private text(value: unknown, field: string, minimum: number, maximum: number): string {
    if (typeof value !== 'string') {
      throw new HttpException(error('validation_error', `${field} is required`), 400);
    }
    const text = value.trim();
    if (text.length < minimum || text.length > maximum) {
      throw new HttpException(
        error('validation_error', `${field} must contain ${minimum} to ${maximum} characters`),
        400,
      );
    }
    return text;
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

  private dashboardRange(value: string | undefined): AdminDashboardRange {
    const range = value ?? '24h';
    if (!DASHBOARD_RANGES.has(range as AdminDashboardRange)) {
      throw new HttpException(error('validation_error', 'unknown dashboard range'), 400);
    }
    return range as AdminDashboardRange;
  }

  private minimumDistinct(value: string | undefined): number {
    if (value === undefined) return 2;
    if (!/^\d{1,3}$/.test(value)) {
      throw new HttpException(error('validation_error', 'minimumDistinct must be 1 to 100'), 400);
    }
    const minimum = Number.parseInt(value, 10);
    if (minimum < 1 || minimum > 100) {
      throw new HttpException(error('validation_error', 'minimumDistinct must be 1 to 100'), 400);
    }
    return minimum;
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
    if (message === 'CRM_EXPORT_TOO_LARGE')
      throw new HttpException(
        error(
          'crm_export_too_large',
          'Слишком большая выгрузка: уточните фильтры (до 10 000 записей и 16 МБ).',
        ),
        413,
      );
    if (message === 'CRM_EXPORT_BUSY')
      throw new HttpException(
        error('crm_export_busy', 'Выгрузка уже выполняется. Повторите позже.'),
        429,
      );
    if (pgCode === '57014')
      throw new HttpException(
        error('crm_query_timeout', 'Запрос слишком большой: уточните фильтры.'),
        422,
      );
    if (pgCode === '40001')
      throw new HttpException(
        error('crm_conflict', 'Привязка уже изменена. Обновите список.'),
        409,
      );
    if (pgCode === '22023') {
      throw new HttpException(error('validation_error', 'invalid administrative query'), 400);
    }
    throw failure;
  }

  private rethrowMaxConfigurationFailure(failure: unknown): never {
    if (failure instanceof ProviderConfigurationError) {
      const suffix = failure.code.replace(/^(max|telegram)_/, '');
      const responses: Record<string, { status: number; message: string }> = {
        encryption_key_missing: {
          status: 503,
          message: 'Серверное хранилище секретов ещё не подготовлено.',
        },
        token_missing: { status: 409, message: 'Для включения нужен токен бота.' },
        token_invalid: { status: 422, message: 'Сервис отклонил этот токен.' },
        token_bot_mismatch: {
          status: 422,
          message: 'Имя бота не совпадает с ботом, которому принадлежит токен.',
        },
        webhook_url_invalid: {
          status: 400,
          message: 'Нужен разрешённый публичный HTTPS-адрес и поддерживаемый порт.',
        },
        webhook_conflict: {
          status: 409,
          message: 'Этот бот уже подключён к другому адресу. Прежние настройки сохранены.',
        },
        service_unavailable: {
          status: 503,
          message: 'Сервис сейчас не отвечает. Проверьте состояние подключения.',
        },
      };
      const response = responses[suffix] ?? {
        status: 503,
        message: 'Настройки подключения не сохранены.',
      };
      throw new HttpException(error(failure.code, response.message), response.status);
    }
    if ((failure as { code?: string })?.code === '40001')
      throw new HttpException(
        error('configuration_changed', 'Настройки уже изменены. Обновите страницу и повторите.'),
        409,
      );
    this.rethrowAdminFailure(failure);
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
