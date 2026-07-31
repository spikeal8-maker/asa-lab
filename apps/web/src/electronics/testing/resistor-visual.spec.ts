import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resistorBandState } from '../production-asset-contracts';

const BODY = readFileSync(
  new URL('../../../public/assets/electronics/production/components/resistor-axial-body.svg', import.meta.url),
  'utf8',
);
const PREVIEW = readFileSync(
  new URL(
    '../../../public/assets/electronics/production/components/resistor-axial-preview.svg',
    import.meta.url,
  ),
  'utf8',
);

describe('parametric axial resistor visual', () => {
  it('keeps production artwork transparent and purely vector', () => {
    for (const source of [BODY, PREVIEW]) {
      expect(source).not.toContain('<image');
      expect(source).not.toContain('data:image');
      expect(source).not.toContain('<foreignObject');
      expect(source).not.toMatch(/<rect[^>]+width="62"[^>]+height="258"/);
    }
  });

  it('exposes four stable band zones and physical lead anchors', () => {
    for (const id of ['band-zone-1', 'band-zone-2', 'band-zone-3', 'band-zone-4']) {
      expect(BODY).toContain(`id="${id}"`);
    }
    expect(BODY).toContain('data-pin-id="lead-1"');
    expect(BODY).toContain('data-pin-id="lead-2"');
  });

  it('shows the default 300 ohm preview and derives other values from state', () => {
    expect(PREVIEW).toContain('data-preview-resistance-ohms="300"');
    expect(PREVIEW).toContain('fill="#f28c18"');
    expect(PREVIEW).toContain('fill="#111111"');
    expect(PREVIEW).toContain('fill="#8b4513"');
    expect(PREVIEW).toContain('fill="#c8a43b"');

    expect(resistorBandState(220, 5).bands).toEqual(['red', 'red', 'brown', 'gold']);
    expect(resistorBandState(4_700, 5).bands).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(resistorBandState(10_000, 1).bands).toEqual(['brown', 'black', 'orange', 'brown']);
  });
});
