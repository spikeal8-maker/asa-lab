import { describe, it, expect } from 'vitest';
import { parseElectronicsDocument } from '../../contexts/electronics/domain/document';
import { validateBlocksDocument } from '../../contexts/blocks/domain/validation';
import { edit, CAPACITY_PNG } from './documents';
import { crc32, inflateSync } from 'node:zlib';
import { inspectBlocksDocument } from '../../apps/api/src/blocks-durable-document';

describe('capacity inputs match actual product validators before a costly workload', () => {
  it('has intact PNG chunk CRCs and a decodable one-pixel scanline', () => {
    expect(CAPACITY_PNG.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const image: Buffer[] = [];
    let offset = 8;
    while (offset < CAPACITY_PNG.length) {
      const length = CAPACITY_PNG.readUInt32BE(offset);
      const end = offset + 8 + length;
      expect(end + 4).toBeLessThanOrEqual(CAPACITY_PNG.length);
      expect(crc32(CAPACITY_PNG.subarray(offset + 4, end))).toBe(CAPACITY_PNG.readUInt32BE(end));
      if (CAPACITY_PNG.toString('ascii', offset + 4, offset + 8) === 'IDAT')
        image.push(CAPACITY_PNG.subarray(offset + 8, end));
      offset = end + 4;
    }
    expect(offset).toBe(CAPACITY_PNG.length);
    expect(CAPACITY_PNG.readUInt32BE(16)).toBe(1);
    expect(CAPACITY_PNG.readUInt32BE(20)).toBe(1);
    expect([...inflateSync(Buffer.concat(image))]).toEqual([1, 255, 255]);
  });
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
  it('survives the full Scratch durable-save parser without repairs', async () => {
    for (const wave of [1, 2])
      await expect(inspectBlocksDocument(edit('blocks', wave))).resolves.toEqual(
        edit('blocks', wave),
      );
  });
});
