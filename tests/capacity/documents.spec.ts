import { describe, it, expect } from 'vitest';
import { parseElectronicsDocument } from '../../contexts/electronics/domain/document';
import { validateBlocksDocument } from '../../contexts/blocks/domain/validation';
import { edit } from './documents';

describe('capacity inputs match actual product validators before a costly workload', () => {
  it('uses canonical Electronics connections and preserves both actual edits', () => {
    for (const wave of [1, 2]) {
      const document = edit('electronics', wave);
      const parsed = parseElectronicsDocument(document);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.document).toEqual(document);
      expect(document).toHaveProperty('connections');
      expect(document).not.toHaveProperty('wires');
    }
    expect(edit('electronics', 1)).not.toEqual(edit('electronics', 2));
  });
  it('uses a valid small Scratch document and changes its saved variable', () => {
    for (const wave of [1, 2]) expect(validateBlocksDocument(edit('blocks', wave)).ok).toBe(true);
    expect(edit('blocks', 1)).not.toEqual(edit('blocks', 2));
  });
});
