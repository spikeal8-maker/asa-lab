import { createHash } from 'node:crypto';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  decodeQrRaster,
  normalizePrintQrRaster,
  type QrRaster,
} from '../../e2e/fixtures/qr-print-raster';

// Frozen DOM/CSS/SVG replay of Classroom run 39154885479 / job 117755945105,
// source 662c8af4fbffead0f71b2fb95a4e9768d0c4b9fb, artifact 12146839286 SHA256
// 205457c8e4e5ccd34fe462818d1998716fee906c19e93ab47ecaab1e60bd5991.
// Playwright 1.55.1 / Chromium 140.0.7339.186, print 16mm, DPR1: original 62x61 PNG.
// The ephemeral synthetic class URL is an expected value, never decoder input.
const failingPrintPng = Buffer.from(
  [
    'iVBORw0KGgoAAAANSUhEUgAAAD4AAAA9CAIAAAB6N029AAACZklEQVR4nOxZ7Y7EIAikyb3/K/c218Qj',
    'zjBQ200/+bWLolRwGPVnnme7pvzYZeV1/Qh5XT9CuOvTNAmbBZSwz0fflA24vCZq9U160tx12rVzBXt2',
    'TfpvfdLI8L657r8Yl0TE/fNDxA0zh85ocfBty6o3R+c/8TMt+tZq35FHgiOmRNN0iBHtMx83Wy+J62JQ',
    'P7FPcbSKEpruh/pn3DFhUhhuaxb9wFB0MUFNBfv/HdiOAFgv07Jqe8gdOUwliBHC+ISh5mlwkNVUOQwO',
    'ih/TlSHfZAHroh+QNkUJduGEmSKyFjFbY6S30ywrHUVJDC5CVE0YA0AQCUCBxY+DFSpizsU9lrh+fsm3',
    'aacRbLbr32lo5fKtdASx9lVwFCUQp/HmOp28ubGP+QpfP1xChEEl7iTs75c/AiI6Xb1z4no0gbEEoEXR',
    'GCa2PpUUikhb4jouA03HiDma3C1U0rKP8gBwjA5vnRUqKexgK847SL+MFVEckZItMZSo0GLe6XFXSHPh',
    '2CsWzwJujN1SxoKS0K/hWqgN9RnFAtSqun5+STgMLW8RTtMOgpRXCvk4hxEE0CS0VUZAwJ3j640V4Hh+',
    'qV5S6/XoqPwC4ZQdWHaFVMechDnOay6oEDeG3bLC1rodXy9ZyncLVAq2TKmyJhe25QVPGM7uMkMUl8px',
    'bhwczyybHh+n7HwddWud06yw4W1Kq6l2VLhFP0mMYM/iMGMS0Vo8YaSwVtnBO7ybGjtfW8zsVzGWae3t',
    '1yVk/PFxrSGNUmvt4lBhCvu84HmHDNhv5Cj+rWyD3PXzyw6Pj0fJi+tHyOv6EXJh138BAAD//51IYhsA',
    'AAAGSURBVAMAO8/f6dTNRr8AAAAASUVORK5CYII=',
  ].join(''),
  'base64',
);
const expectedUrl = 'http://127.0.0.1:4612/#/join-class?code=6SY%20DBR%203CE';

