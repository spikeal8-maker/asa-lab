const ACCEPTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 300_000;
const AVATAR_EDGE = 320;

export function avatarFileError(file: Pick<File, 'size' | 'type'>): string | null {
  if (!ACCEPTED_AVATAR_TYPES.has(file.type)) {
    return 'Выберите изображение PNG, JPEG или WebP.';
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return 'Файл слишком большой. Максимальный размер — 8 МБ.';
  }
  return null;
}

export async function createAvatarDataUrl(file: File): Promise<string> {
  const validationError = avatarFileError(file);
  if (validationError) throw new Error(validationError);

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить изображение.');

    const sourceEdge = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, (bitmap.width - sourceEdge) / 2);
    const sourceY = Math.max(0, (bitmap.height - sourceEdge) / 2);
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceEdge,
      sourceEdge,
      0,
      0,
      AVATAR_EDGE,
      AVATAR_EDGE,
    );

    const dataUrl = canvas.toDataURL('image/webp', 0.82);
    if (!dataUrl.startsWith('data:image/webp;base64,') || dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error('Изображение не удалось безопасно уменьшить. Выберите другой файл.');
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
