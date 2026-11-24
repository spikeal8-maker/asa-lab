import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { aiPublicErrorMessage, AI_TEXT_UNAVAILABLE } from '@asa-lab/contracts';
import { expect, it, vi } from 'vitest';
import { AiChatController } from './ai-chat.controller';
import { AiAdminController } from './ai-admin.controller';
import type { AdminControlPlaneService } from './admin-control-plane.service';
import type { AiAccessService } from './ai-access.service';
import type { AiChatService } from './ai-chat.service';
import type { SeatContextUseCase } from './seat-context';
import { validPolicyInput } from './ai-generation-policy';
import { validBudgetInput } from './ai-token-budgets';
import { providerUsage } from './ai-provider-usage';
import { usageFailureCode } from './ai-usage-journal';
import { LlamaCppError } from './ai-llamacpp';

const OWNER = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const active = {
  resolve: vi.fn(async () => ({ principalId: OWNER, accountId: OWNER })),
} as unknown as ActiveContextUseCase;
function request(origin = 'http://localhost') {
  return {
    id: REQUEST,
    cookies: {},
    headers: { origin, host: 'localhost', 'content-type': 'application/json' },
  } as unknown as FastifyRequest;
}

it('accepts the independent provider at the actual chat controller boundary', async () => {
  const sendStream = vi.fn(async () => ({ messages: [], replayed: false, stopped: false }));
  const controller = new AiChatController(
    active,
    { sendStream } as unknown as AiChatService,
    { resolveExisting: vi.fn(async () => null) } as unknown as SeatContextUseCase,
    { owner: vi.fn(async () => OWNER) } as unknown as AiAccessService,
  );
  const raw = {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
  await controller.sendStream(
    request(),
    { hijack: vi.fn(), raw } as unknown as FastifyReply,
    THREAD,
    { message: 'Привет', requestId: REQUEST, model: 'llamacpp-local' },
  );
  expect(sendStream.mock.calls[0]?.[6]).toBe('llamacpp-local');
  expect(raw.write).toHaveBeenCalledWith(expect.stringContaining('event: done'));
});

it('preserves early busy errors in JSON and SSE while redacting provider diagnostics', async () => {
  const fail = vi.fn(async () => {
    throw new LlamaCppError('ai_llamacpp_busy', 409, 'Private endpoint detail');
  });
  const controller = new AiChatController(
    active,
    { send: fail, sendStream: fail } as unknown as AiChatService,
    { resolveExisting: vi.fn(async () => null) } as unknown as SeatContextUseCase,
    { owner: vi.fn(async () => OWNER) } as unknown as AiAccessService,
  );
  await expect(
    controller.send(request(), THREAD, { message: 'Привет', requestId: REQUEST }),
  ).rejects.toMatchObject({
    status: 409,
    response: { error: { code: 'ai_llamacpp_busy', message: AI_TEXT_UNAVAILABLE } },
  });
  const raw = {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
  await controller.sendStream(
    request(),
    { hijack: vi.fn(), raw } as unknown as FastifyReply,
    THREAD,
    { message: 'Привет', requestId: REQUEST, model: 'llamacpp-local' },
  );
  expect(raw.write).toHaveBeenCalledWith(
    'event: error\ndata: ' +
      JSON.stringify({ code: 'ai_llamacpp_busy', message: AI_TEXT_UNAVAILABLE }) +
      '\n\n',
  );
  expect(JSON.stringify(raw.write.mock.calls)).not.toContain('Private endpoint detail');
});

it('uses the reviewed stable apply UUID and preserves origin and administrator checks', async () => {
  const apply = vi.fn(async () => ({ verified: true }));
  const permissions = vi.fn(async () => ({
    scopes: [{ kind: 'platform', role: 'platform_admin' }],
  }));
  const controller = new AiAdminController(
    active,
    { resolveAccess: permissions } as unknown as AdminControlPlaneService,
    { applyLlamaCppSettings: apply } as unknown as AiChatService,
  );
  const body = {
    requestId: REQUEST,
    enabled: true,
    revision: 1,
    baseUrl: 'http://127.0.0.1:8080',
    model: 'fixture',
  };
  await controller.applyLlamaCpp(request(), body);
  expect(apply).toHaveBeenCalledExactlyOnceWith(OWNER, body, REQUEST);
  await expect(
    controller.applyLlamaCpp(request('https://untrusted.example'), body),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    controller.applyLlamaCpp(request(), { ...body, requestId: undefined }),
  ).rejects.toMatchObject({ status: 400 });
  permissions.mockResolvedValueOnce({ scopes: [] });
  await expect(controller.applyLlamaCpp(request(), body)).rejects.toMatchObject({ status: 403 });
  expect(apply).toHaveBeenCalledTimes(1);
});

it('keeps an upstream key error separate from the ASA login session', async () => {
  const controller = new AiAdminController(
    active,
    {
      resolveAccess: vi.fn(async () => ({
        scopes: [{ kind: 'platform', role: 'platform_admin' }],
      })),
    } as unknown as AdminControlPlaneService,
    {
      llamaCppModels: vi.fn(async () => {
        throw new LlamaCppError('ai_llamacpp_auth', 502, 'Сервер отклонил ключ.');
      }),
    } as unknown as AiChatService,
  );
  await expect(controller.llamaCppModels(request(), {})).rejects.toMatchObject({
    status: 502,
    response: { error: { code: 'ai_llamacpp_auth' } },
  });
  expect(aiPublicErrorMessage('ai_llamacpp_auth', 'private endpoint and key')).toBe(
    AI_TEXT_UNAVAILABLE,
  );
});

it('admits llama.cpp in policy and budgets without masquerading as Ollama', () => {
  const policy = {
    configurationVersion: 1,
    systemPrompt: 'Ответь {{tools}}',
    allowedModels: ['ollama-local', 'llamacpp-local'],
    defaultModel: 'llamacpp-local',
    providerOrder: { ollama: 0, 'llamacpp-local': 1 },
    requestId: REQUEST,
  };
  expect(validPolicyInput(policy)).toEqual(policy);
  const budget = {
    configurationVersion: 1,
    models: [{ model: 'llamacpp-local', globalLimit: '1000', userLimit: null }],
    requestId: REQUEST,
  };
  expect(validBudgetInput(budget)).toEqual(budget);
});

it('records only provider-reported token counts and fixed safe llama.cpp failure codes', () => {
  expect(
    providerUsage('llamacpp-local', {
      model: 'fixture:qwen',
      usage: { prompt_tokens: 212, completion_tokens: 37 },
    }),
  ).toEqual({ inputTokens: 212, outputTokens: 37, actualModel: 'fixture:qwen' });
  expect(
    providerUsage('llamacpp-local', {
      model: '/models/private model.gguf',
      usage: { prompt_tokens: 12 },
    }),
  ).toEqual({ inputTokens: 12, outputTokens: null, actualModel: null });
  expect(usageFailureCode({ code: 'ai_llamacpp_timeout' })).toBe('ai_llamacpp_timeout');
  expect(usageFailureCode({ code: 'ai_llamacpp_private_key_value' })).toBe('ai_generation_failed');
});
