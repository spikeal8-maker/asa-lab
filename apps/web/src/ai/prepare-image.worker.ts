/// <reference lib="webworker" />
// Decoding and resizing stay off the UI thread. Originals never leave this worker.
self.onmessage = async (event: MessageEvent<File>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const file = event.data;
    if (file.size > 32 * 1024 * 1024) throw new Error('Исходное изображение больше 32 МБ.');
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => head[index] === byte);
    const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
    const webp =
      String.fromCharCode(...head.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
    if (!png && !jpeg && !webp)
      throw new Error('Поддерживаются только настоящие PNG, JPEG и WebP.');
    bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (width * height > 64_000_000 || !width || !height)
      throw new Error('Изображение превышает 64 мегапикселя.');
    const scale = Math.min(
      1,
      2560 / Math.max(width, height),
      Math.sqrt(4_000_000 / (width * height)),
    );
    const targetWidth = Math.max(1, Math.floor(width * scale));
    const targetHeight = Math.max(1, Math.floor(height * scale));
    if (scale === 1 && file.size <= 1536 * 1024) {
      self.postMessage({ blob: file, width, height, unchanged: true });
      return;
    }
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не смог обработать изображение.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    // Prefer lossless PNG for text and diagrams when its size is reasonable.
    const lossless = await canvas.convertToBlob({ type: 'image/png' });
    let blob =
      lossless.size <= 1536 * 1024
        ? lossless
        : await canvas.convertToBlob({ type: 'image/webp', quality: 0.94 });
    if (blob.size > 3 * 1024 * 1024) {
      const smaller = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
      if (smaller.size < blob.size) blob = smaller;
    }
    if (blob.size > 3 * 1024 * 1024)
      throw new Error(
        'Не удалось уменьшить изображение без сильной потери качества. Выберите нужный фрагмент.',
      );
    if (scale === 1 && file.size <= blob.size) {
      self.postMessage({ blob: file, width, height, unchanged: true });
    } else self.postMessage({ blob, width: targetWidth, height: targetHeight, unchanged: false });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Не удалось обработать изображение.',
    });
  } finally {
    bitmap?.close();
  }
};

export {};
