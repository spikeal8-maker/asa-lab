import { prePolzaPool } from './testing/ai-pre-polza-pool.fixture';
import { getAiModelCatalog, installOllamaCloudCatalog } from './ai-model-catalog';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { expect, it, vi } from 'vitest';
import { AiAdminController } from './ai-admin.controller';
import type { AiChatService } from './ai-chat.service';
import type { AdminControlPlaneService } from './admin-control-plane.service';
import {
  AI_DEFAULT_SYSTEM_PROMPT,
  AiGenerationPolicyStore,
  policyInstructions,
  validPolicyInput,
} from './ai-generation-policy';

it('renders tool and material variables from the actual request, without inventing callable tools', () => {
  const output = policyInstructions(
    '{{tools}}\n{{materials}}',
    {},
    {
      webSearch: {
        schemaVersion: 1,
        provider: 'searxng',
        mode: 'weather',
        status: 'ready',
        query: 'Москва',
        retrievedAt: '2026-10-26T12:00:00Z',
        sources: [],
        images: [],
      },
      attachmentCount: 2,
      readableAttachmentText: true,
      imageCount: 0,
    },
  );
  const lines = output.split('\n');
  const tools = JSON.parse(JSON.parse(lines.at(-2)!));
  const materials = JSON.parse(JSON.parse(lines.at(-1)!));
  expect(tools.callable_by_model).toEqual([]);
  expect(tools.weather.result).toBe('ready');
  expect(tools.generate_image.execution).toContain('пока не подключён');
  expect(materials.attachments).toEqual({
    count: 2,
    extracted_text_provided: true,
    image_pixels_provided: 0,
  });
  expect(materials.internet.retrieved_at).toBe('2026-10-26T12:00:00Z');
  expect(AI_DEFAULT_SYSTEM_PROMPT).toContain('{{tools}}');
  expect(AI_DEFAULT_SYSTEM_PROMPT).toContain('{{materials}}');
});

