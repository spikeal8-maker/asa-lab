import { createHash } from 'node:crypto';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { normalizePrintQrRaster, type QrRaster } from '../../e2e/fixtures/qr-print-raster';

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

function capturedRaster(): QrRaster {
  const png = PNG.sync.read(failingPrintPng);
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

describe('print QR raster normalization', () => {
  it('decodes the frozen failing print screenshot without generating or changing QR pixels', () => {
    expect(createHash('sha256').update(failingPrintPng).digest('hex')).toBe(
      'fd04abbc6d259f1ba915e9edac039a2a56998cd74e61ccbc30eef8db2077ef9d',
    );
    const original = capturedRaster();
    const before = new Uint8ClampedArray(original.data);
    expect([original.width, original.height]).toEqual([62, 61]);
    expect(independentDecode(original)).toBeNull();
    expect(independentDecode(original, true)).toBeNull();

    const normalized = normalizePrintQrRaster(original);
    expect([normalized.width, normalized.height]).toEqual([124, 122]);
    expect(independentDecode(normalized)).toBe(expectedUrl);
    expect(independentDecode(normalized, true)).toBe(expectedUrl);
    expect(original.data).toEqual(before);
  });

  it('keeps a blank screenshot undecodable in color and monochrome', () => {
    const original = capturedRaster();
    original.data.fill(255);
    for (const raster of [original, normalizePrintQrRaster(original)]) {
      expect(independentDecode(raster)).toBeNull();
      expect(independentDecode(raster, true)).toBeNull();
    }
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
