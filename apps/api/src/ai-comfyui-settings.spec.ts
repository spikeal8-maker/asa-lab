import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ComfyUiSettings } from './ai-comfyui-settings';
import { ComfyImageTransport } from './ai-image-comfyui';

vi.mock('./ai-comfyui', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai-comfyui')>();
  return {
    ...original,
    discoverComfyUi: vi.fn(async (baseUrl: string) => ({
      connected: true as const,
      baseUrl,
      version: '0.19.3',
      diffusionModels: ['flux-2-klein-4b-fp8.safetensors'],
      textEncoders: ['qwen_3_4b.safetensors'],
      vaeModels: ['flux2-vae.safetensors'],
      fluxKlein4bFound: true,
      checkedAt: '2026-10-29T12:00:00Z',
      devices: [],
    })),
  };
});

function poolWithRecipe(recipe: string) {
  const queries: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('ai_comfyui_config('))
        return {
          rows: [{ value: { configurationVersion: 4, baseUrl: 'http://192.168.1.112:8188' } }],
        };
      if (sql.includes('ai_image_config()')) return { rows: [{ value: { recipe } }] };
      throw new Error('Unexpected query: ' + sql);
    }),
  };
  return { pool: pool as unknown as pg.Pool, queries };
}

describe('ComfyUI admin diagnostics use the saved recipe, never a hardcoded FP4 profile', () => {
  it('reports the actual chosen FP8 model on the production RTX 3060 endpoint', async () => {
    const { pool, queries } = poolWithRecipe('flux2-klein-4b-fp8-izo-v1');
    const readiness = vi.spyOn(ComfyImageTransport.prototype, 'readiness').mockResolvedValueOnce({
      ready: true,
      reason: null,
    });
    try {
      const result = await new ComfyUiSettings(pool).status('admin-principal');
      expect(queries).toEqual([
        expect.stringContaining('ai_comfyui_config('),
        expect.stringContaining('ai_comfyui_config('),
        expect.stringContaining('ai_image_config()'),
      ]);
      expect(readiness).toHaveBeenCalledOnce();
      expect(readiness).toHaveBeenCalledWith('flux2-klein-4b-fp8-izo-v1');
      expect(result).toMatchObject({
        connected: true,
        baseUrl: 'http://192.168.1.112:8188',
        recipe: 'flux2-klein-4b-fp8-izo-v1',
        recipeReady: true,
        recipeReason: null,
      });
    } finally {
      readiness.mockRestore();
    }
  });

  it('keeps the legacy FP4 mismatch visible without changing the selected recipe', async () => {
    const { pool } = poolWithRecipe('flux2-klein-4b-v1');
    const readiness = vi.spyOn(ComfyImageTransport.prototype, 'readiness').mockResolvedValueOnce({
      ready: false,
      reason: 'Нет точного файла модели: qwen_3_4b_fp4_flux2.safetensors',
    });
    try {
      const result = await new ComfyUiSettings(pool).probe(
        'admin-principal',
        'http://192.168.1.112:8188',
      );
      expect(readiness).toHaveBeenCalledWith('flux2-klein-4b-v1');
      expect(result).toMatchObject({ recipeReady: false, recipe: 'flux2-klein-4b-v1' });
      expect(result.recipeReason).toContain('qwen_3_4b_fp4_flux2.safetensors');
    } finally {
      readiness.mockRestore();
    }
  });

  it('refuses an unknown recipe before calling any provider readiness endpoint', async () => {
    const { pool } = poolWithRecipe('unknown-profile');
    const readiness = vi.spyOn(ComfyImageTransport.prototype, 'readiness');
    try {
      await expect(
        new ComfyUiSettings(pool).probe('admin-principal', 'http://192.168.1.112:8188'),
      ).rejects.toMatchObject({ code: 'ai_comfy_recipe_unknown', status: 503 });
      expect(readiness).not.toHaveBeenCalled();
    } finally {
      readiness.mockRestore();
    }
  });
});