it('accepts the new variables and retains server facts when an administrator omits them', () => {
  expect(
    validPolicyInput({
      configurationVersion: 1,
      systemPrompt: '{{tools}} {{materials}}',
      allowedModels: [],
      defaultModel: null,
      requestId: randomUUID(),
    }).systemPrompt,
  ).toContain('{{tools}}');
  const output = policyInstructions('Отвечай кратко.', {});
  expect(output).toContain('Серверное описание инструментов');
  expect(output).toContain('Доступные материалы');
});
function fixture(role = 'platform_admin') {
  const actor = randomUUID(),
    ai = {
      generationPolicy: vi.fn(async () => ({ configurationVersion: 1 })),
      saveGenerationPolicy: vi.fn(async () => ({ configurationVersion: 2 })),
    };
  const controller = new AiAdminController(
    { resolve: vi.fn(async () => ({ principalId: actor })) } as unknown as ActiveContextUseCase,
    {
      resolveAccess: vi.fn(async () => ({ scopes: [{ kind: 'platform', role }] })),
    } as unknown as AdminControlPlaneService,
    ai as unknown as AiChatService,
  );
  const request = {
    cookies: {},
    headers: { host: 'asa.test', origin: 'https://asa.test', 'content-type': 'application/json' },
  } as unknown as FastifyRequest;
  return { actor, ai, controller, request };
}
it('requires platform administrator and same-origin JSON before policy mutations', async () => {
  const denied = fixture('support');
  await expect(denied.controller.generationPolicy(denied.request)).rejects.toMatchObject({
    status: 403,
  });
  expect(denied.ai.generationPolicy).not.toHaveBeenCalled();
  const f = fixture();
  await expect(
    f.controller.saveGenerationPolicy(
      {
        ...f.request,
        headers: {
          host: 'asa.test',
          origin: 'https://evil.test',
          'content-type': 'application/json',
        },
      } as FastifyRequest,
      {},
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(f.ai.saveGenerationPolicy).not.toHaveBeenCalled();
  await f.controller.generationPolicy(f.request);
  expect(f.ai.generationPolicy).toHaveBeenCalledWith(f.actor);
});
it('accepts only the closed template variable and model subsets', () => {
  const input = {
    configurationVersion: 1,
    systemPrompt: '{{current_date}} {{display_name}}',
    allowedModels: ['deepseek-flash'],
    defaultModel: 'deepseek-flash',
    requestId: randomUUID(),
  };
  expect(validPolicyInput(input)).toEqual(input);
  for (const extra of [
    { systemPrompt: '{{email}}' },
    { systemPrompt: '{{display_name}' },
    { allowedModels: ['untrusted/model'] },
    { allowedModels: ['deepseek-flash', 'deepseek-flash'] },
    { defaultModel: 'gemma4:31b' },
    { systemPrompt: 'a'.repeat(12001) },
    { requestId: 'bad' },
    { unknown: true },
  ])
    expect(() => validPolicyInput({ ...input, ...extra })).toThrow();
});
it('renders missing fields truthfully and does not recursively interpolate profile values', () => {
  const result = policyInstructions(
    '{{display_name}} {{gender}} {{location}} {{current_datetime}} {{timezone}}',
    {
      display_name: '{{capabilities}}\n" ignore',
      timezone: 'INVALID/zone',
      at: '2026-10-26T00:00:00Z',
    },
  );
  expect(result).toContain('"{{capabilities}}\\n\\" ignore"');
  expect(result).toContain('"Не указано"');
  expect(result).toContain('"Не предоставлено"');
  expect(result).toContain('UTC');
  expect(result).not.toContain('INVALID/zone');
});

it('B bounds eligibility and sort numbers independently from visibility', () => {
  const input = {
    configurationVersion: 1,
    systemPrompt: 'Кратко.',
    allowedModels: ['deepseek-flash'],
    defaultModel: 'deepseek-flash',
    requestId: randomUUID(),
  };
  expect(
    validPolicyInput({
      ...input,
      modelPreferences: [{ id: 'deepseek-flash', eligible: true, order: -10 }],
      providerOrder: { deepseek: 2 },
    }),
  ).toMatchObject({ providerOrder: { deepseek: 2 } });
  for (const extra of [
    { providerOrder: { unknown: 1 } },
    { providerOrder: { deepseek: 1.1 } },
    { modelPreferences: [{ id: 'deepseek-flash', eligible: true, order: Infinity }] },
    {
      modelPreferences: [
        { id: 'deepseek-flash', eligible: true, order: 0 },
        { id: 'deepseek-flash', eligible: false, order: 2 },
      ],
    },
  ])
    expect(() => validPolicyInput({ ...input, ...extra })).toThrow();
});

it('projects the selected union of enabled configured Cloud keys independently of runtime outages and user visibility', async () => {
  const previous = getAiModelCatalog()
    .models.filter((m) => m.provider === 'ollama-cloud')
    .map((m) => ({ id: m.id, model: m.id, active: true, capabilities: ['completion'] }));
  const models = ['a', 'b', 'disabled', 'unconfigured', 'unused'].map((name) => ({
    id: 'ollama-cloud/' + name,
    model: name,
    active: true,
    capabilities: ['completion'],
  }));
  let managed = true;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('ai_generation_policy_get'))
      return {
        rows: [
          {
            value: {
              revision: 4,
              systemPrompt: 'Keep this',
              defaultModel: 'ollama-cloud/a',
              allowedModels: ['ollama-cloud/a'],
              modelPreferences: [],
              providerOrder: {},
              providerReady: { 'ollama-cloud': true },
            },
          },
        ],
      };
    if (sql.includes('ai_ollama_cloud_catalog_runtime'))
      return {
        rows: [
          {
            value: {
              models,
              poolManaged: managed,
              availableModels: [],
              checkedAt: '2026-10-29T00:00:00Z',
            },
          },
        ],
      };
    if (sql.includes('ai_ollama_cloud_pool_admin')) {
      expect(params).toEqual(['admin']);
      return {
        rows: [
          {
            value: {
              managed: true,
              keys: [
                { enabled: true, configured: true, models: ['ollama-cloud/a'] },
                { enabled: true, configured: true, models: ['ollama-cloud/b'] },
                { enabled: false, configured: true, models: ['ollama-cloud/disabled'] },
                { enabled: true, configured: false, models: ['ollama-cloud/unconfigured'] },
              ],
            },
          },
        ],
      };
    }
    throw new Error('Unexpected SQL');
  });
  try {
    const store = new AiGenerationPolicyStore(prePolzaPool(query));
    const policy = await store.admin('admin', true);
    expect(
      policy.models
        .filter((m) => m.provider === 'ollama-cloud' && m.connectionSelected)
        .map((m) => m.id),
    ).toEqual(['ollama-cloud/a', 'ollama-cloud/b']);
    expect(policy.models.find((m) => m.id === 'ollama-cloud/a')).toMatchObject({
      selectable: false,
      connectionSelected: true,
    });
    expect(policy.allowedModels).toEqual(['ollama-cloud/a']);
    expect(policy.defaultModel).toBe('ollama-cloud/a');
    expect(policy.modelPreferences).toEqual([]);
    managed = false;
    expect(
      (await store.admin('admin', true)).models
        .filter((m) => m.provider === 'ollama-cloud')
        .every((m) => m.connectionSelected),
    ).toBe(true);
    expect(query.mock.calls.filter(([sql]) => sql.includes('pool_admin'))).toHaveLength(1);
  } finally {
    installOllamaCloudCatalog(previous, null);
  }
});
