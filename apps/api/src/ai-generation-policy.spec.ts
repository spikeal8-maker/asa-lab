import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { expect, it, vi } from 'vitest';
import { AiAdminController } from './ai-admin.controller';
import type { AiChatService } from './ai-chat.service';
import type { AdminControlPlaneService } from './admin-control-plane.service';
import { policyInstructions, validPolicyInput } from './ai-generation-policy';
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
