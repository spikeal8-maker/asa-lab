import jsQR from 'jsqr';

export type QrRaster = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

export type QrDecodeResult = {
  readonly raster: QrRaster;
  readonly decoded: ReturnType<typeof jsQR>;
  readonly monochromeDecoded: ReturnType<typeof jsQR>;
};

// Select decoder input from one captured raster, never from an expected URL.
// Preserve every raw success: forcing 2x can itself break a valid raw decode.
export function decodeQrRaster(original: QrRaster, media: 'screen' | 'print'): QrDecodeResult {
  let raster = original;
  let decoded = jsQR(raster.data, raster.width, raster.height, {
    inversionAttempts: 'dontInvert',
  });
  if (decoded === null && media === 'print') {
    raster = normalizePrintQrRaster(original);
    decoded = jsQR(raster.data, raster.width, raster.height, {
      inversionAttempts: 'dontInvert',
    });
  }
  if (decoded === null) return { raster, decoded, monochromeDecoded: null };

  // Monochrome is a separate acceptance check on the already selected raster.
  // Its failure must not trigger another raster choice or decoder fallback.
  const monochrome = new Uint8ClampedArray(raster.data.length);
  for (let offset = 0; offset < raster.data.length; offset += 4) {
    const luminance =
      raster.data[offset]! * 0.2126 +
      raster.data[offset + 1]! * 0.7152 +
      raster.data[offset + 2]! * 0.0722;
    const value = luminance < 160 ? 0 : 255;
    monochrome[offset] = value;
    monochrome[offset + 1] = value;
    monochrome[offset + 2] = value;
    monochrome[offset + 3] = 255;
  }
  const monochromeDecoded = jsQR(monochrome, raster.width, raster.height, {
    inversionAttempts: 'dontInvert',
  });
  return { raster, decoded, monochromeDecoded };
}

// jsQR can reject a valid 16mm print screenshot at DPR1.
// Replicate each captured pixel exactly 2x2: no smoothing, new border, cropping,
// encoder access or configurable scale. Screen screenshots do not use this helper.
export function normalizePrintQrRaster({ data, width, height }: QrRaster): QrRaster {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length !== width * height * 4
  ) {
    throw new RangeError('Print QR normalization requires a complete positive-size RGBA raster');
  }

  const printWidth = width * 2;
  const printHeight = height * 2;
  const printData = new Uint8ClampedArray(printWidth * printHeight * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const pixel = data.subarray(sourceOffset, sourceOffset + 4);
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          printData.set(pixel, ((y * 2 + dy) * printWidth + x * 2 + dx) * 4);
        }
      }
    }
  }
  return { data: printData, width: printWidth, height: printHeight };
}
