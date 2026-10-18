export type QrRaster = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

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
