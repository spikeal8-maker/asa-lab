import { describe, expect, it } from 'vitest';
import { toolUnavailableReason } from './ai-tool-readiness';
const ready = {
  policyReady: true,
  nativeReady: true,
  fileReady: true,
  readFilesEnabled: true,
  imageEnabled: true,
  imageReady: true,
  imageSchemaReady: true,
  internet: {
    enabled: true,
    configured: true,
    weatherEnabled: true,
    weatherConfigured: true,
    pageReadConfigured: true,
  },
};
describe('specific administrator tool readiness', () => {
  it('keeps weather and page reading independent of a missing search backend', () => {
    const state = { ...ready, internet: { ...ready.internet, configured: false } };
    expect(toolUnavailableReason('web_search', state)).toContain('SearXNG');
    expect(toolUnavailableReason('image_search', state)).toContain('SearXNG');
    expect(toolUnavailableReason('weather', state)).toBeNull();
    expect(toolUnavailableReason('read_page', state)).toBeNull();
  });
  it('distinguishes global disable, weather disable and absent city lookup', () => {
    expect(
      toolUnavailableReason('weather', {
        ...ready,
        internet: { ...ready.internet, enabled: false },
      }),
    ).toContain('Интернет-инструменты выключены');
    expect(
      toolUnavailableReason('weather', {
        ...ready,
        internet: { ...ready.internet, weatherEnabled: false, weatherConfigured: false },
      }),
    ).toContain('Прогноз погоды выключен');
    expect(
      toolUnavailableReason('weather', {
        ...ready,
        internet: { ...ready.internet, weatherConfigured: false },
      }),
    ).toContain('определения города');
  });
  it('explains disabled page reading without blaming the search provider', () => {
    expect(
      toolUnavailableReason('read_page', {
        ...ready,
        internet: { ...ready.internet, pageReadConfigured: false },
      }),
    ).toContain('0 страниц');
  });
  it('distinguishes disabled generation, failed connection and missing schema', () => {
    expect(toolUnavailableReason('generate_image', { ...ready, imageEnabled: false })).toContain(
      'Генерация выключена',
    );
    expect(
      toolUnavailableReason('generate_image', {
        ...ready,
        imageReady: false,
        imageReason: 'Сервер ComfyUI не отвечает.',
      }),
    ).toBe('Сервер ComfyUI не отвечает.');
    expect(
      toolUnavailableReason('generate_image', { ...ready, imageSchemaReady: false }),
    ).toContain('В базе');
  });
  it('keeps local capability failure and file read dependency explicit', () => {
    expect(
      toolUnavailableReason('weather', {
        ...ready,
        nativeReady: false,
        nativeReason: 'Ollama не отвечает.',
      }),
    ).toBe('Ollama не отвечает.');
    expect(
      toolUnavailableReason('edit_working_file', { ...ready, readFilesEnabled: false }),
    ).toContain('чтения рабочих файлов');
    expect(toolUnavailableReason('create_working_file', { ...ready, fileReady: false })).toContain(
      'В базе',
    );
  });
});
