import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { AiToolPolicyController } from './ai-tool-policy.controller';
import type { AdminControlPlaneService } from './admin-control-plane.service';
import type { AiChatService } from './ai-chat.service';
import { TOOL_IDS, validateToolPolicyUpdate } from './ai-tool-policy';

const requestId = '11111111-1111-4111-8111-111111111111';
const tools = TOOL_IDS.map((id) => ({ id, enabled: true, instructions: '' }));
const valid = { schemaVersion: 1, expectedConfigurationVersion: 1, requestId, tools };

describe('closed tool policy update', () => {
  it('accepts exactly four unique tool rules and a bounded instruction', () => {
    expect(validateToolPolicyUpdate(valid)).toMatchObject(valid);
    expect(
      validateToolPolicyUpdate({
        ...valid,
        tools: tools.map((item) =>
          item.id === 'weather' ? { ...item, instructions: 'Укажи дату прогноза.' } : item,
        ),
      }).tools[0]?.instructions,
    ).toBe('Укажи дату прогноза.');
  });
  it.each([
    { ...valid, tools: tools.slice(1) },
    { ...valid, tools: [tools[0], tools[0], tools[2], tools[3]] },
    { ...valid, extra: true },
    { ...valid, tools: tools.map((item) => ({ ...item, hardLimits: [] })) },
    { ...valid, tools: tools.map((item) => ({ ...item, instructions: 'x'.repeat(3001) })) },
    { ...valid, requestId: 'bad' },
    { ...valid, expectedConfigurationVersion: 0 },
  ])('rejects malformed body before SQL', (bad) => {
    expect(() => validateToolPolicyUpdate(bad)).toThrow();
  });
});

describe('tool policy administration boundary', () => {
  const request = (origin = 'https://asa.example') =>
    ({
      cookies: {},
      headers: { origin, host: 'asa.example', 'content-type': 'application/json' },
    }) as unknown as FastifyRequest;
  it('requires a platform administrator and same-origin JSON before writes', async () => {
    const active = { resolve: vi.fn(async () => ({ principalId: requestId })) };
    const control = {
      resolveAccess: vi.fn(async () => ({
        scopes: [{ kind: 'platform', role: 'platform_admin' }],
      })),
    };
    const ai = {
      toolPolicyAdmin: vi.fn(async () => ({
        schemaVersion: 1,
        configurationVersion: 1,
        tools: [],
      })),
      saveToolPolicy: vi.fn(async () => ({ schemaVersion: 1, configurationVersion: 2, tools: [] })),
    };
    const controller = new AiToolPolicyController(
      active as unknown as ActiveContextUseCase,
      control as unknown as AdminControlPlaneService,
      ai as unknown as AiChatService,
    );
    expect(await controller.get(request())).toMatchObject({ schemaVersion: 1 });
    await expect(controller.put(request('https://evil.example'), valid)).rejects.toMatchObject({
      status: 403,
    });
    expect(ai.saveToolPolicy).not.toHaveBeenCalled();
    control.resolveAccess.mockResolvedValueOnce({ scopes: [] });
    await expect(controller.put(request(), valid)).rejects.toMatchObject({ status: 403 });
    expect(ai.saveToolPolicy).not.toHaveBeenCalled();
    expect(await controller.put(request(), valid)).toMatchObject({ configurationVersion: 2 });
    expect(ai.saveToolPolicy).toHaveBeenCalledWith(requestId, valid);
  });
});
