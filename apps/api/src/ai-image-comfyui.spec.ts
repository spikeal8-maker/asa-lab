import { AI_IMAGE_PRESETS, type AiImageStoredSize } from '@asa-lab/contracts';
import { describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { ComfyImageTransport, imageWorkflowDigest } from './ai-image-comfyui.js';

const id = '12345678-1234-4234-8234-123456789012';
const marker = 'ASA_' + id.replaceAll('-', '');
const receiptDigest = imageWorkflowDigest('A blue tree', 512, 42, marker);
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(type, 4);
  data.copy(out, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
function png(size = 512, height = size): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('tEXt', Buffer.from('prompt\0private')),
    chunk('IDAT', deflateSync(Buffer.alloc((size * 3 + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function fixture(
  options: {
    size?: AiImageStoredSize;
    filename?: string;
    image?: Buffer;
    mutate?: (entry: Record<string, unknown>) => void;
  } = {},
) {
  let tuple: unknown[] = [];
  const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/prompt')) {
      const body = JSON.parse(String(init?.body));
      tuple = [0, id, body.prompt, body.extra_data, ['12']];
      return json({ prompt_id: id, node_errors: {} });
    }
    if (path.includes('/history/')) {
      const entry: Record<string, unknown> = {
        prompt: tuple,
        status: { completed: true, status_str: 'success' },
        outputs: {
          '12': {
            images: [
              {
                filename: options.filename ?? marker + '_00001_.png',
                subfolder: '',
                type: 'output',
              },
            ],
          },
        },
      };
      options.mutate?.(entry);
      return json({ [id]: entry });
    }
    if (path.includes('/view?')) return new Response(new Uint8Array(options.image ?? png()));
    return json({ queue_running: [], queue_pending: [] });
  });
  const transport = new ComfyImageTransport({ fetchImpl: mock as typeof fetch });
  await transport.dispatch(id, 'A blue tree', options.size ?? 512, 42, marker);
  return { transport, mock, tuple };
}
describe('fixed native Comfy image transport', () => {
  it('submits the native four-step recipe once with caller UUID, seed and opaque prefix', async () => {
    const { mock } = await fixture();
    expect(mock).toHaveBeenCalledTimes(1);
    const init = mock.mock.calls[0][1];
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    const body = JSON.parse(String(init?.body));
    expect(body.prompt_id).toBe(id);
    expect(body.prompt['1'].inputs.unet_name).toBe('flux-2-klein-4b-fp8.safetensors');
    expect(body.prompt['7'].inputs.noise_seed).toBe(42);
    expect(body.prompt['8'].inputs).toEqual({ steps: 4, width: 512, height: 512 });
    expect(body.prompt['12'].inputs.filename_prefix).toBe(marker);
  });
  it.each(['disconnect', 'mismatch', 'malformed'])(
    'keeps %s dispatch uncertain and never retries',
    async (kind) => {
      const mock = vi.fn(async () => {
        if (kind === 'disconnect') throw new Error('secret');
        return json(kind === 'malformed' ? null : { prompt_id: 'foreign' });
      });
      const transport = new ComfyImageTransport({ fetchImpl: mock });
      await expect(transport.dispatch(id, 'tree', 512, 0, marker)).rejects.toMatchObject({
        uncertain: true,
        code: 'ai_image_dispatch_unknown',
      });
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );
  it('recovers only owned node 12, validates square PNG and strips prompt metadata', async () => {
    const { transport, mock } = await fixture();
    const result = await transport.recover(id, marker, 512, receiptDigest);
    expect(result.state).toBe('complete');
    expect(result.png?.includes(Buffer.from('private'))).toBe(false);
    expect(mock.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });
  it.each(['../bad.png', marker + '_00001_.png?x=1', 'foreign_00001_.png', marker + '\\bad.png'])(
    'rejects unsafe output path %s before image fetch',
    async (filename) => {
      const { transport, mock } = await fixture({ filename });
      await expect(transport.recover(id, marker, 512, receiptDigest)).rejects.toBeDefined();
      expect(mock).toHaveBeenCalledTimes(2);
    },
  );
  it.each([Buffer.from('not png'), png(768), Buffer.alloc(8 * 1024 * 1024 + 1)])(
    'rejects invalid, wrong dimensions or oversize bytes',
    async (image) => {
      const { transport } = await fixture({ image });
      await expect(transport.recover(id, marker, 512, receiptDigest)).rejects.toMatchObject({
        code: 'ai_image_output_invalid',
      });
    },
  );
  it('rejects another graph even with copied marker and digest', async () => {
    const { transport } = await fixture({
      mutate: (entry) => {
        const tuple = entry.prompt as unknown[];
        const workflow = tuple[2] as Record<string, unknown>;
        workflow['13'] = { class_type: 'Danger' };
      },
    });
    await expect(transport.recover(id, marker, 512, receiptDigest)).rejects.toBeDefined();
  });
  it.each(['prompt', 'seed'])(
    'rejects a self-consistent provider-forged %s against the immutable receipt',
    async (kind) => {
      const { transport, mock } = await fixture({
        mutate: (entry) => {
          const tuple = entry.prompt as unknown[];
          const workflow = tuple[2] as Record<string, { inputs: Record<string, unknown> }>;
          const prompt = kind === 'prompt' ? 'Forged provider prompt' : 'A blue tree';
          const seed = kind === 'seed' ? 43 : 42;
          workflow['4'].inputs.text = prompt;
          workflow['7'].inputs.noise_seed = seed;
          (tuple[3] as { asa_image: { digest: string } }).asa_image.digest = imageWorkflowDigest(
            prompt,
            512,
            seed,
            marker,
          );
        },
      });
      await expect(transport.recover(id, marker, 512, receiptDigest)).rejects.toBeDefined();
      expect(mock).toHaveBeenCalledTimes(2);
    },
  );
  it('missing history uses GET queue only and never resubmits', async () => {
    const mock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      expect(args[1]?.method).toBe('GET');
      return json({ queue_running: [], queue_pending: [] });
    });
    const transport = new ComfyImageTransport({ fetchImpl: mock });
    expect(await transport.recover(id, marker, 512, receiptDigest)).toEqual({ state: 'missing' });
    expect(mock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it('does not cancel a missing or running job', async () => {
    const { transport, mock } = await fixture();
    expect(await transport.cancelPending(id, marker, 512, receiptDigest)).toBe(false);
    expect(mock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('recovers running and pending entries without any provider mutation', async () => {
    const { tuple } = await fixture();
    for (const state of ['running', 'pending'] as const) {
      const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe('GET');
        return json(
          String(url).includes('/history/')
            ? {}
            : {
                queue_running: state === 'running' ? [tuple] : [],
                queue_pending: state === 'pending' ? [tuple] : [],
              },
        );
      });
      const transport = new ComfyImageTransport({ fetchImpl: mock });
      expect(await transport.recover(id, marker, 512, receiptDigest)).toEqual({ state });
      expect(mock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
      if (state === 'running')
        expect(await transport.cancelPending(id, marker, 512, receiptDigest)).toBe(false);
    }
  });
  it('deletes only a verified owned pending ID and confirms its absence', async () => {
    const { tuple } = await fixture();
    let deleted = false;
    const mock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ delete: [id] });
        deleted = true;
        return json({});
      }
      return json({ queue_running: [], queue_pending: deleted ? [] : [tuple] });
    });
    expect(
      await new ComfyImageTransport({ fetchImpl: mock }).cancelPending(
        id,
        marker,
        512,
        receiptDigest,
      ),
    ).toBe(true);
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it.each(['marker', 'uuid', 'node'])(
    'rejects foreign %s history before reading bytes',
    async (kind) => {
      const { transport, mock } = await fixture({
        mutate: (entry) => {
          const tuple = entry.prompt as unknown[];
          if (kind === 'uuid') tuple[1] = 'foreign';
          else if (kind === 'marker')
            (tuple[3] as { asa_image: { marker: string } }).asa_image.marker = 'foreign';
          else entry.outputs = { '13': { images: [] } };
        },
      });
      await expect(transport.recover(id, marker, 512, receiptDigest)).rejects.toBeDefined();
      expect(mock).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects redirected output even if a fetch implementation returns it', async () => {
    const response = new Response(new Uint8Array(png()));
    Object.defineProperty(response, 'redirected', { value: true });
    const { tuple } = await fixture();
    const mock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/view?')
        ? response
        : json({
            [id]: {
              prompt: tuple,
              status: { completed: true, status_str: 'success' },
              outputs: {
                '12': {
                  images: [{ filename: marker + '_00001_.png', subfolder: '', type: 'output' }],
                },
              },
            },
          }),
    );
    await expect(
      new ComfyImageTransport({ fetchImpl: mock }).recover(id, marker, 512, receiptDigest),
    ).rejects.toMatchObject({ code: 'ai_image_output_invalid' });
  });
  it('denies public origins and unsupported readiness', async () => {
    expect(() => new ComfyImageTransport({ baseUrl: 'http://example.org:8188' })).toThrow();
    const transport = new ComfyImageTransport({
      fetchImpl: vi.fn(async () => json({ system: { comfyui_version: '0.42.0' } })),
    });
    expect(await transport.readiness()).toEqual({
      ready: false,
      reason: 'ai_image_provider_not_ready',
    });
  });
  it('advertises readiness only for the exact available native model and compatible inputs', async () => {
    const { tuple } = await fixture();
    const workflow = tuple[2] as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    const outputs: Record<string, string> = {
      '1': 'MODEL',
      '2': 'CLIP',
      '3': 'VAE',
      '4': 'CONDITIONING',
      '5': 'GUIDER',
      '6': 'LATENT',
      '7': 'NOISE',
      '8': 'SIGMAS',
      '9': 'SAMPLER',
      '10': 'LATENT',
      '11': 'IMAGE',
    };
    let missingModel = false;
    const mock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/system_stats'))
        return json({ system: { comfyui_version: '0.42.1' } });
      const type = String(url).split('/').at(-1);
      const node = Object.values(workflow).find((node) => node.class_type === type)!;
      const fields = Object.fromEntries(
        Object.entries(node.inputs).map(([key, value]) => [
          key,
          [
            Array.isArray(value)
              ? outputs[String(value[0])]
              : typeof value === 'number'
                ? 'INT'
                : key === 'unet_name'
                  ? [missingModel ? 'foreign.safetensors' : value]
                  : 'STRING',
          ],
        ]),
      );
      if (node.class_type === 'KSamplerSelect')
        fields['sampler_name'] = ['COMBO', { multiselect: false, options: ['euler'] }];
      return json({ [node.class_type]: { input: { required: fields } } });
    });
    const transport = new ComfyImageTransport({ fetchImpl: mock });
    expect(await transport.readiness()).toEqual({ ready: true, reason: null });
    missingModel = true;
    expect(await transport.readiness()).toEqual({
      ready: false,
      reason: 'ai_image_provider_not_ready',
    });
  });
});

it.each(AI_IMAGE_PRESETS)(
  'dispatches and recovers the exact $width × $height preset',
  async (preset) => {
    const { transport, mock } = await fixture({
      size: preset.id,
      image: png(preset.width, preset.height),
    });
    const submitted = JSON.parse(String(mock.mock.calls[0]?.[1]?.body));
    expect(submitted.prompt['6'].inputs).toMatchObject({
      width: preset.width,
      height: preset.height,
      batch_size: 1,
    });
    expect(submitted.prompt['8'].inputs).toEqual({
      steps: 4,
      width: preset.width,
      height: preset.height,
    });
    const result = await transport.recover(
      id,
      marker,
      preset.id,
      imageWorkflowDigest('A blue tree', preset.id, 42, marker),
    );
    expect(result.state).toBe('complete');
  },
);
it('rejects swapped portrait dimensions even for an otherwise owned PNG', async () => {
  const { transport } = await fixture({ size: 864, image: png(1536, 864) });
  await expect(
    transport.recover(id, marker, 864, imageWorkflowDigest('A blue tree', 864, 42, marker)),
  ).rejects.toMatchObject({ code: 'ai_image_output_invalid' });
});

// Golden digests computed from the integrated pre-preset 4cf9369a graph.
it.each([
  [512, '362252dc2ff7f99d7d341d1b72b0cdb92d7c546638fd34b3a8cb7e15ee98a0f8'],
  [768, '1b6c249fa107d0852bbe4f67a3a60068f6716e8b6ddad57deee48aebfe3ff83c'],
  [1024, '1dbc80bf14665e2254acd607028f2012edc84230accd24b9f8bea33e68d423f5'],
] as const)('preserves the immutable legacy %i workflow receipt', async (size, expected) => {
  expect(imageWorkflowDigest('A blue tree', size, 42, marker)).toBe(expected);
  const { transport } = await fixture({ size, image: png(size) });
  expect((await transport.recover(id, marker, size, expected)).state).toBe('complete');
});
