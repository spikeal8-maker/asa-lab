import { describe, expect, it } from 'vitest';
import { createApiModuleRegistry } from './module-registry';

describe('ASA 3D Project Core integration', () => {
  it('registers a creatable first-party provider with a valid empty draft', () => {
    const entry = createApiModuleRegistry().getCreatable('three-d');
    expect(entry?.manifest).toMatchObject({
      moduleKey: 'three-d',
      schemaVersion: 1,
      availability: 'active',
    });
    const document = entry?.provider?.createEmptyProject();
    expect(entry?.provider?.validate(document).ok).toBe(true);
    expect(entry?.provider?.createPreview(document)).toMatchObject({
      kind: 'scene',
      summary: '0 объектов · mm',
    });
  });

  it('refuses malformed drafts before they reach persistence', () => {
    const provider = createApiModuleRegistry().getCreatable('three-d')?.provider;
    expect(provider?.validate({ schemaVersion: 1, units: 'cm', nodes: [] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'three_d_document_invalid', severity: 'error' }],
    });
  });
});
