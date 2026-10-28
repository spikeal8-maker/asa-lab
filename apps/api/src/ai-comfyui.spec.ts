import { describe, expect, it, vi } from 'vitest';
import { ComfyUiError, discoverComfyUi } from './ai-comfyui';

const data: Record<string, unknown> = {
  '/system_stats': { system: { comfyui_version: '0.42.1' } },
  '/models/diffusion_models': ['flux-2-klein-4b-fp8.safetensors'],
  '/models/text_encoders': ['qwen_3_4b_fp4_flux2.safetensors'],
  '/models/vae': ['flux2-vae.safetensors'],
};

describe('ComfyUI private read-only detection', () => {
  it('discovers FLUX.2 Klein 4B packages without running a workflow', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      const path = new URL(String(url)).pathname;
      return new Response(JSON.stringify(data[path]), { status: 200 });
    });
    const found = await discoverComfyUi('http://host.docker.internal:8188', fetchImpl);
    expect(found.connected).toBe(true);
    expect(found.version).toBe('0.42.1');
    expect(found.fluxKlein4bFound).toBe(true);
    expect(found.diffusionModels).toEqual(['flux-2-klein-4b-fp8.safetensors']);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(
      fetchImpl.mock.calls.every(
        ([url]) => new URL(String(url)).origin === 'http://host.docker.internal:8188',
      ),
    ).toBe(true);
  });

  it('rejects browser/internet destinations before network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(discoverComfyUi('https://example.com', fetchImpl)).rejects.toMatchObject({
      code: 'ai_comfy_url_invalid',
    } satisfies Partial<ComfyUiError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not claim a complete model when the encoder is absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      return new Response(JSON.stringify(path === '/models/text_encoders' ? [] : data[path]), {
        status: 200,
      });
    });
    expect((await discoverComfyUi('http://127.0.0.1:8188', fetchImpl)).fluxKlein4bFound).toBe(
      false,
    );
  });
  it('detects a remote private GPU without following redirects or running a graph', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (url) => new Response(JSON.stringify(data[new URL(String(url)).pathname])),
    );
    const result = await discoverComfyUi('http://192.168.10.20:8188', fetchImpl);
    expect(result.baseUrl).toBe('http://192.168.10.20:8188');
    expect(fetchImpl.mock.calls).toHaveLength(4);
  });
  it('does not accept a redirected success or a JSON service without ComfyUI identity', async () => {
    const redirected = () => {
      const response = new Response('{}');
      Object.defineProperty(response, 'redirected', { value: true });
      return response;
    };
    await expect(
      discoverComfyUi(
        'http://192.168.1.20:8188',
        vi.fn(async () => redirected()),
      ),
    ).rejects.toBeInstanceOf(ComfyUiError);
    await expect(
      discoverComfyUi(
        'http://192.168.1.20:8188',
        vi.fn(async () => new Response('[]')),
      ),
    ).rejects.toMatchObject({ code: 'ai_comfy_invalid' });
  });
});
