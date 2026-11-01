export interface PreparedImage {
  file: File;
  originalBytes: number;
  dimensions?: string;
}
export async function prepareChatImage(file: File): Promise<PreparedImage> {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return { file, originalBytes: file.size };
  if (file.size > 32 * 1024 * 1024) throw new Error('Исходное изображение больше 32 МБ.');
  const worker = new Worker(new URL('./prepare-image.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = window.setTimeout(() => {
      finish();
      reject(new Error('Обработка картинки заняла слишком много времени. Выберите меньший файл.'));
    }, 20000);
    worker.onerror = () => {
      finish();
      reject(new Error('Обработка изображения недоступна в этом браузере.'));
    };
    worker.onmessage = (
      event: MessageEvent<{
        blob?: Blob;
        error?: string;
        width: number;
        height: number;
        unchanged?: boolean;
      }>,
    ) => {
      finish();
      const data = event.data;
      if (!data.blob || data.error) {
        reject(new Error(data.error || 'Не удалось обработать изображение.'));
        return;
      }
      const extension = data.blob.type === 'image/png' ? 'png' : 'webp';
      const result = data.unchanged
        ? file
        : new File([data.blob], file.name.replace(/\.[^.]+$/, '.' + extension), {
            type: data.blob.type,
          });
      resolve({
        file: result,
        originalBytes: file.size,
        dimensions: `${data.width} × ${data.height}`,
      });
    };
    worker.postMessage(file);
  });
}
