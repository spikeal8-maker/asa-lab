import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { expect, it, vi } from 'vitest';
import { AiAdminController } from './ai-admin.controller';
import type { AiChatService } from './ai-chat.service';
import type { AdminControlPlaneService } from './admin-control-plane.service';
import {
  AI_DEFAULT_SYSTEM_PROMPT,
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