// Actual original attachment from Classroom run 39163873957 / job 117782652334,
// source b1387d32db98e70d635b9843016fee2f81b83cf7, artifact 12150460280.
// This 20mm, 76x77 PNG decodes raw but fails if 2x is forced: category A regression.
const rawSuccessPrintPng = Buffer.from(
  [
    'iVBORw0KGgoAAAANSUhEUgAAAEwAAABNCAIAAACDqRXZAAAClUlEQVR4nOxaW5LDMAgjM73/lbPdZLb1',
    'GCRkT37WRl9tg58YkNy8zvO01fGyDVCLXAW1yFVQi1wF8SKP4zABd40Njf0jX5DfT7lZaJDOx2P740rI',
    'kN/adsvfn9Hed7+LLmqHULrtUInnAnIab+Jj6eNkPhAPY5uaT3lSQxeN6NGN0GwoMidQntTgnfOJyRuo',
    '1n3MULXs+plGefJCupckJnlGJQFMGk74li1SzAfthDoy4NffJSG0QeFxnc5PWxzXZyL7293fZnMffgZN',
    'S/8j2F5qDcVDF1E8JklvofP9TMKyVFILIKzO5iLKZ0XDhA49JUMrBjyet8+uRNSQwDAnmlExDMvg0JVK',
    'aOBR2XVEQ3XNU4OhPslZMAEztE6p+KJ+5+TWjxj2mS5148SjpA3DfkgvVMlwHVBmQr+EKD3pkCqpG6HB',
    'BB07LhhONiKnL6l1W+AiTlg4cY5RqUUMWhCN7rF9dhXFbvuIbG1K69AETK66CCW1svKFlJTJO41iiSTh',
    'iUE39qRCr/WGISXyX8W2YaY4Jv6fJHzNNILGU05aabpORLWBsP1xbREesNY4vf4Jf+elyCjfMPlE1M2A',
    'iyL01agiQ2bhI9R/NzfUMERJLQye7tI7HpFLnhcMR2Pb0IoMSAiz2TFyMUu8IRZSLqAfWOS/Rk7Qw0SK',
    'iFgYHsQbqSLzvhKlXwuVDIglJASZaFp4OJ1IU86Net81wwSDTy8QwpTGuy0y8IvH3ncNnU+EolFiPRRy',
    'lrm6yMCFIUKcRtRoAeDZoaTWF48tciiKQuPQyQhD6bc8qYGrKpNdFJJERMeHaHp58kIaHmGT9AJlaDgk',
    '3ETkf6enE+KynfR54td90oGGUH/CroJKPKugFrkKapGrYItF/gAAAP//Zpg01gAAAAZJREFUAwBZ1Owp',
    'Op6SJgAAAABJRU5ErkJggg==',
  ].join(''),
  'base64',
);
const rawSuccessUrl = 'http://127.0.0.1:4612/#/join-class?code=4KT%203WE%20KCX';

