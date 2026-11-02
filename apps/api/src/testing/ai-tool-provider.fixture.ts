import { createCipheriv } from 'node:crypto';

export const TOOL_PROVIDERS = ['ollama', 'openai', 'deepseek', 'ollama-cloud'] as const;
export type ToolProvider = (typeof TOOL_PROVIDERS)[number];
export const TOOL_TEST_ROOT = '9c'.repeat(32);
export function toolProviderRuntime(provider: ToolProvider) {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(TOOL_TEST_ROOT, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update('test-only-tool-credential'), cipher.final()]);
  return {
    enabled: provider !== 'ollama',
    configuration_version: 1,
    provider: provider === 'ollama' ? 'openai' : provider,
    model:
      provider === 'deepseek'
        ? 'deepseek-flash'
        : provider === 'ollama-cloud'
          ? 'gemma4:31b'
          : 'gpt-6-luna',
    api_key_ciphertext: encrypted.toString('base64url'),
    api_key_iv: iv.toString('base64url'),
    api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
  };
}
export function toolProviderResponse(
  provider: ToolProvider,
  packet: {
    message: {
      content?: string;
      tool_calls?: readonly { function: { name: string; arguments: unknown } }[];
    };
    prompt_eval_count: number;
    eval_count: number;
  },
): Response {
  if (provider === 'ollama') return new Response(JSON.stringify(packet) + '\n');
  const event = (data: unknown) => 'data: ' + JSON.stringify(data) + '\n\n';
  const call = packet.message.tool_calls?.[0]?.function;
  const body =
    provider === 'openai'
      ? (call
          ? event({
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                type: 'function_call',
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })
          : event({ type: 'response.output_text.delta', delta: packet.message.content })) +
        event({
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: packet.prompt_eval_count,
              output_tokens: packet.eval_count,
            },
          },
        })
      : event({
          choices: [
            {
              delta: call
                ? {
                    tool_calls: [
                      {
                        index: 0,
                        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                      },
                    ],
                  }
                : { content: packet.message.content },
              finish_reason: call ? 'tool_calls' : 'stop',
            },
          ],
          usage: {
            prompt_tokens: packet.prompt_eval_count,
            completion_tokens: packet.eval_count,
          },
        }) + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}
export const isToolModelUrl = (url: string) =>
  /\/(api\/chat|chat\/completions|responses)$/.test(url);
