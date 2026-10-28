import type { AiWebSearchAdminUpdate, AiGenerationPolicyUpdate } from '@asa-lab/contracts';
import { AiPolicyError } from './ai-generation-policy.js';
import { AiWebSearchError } from './ai-web-search.js';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { AiChatService, AiServiceError, type AiProvider, type AiModel } from './ai-chat.service.js';
import { isAiProvider, isModelForProvider } from './ai-model-catalog.js';
import { OllamaError } from './ai-ollama.js';
import { ComfyUiError, discoverComfyUi } from './ai-comfyui.js';
import { AdminControlPlaneService } from './admin-control-plane.service.js';
import { AiUsageUnavailable } from './ai-usage-journal.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

function reject(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}

@Controller('api/admin/v1/ai')
export class AiAdminController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane)
    private readonly controlPlane: AdminControlPlaneService,
    @Inject(TOKENS.aiChatService) private readonly ai: AiChatService,
  ) {}

  private async requirePlatformAdmin(request: FastifyRequest): Promise<string> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) return reject('unauthorized', 'Нужен вход в аккаунт.', 401);
    const access = await this.controlPlane.resolveAccess(context);
    if (
      !access.scopes.some((scope) => scope.kind === 'platform' && scope.role === 'platform_admin')
    ) {
      return reject('ai_admin_denied', 'Настройки ИИ доступны администратору платформы.', 403);
    }
    return context.principalId;
  }

  private requireSameOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin;
    if (!origin || typeof origin !== 'string') {
      return reject('ai_origin_required', 'Источник запроса не подтверждён.', 403);
    }
    try {
      if (new URL(origin).host !== request.headers.host) {
        return reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
      }
    } catch {
      return reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
    }
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      return reject('ai_json_required', 'Нужен JSON-запрос.', 415);
    }
  }

  private async safe<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (problem) {
      if (problem instanceof AiUsageUnavailable) {
        return reject('ai_usage_unavailable', 'Не удалось загрузить данные использования ИИ.', 503);
      }
      if (
        problem instanceof AiServiceError ||
        problem instanceof AiWebSearchError ||
        problem instanceof OllamaError ||
        problem instanceof ComfyUiError ||
        problem instanceof AiPolicyError
      ) {
        return reject(problem.code, problem.message, problem.status);
      }
      if ((problem as { code?: string }).code === '42501') {
        return reject('ai_admin_denied', 'Нет прав для управления ИИ.', 403);
      }
      throw problem;
    }
  }

  @Get('usage-overview')
  @Header('Cache-Control', 'private, no-store')
  async usageOverview(@Req() request: FastifyRequest) {
    const actor = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.usageOverview(actor));
  }

  @Get('web-search')
  async webSearchConfig(@Req() request: FastifyRequest) {
    const actor = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.webSearchAdmin(actor));
  }

  @Get('generation-policy')
  async generationPolicy(@Req() request: FastifyRequest) {
    const actor = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.generationPolicy(actor));
  }

  @Get('token-budgets')
  @Header('Cache-Control', 'private, no-store')
  async tokenBudgets(@Req() request: FastifyRequest) {
    const actor = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.tokenBudgetsAdmin(actor));
  }

  @Put('token-budgets')
  @Header('Cache-Control', 'private, no-store')
  async saveTokenBudgets(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const actor = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.saveTokenBudgets(actor, raw));
  }

  @Post('generation-policy/catalog')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async refreshCatalog(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const actor = await this.requirePlatformAdmin(request);
    const provider = (raw as { provider?: unknown } | null)?.provider;
    if (provider !== 'openai' && provider !== 'deepseek')
      return reject('ai_catalog_invalid', 'Выберите провайдера.', 400);
    return this.safe(() => this.ai.refreshProviderCatalog(actor, provider));
  }
  @Put('generation-policy')
  async saveGenerationPolicy(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const actor = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.saveGenerationPolicy(actor, raw as AiGenerationPolicyUpdate));
  }

  @Put('web-search')
  async saveWebSearch(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const actor = await this.requirePlatformAdmin(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return reject('ai_web_config_invalid', 'Нужны настройки поиска.', 400);
    return this.safe(() => this.ai.saveWebSearch(actor, raw as AiWebSearchAdminUpdate, request.id));
  }

  @Get()
  async get(@Req() request: FastifyRequest) {
    const principalId = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.adminConfig(principalId));
  }

  @Get('ollama-cloud/keys')
  @Header('Cache-Control', 'private, no-store')
  async cloudKeys(@Req() request: FastifyRequest) {
    const actor = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.ollamaCloudPool(actor));
  }
  @Put('ollama-cloud/keys')
  @Header('Cache-Control', 'private, no-store')
  async saveCloudKeys(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const actor = await this.requirePlatformAdmin(request);
    const body = raw as { configurationVersion?: unknown; keys?: unknown } | null;
    if (
      !body ||
      !Number.isSafeInteger(body.configurationVersion) ||
      Number(body.configurationVersion) < 1
    )
      return reject('ai_cloud_pool_invalid', 'Нужна актуальная версия настроек.', 400);
    return this.safe(() =>
      this.ai.saveOllamaCloudPool(actor, Number(body.configurationVersion), body.keys, request.id),
    );
  }
  @Post('ollama-cloud/keys/inspect')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async inspectCloudKeys(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const actor = await this.requirePlatformAdmin(request);
    const body = raw as { configurationVersion?: unknown } | null;
    if (
      !body ||
      !Number.isSafeInteger(body.configurationVersion) ||
      Number(body.configurationVersion) < 1
    )
      return reject('ai_cloud_pool_invalid', 'Нужна актуальная версия настроек.', 400);
    return this.safe(() =>
      this.ai.inspectOllamaCloudPool(actor, Number(body.configurationVersion), request.id),
    );
  }

  @Post('test')
  @HttpCode(200)
  async test(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const principalId = await this.requirePlatformAdmin(request);
    const body = raw as {
      acknowledgePaidRequest?: unknown;
      configurationVersion?: unknown;
      provider?: unknown;
      providerConfigurationVersion?: unknown;
    } | null;
    if (
      !body ||
      body.acknowledgePaidRequest !== true ||
      !Number.isSafeInteger(body.configurationVersion) ||
      Number(body.configurationVersion) < 1 ||
      !['openai', 'deepseek', 'ollama-cloud'].includes(String(body.provider)) ||
      !Number.isSafeInteger(body.providerConfigurationVersion) ||
      Number(body.providerConfigurationVersion) < 1
    ) {
      return reject(
        'ai_test_confirmation_required',
        'Подтвердите один платный запрос к сохранённой модели.',
        400,
      );
    }
    return this.safe(() =>
      this.ai.testConnection(
        principalId,
        Number(body.configurationVersion),
        body.provider as AiProvider,
        Number(body.providerConfigurationVersion),
      ),
    );
  }

  @Put()
  @HttpCode(200)
  async update(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const principalId = await this.requirePlatformAdmin(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_config_invalid', 'Неверные настройки ИИ.', 400);
    }
    const value = raw as Record<string, unknown>;
    const provider = value['provider'];
    const model = value['model'];
    const enabled = value['enabled'];
    const clearApiKey = value['clearApiKey'];
    const apiKey = value['apiKey'];
    const paidOperationsPerHour = value['paidOperationsPerHour'];
    const configurationVersion = value['configurationVersion'];
    const providerConfigurationVersion = value['providerConfigurationVersion'];
    if (
      !isAiProvider(provider) ||
      !(
        isModelForProvider(provider, model) ||
        (provider === 'ollama-cloud' &&
          typeof model === 'string' &&
          model.startsWith('ollama-cloud/') &&
          (await this.ai.isDiscoveredCloudModel(model)))
      ) ||
      typeof enabled !== 'boolean' ||
      (paidOperationsPerHour !== undefined &&
        (!Number.isInteger(paidOperationsPerHour) ||
          Number(paidOperationsPerHour) < 0 ||
          Number(paidOperationsPerHour) > 2147483647)) ||
      (clearApiKey !== undefined && typeof clearApiKey !== 'boolean') ||
      (apiKey !== undefined && typeof apiKey !== 'string') ||
      (configurationVersion !== undefined &&
        (!Number.isSafeInteger(configurationVersion) || Number(configurationVersion) < 1)) ||
      (providerConfigurationVersion !== undefined &&
        (!Number.isSafeInteger(providerConfigurationVersion) ||
          Number(providerConfigurationVersion) < 1))
    ) {
      return reject('ai_config_invalid', 'Неверные настройки ИИ.', 400);
    }
    return this.safe(() =>
      this.ai.saveAdminConfig(
        principalId,
        {
          provider: provider as AiProvider,
          model: model as AiModel,
          enabled,
          ...(typeof paidOperationsPerHour === 'number' ? { paidOperationsPerHour } : {}),
          ...(typeof configurationVersion === 'number' ? { configurationVersion } : {}),
          ...(typeof providerConfigurationVersion === 'number'
            ? { providerConfigurationVersion }
            : {}),
          ...(typeof apiKey === 'string' ? { apiKey } : {}),
          ...(typeof clearApiKey === 'boolean' ? { clearApiKey } : {}),
        },
        request.id,
      ),
    );
  }

  @Post('ollama-cloud/inspect')
  @HttpCode(200)
  async inspectOllamaCloud(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const actor = await this.requirePlatformAdmin(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return reject('ai_config_invalid', 'Неверный запрос.', 400);
    const input = raw as { configurationVersion?: unknown; apiKey?: unknown };
    if (
      !Number.isSafeInteger(input.configurationVersion) ||
      Number(input.configurationVersion) < 1 ||
      (input.apiKey !== undefined && typeof input.apiKey !== 'string')
    )
      return reject('ai_config_invalid', 'Неверный запрос.', 400);
    return this.safe(() =>
      this.ai.inspectOllamaCloud(
        actor,
        Number(input.configurationVersion),
        input.apiKey as string | undefined,
        request.id,
      ),
    );
  }

  @Get('ollama')
  async ollama(@Req() request: FastifyRequest) {
    const principalId = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.ollamaSettings(principalId));
  }

  @Put('ollama')
  @HttpCode(200)
  async updateOllama(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const principalId = await this.requirePlatformAdmin(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_ollama_config_invalid', 'Неверные настройки Ollama.', 400);
    }
    const value = raw as Record<string, unknown>;
    if (
      typeof value['enabled'] !== 'boolean' ||
      typeof value['baseUrl'] !== 'string' ||
      typeof value['model'] !== 'string' ||
      !Number.isSafeInteger(value['revision'])
    ) {
      return reject('ai_ollama_config_invalid', 'Неверные настройки Ollama.', 400);
    }
    return this.safe(() =>
      this.ai.saveOllamaSettings(
        principalId,
        {
          enabled: value['enabled'] as boolean,
          baseUrl: value['baseUrl'] as string,
          model: value['model'] as string,
          revision: value['revision'] as number,
        },
        request.id,
      ),
    );
  }

  @Put('ollama/apply')
  @HttpCode(200)
  async applyOllama(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const principalId = await this.requirePlatformAdmin(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_ollama_config_invalid', 'Неверные настройки Ollama.', 400);
    }
    const input = raw as Record<string, unknown>;
    if (
      typeof input['enabled'] !== 'boolean' ||
      typeof input['baseUrl'] !== 'string' ||
      typeof input['model'] !== 'string' ||
      !Number.isSafeInteger(input['revision'])
    ) {
      return reject('ai_ollama_config_invalid', 'Неверные настройки Ollama.', 400);
    }
    return this.safe(() =>
      this.ai.applyOllamaSettings(
        principalId,
        {
          enabled: input['enabled'] as boolean,
          baseUrl: input['baseUrl'] as string,
          model: input['model'] as string,
          revision: input['revision'] as number,
        },
        request.id,
      ),
    );
  }

  @Get('comfyui/status')
  async comfyUiStatus(@Req() request: FastifyRequest) {
    await this.requirePlatformAdmin(request);
    return this.safe(() => discoverComfyUi());
  }

  @Post('ollama/models')
  @HttpCode(200)
  async ollamaModels(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const principalId = await this.requirePlatformAdmin(request);
    if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
      return reject('ai_ollama_config_invalid', 'Неверный адрес Ollama.', 400);
    }
    const baseUrl = (raw as { baseUrl?: unknown } | undefined)?.baseUrl;
    if (baseUrl !== undefined && typeof baseUrl !== 'string') {
      return reject('ai_ollama_config_invalid', 'Неверный адрес Ollama.', 400);
    }
    return this.safe(async () => ({ models: await this.ai.ollamaModels(principalId, baseUrl) }));
  }

  @Post('ollama/test')
  @HttpCode(200)
  async ollamaTest(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const principalId = await this.requirePlatformAdmin(request);
    const revision = (raw as { revision?: unknown } | null)?.revision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
      return reject('ai_ollama_config_invalid', 'Сохраните настройки Ollama перед проверкой.', 400);
    }
    return this.safe(() => this.ai.testOllama(principalId, Number(revision)));
  }
}