function capturedRaster(bytes = failingPrintPng): QrRaster {
  const png = PNG.sync.read(bytes);
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

function independentDecode(raster: QrRaster, monochrome = false): string | null {
  const data = new Uint8ClampedArray(raster.data);
  if (monochrome) {
    for (let offset = 0; offset < data.length; offset += 4) {
      const luminance =
        data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722;
      const value = luminance < 160 ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return jsQR(data, raster.width, raster.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

describe('captured QR decode selection', () => {
  it('uses one 2x print fallback for the frozen raw-failing screenshot', () => {
    expect(createHash('sha256').update(failingPrintPng).digest('hex')).toBe(
      'fd04abbc6d259f1ba915e9edac039a2a56998cd74e61ccbc30eef8db2077ef9d',
    );
    const original = capturedRaster();
    const before = new Uint8ClampedArray(original.data);
    expect([original.width, original.height]).toEqual([62, 61]);
    expect(independentDecode(original)).toBeNull();
    expect(independentDecode(original, true)).toBeNull();

    const result = decodeQrRaster(original, 'print');
    expect([result.raster.width, result.raster.height]).toEqual([124, 122]);
    expect(result.raster).not.toBe(original);
    expect(result.decoded?.data).toBe(expectedUrl);
    expect(result.monochromeDecoded?.data).toBe(expectedUrl);
    expect(original.data).toEqual(before);
  });

  it('preserves the actual raw print success that forced 2x makes undecodable', () => {
    expect(createHash('sha256').update(rawSuccessPrintPng).digest('hex')).toBe(
      '901fd673efcc13f1cae57d481dc5d2d096dc4ce6aadcca9889758f886f213bcb',
    );
    const original = capturedRaster(rawSuccessPrintPng);
    const before = new Uint8ClampedArray(original.data);
    expect([original.width, original.height]).toEqual([76, 77]);
    expect(independentDecode(original)).toBe(rawSuccessUrl);
    expect(independentDecode(original, true)).toBe(rawSuccessUrl);
    expect(independentDecode(normalizePrintQrRaster(original))).toBeNull();
    expect(independentDecode(normalizePrintQrRaster(original), true)).toBeNull();

    const result = decodeQrRaster(original, 'print');
    expect(result.raster).toBe(original);
    expect(result.decoded?.data).toBe(rawSuccessUrl);
    expect(result.monochromeDecoded?.data).toBe(rawSuccessUrl);
    expect(original.data).toEqual(before);
  });

  it('never gives a raw-failing screen screenshot the print fallback', () => {
    const original = capturedRaster();
    const before = new Uint8ClampedArray(original.data);
    expect(independentDecode(normalizePrintQrRaster(original))).toBe(expectedUrl);
    const result = decodeQrRaster(original, 'screen');
    expect(result.raster).toBe(original);
    expect(result.decoded).toBeNull();
    expect(result.monochromeDecoded).toBeNull();
    expect(original.data).toEqual(before);
  });

  it('leaves a monochrome failure on the selected raw raster without another fallback', () => {
    const original = capturedRaster(rawSuccessPrintPng);
    // Keep the original white border; darken only the interior white background.
    // Adaptive raw decoding succeeds, but the fixed monochrome threshold loses it.
    for (let y = 4; y < original.height - 4; y += 1) {
      for (let x = 4; x < original.width - 4; x += 1) {
        const offset = (y * original.width + x) * 4;
        if (original.data[offset] === 255) {
          original.data[offset] = original.data[offset + 1] = original.data[offset + 2] = 150;
        }
      }
    }
    const before = new Uint8ClampedArray(original.data);
    const result = decodeQrRaster(original, 'print');
    expect(result.raster).toBe(original);
    expect(result.decoded?.data).toBe(rawSuccessUrl);
    expect(result.monochromeDecoded).toBeNull();
    expect(original.data).toEqual(before);
  });

  it('keeps a blank screenshot undecodable in color and monochrome', () => {
    const original = capturedRaster();
    original.data.fill(255);
    for (const raster of [original, normalizePrintQrRaster(original)]) {
      expect(independentDecode(raster)).toBeNull();
      expect(independentDecode(raster, true)).toBeNull();
    }
    const before = new Uint8ClampedArray(original.data);
    const result = decodeQrRaster(original, 'print');
    expect(result.decoded).toBeNull();
    expect(result.monochromeDecoded).toBeNull();
    expect(original.data).toEqual(before);
  });

  it('does not repair a screenshot with its three finder patterns erased', () => {
    const original = capturedRaster();
    // Erase the three 18px corner regions containing the captured finder patterns.
    // Work only on the PNG pixels, without consulting encoder modules or DOM data.
    for (let y = 0; y < original.height; y += 1) {
      for (let x = 0; x < original.width; x += 1) {
        if (
          (x < 18 && y < 18) ||
          (x >= original.width - 18 && y < 18) ||
          (x < 18 && y >= original.height - 18)
        ) {
          original.data.fill(255, (y * original.width + x) * 4, (y * original.width + x + 1) * 4);
        }
      }
    }
    expect(original.data).not.toEqual(capturedRaster().data);
    expect(original.data.some((value) => value === 0)).toBe(true);
    for (const raster of [original, normalizePrintQrRaster(original)]) {
      expect(independentDecode(raster)).toBeNull();
      expect(independentDecode(raster, true)).toBeNull();
    }
    const before = new Uint8ClampedArray(original.data);
    const result = decodeQrRaster(original, 'print');
    expect(result.decoded).toBeNull();
    expect(result.monochromeDecoded).toBeNull();
    expect(original.data).toEqual(before);
  });

  it('replicates all RGBA channels exactly without mutating or aliasing a buffer view', () => {
    const backing = new Uint8ClampedArray([
      99, 99, 99, 99, 1, 2, 3, 4, 51, 102, 153, 204, 88, 88, 88, 88,
    ]);
    const before = new Uint8ClampedArray(backing);
    const original = { data: backing.subarray(4, 12), width: 1, height: 2 };
    const normalized = normalizePrintQrRaster(original);
    expect([normalized.width, normalized.height]).toEqual([2, 4]);
    expect(Array.from(normalized.data)).toEqual([
      1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 51, 102, 153, 204, 51, 102, 153, 204, 51, 102,
      153, 204, 51, 102, 153, 204,
    ]);
    expect(backing).toEqual(before);
    normalized.data.fill(0);
    expect(backing).toEqual(before);
  });

  it.each([
    { width: 0, height: 1, length: 0 },
    { width: 1.5, height: 1, length: 6 },
    { width: 1, height: 1, length: 3 },
  ])('rejects incomplete or invalid RGBA input: %j', ({ width, height, length }) => {
    expect(() =>
      normalizePrintQrRaster({ data: new Uint8ClampedArray(length), width, height }),
    ).toThrow(RangeError);
  });
});
