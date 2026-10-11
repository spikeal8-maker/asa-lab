import { PNG } from 'pngjs';
import { isValidAvatarDataUrl } from '@asa-lab/identity';

/** Reuse the Account envelope bound, then decode the pixels. Only canonical
 * PNG is stored: metadata, external references and executable formats cannot
 * survive this boundary. Header dimensions are checked before allocation. */
export function canonicalClassroomAvatar(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isValidAvatarDataUrl(value) ||
    !value.startsWith('data:image/png;base64,')
  ) {
    throw new Error('Выберите растровое изображение PNG, JPEG или WebP.');
  }
  const source = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
  if (
    source.length > 220_000 ||
    source.length < 33 ||
    !source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    source.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Некорректное изображение. Максимум 220 КБ после уменьшения.');
  }
  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  if (width < 16 || height < 16 || width > 512 || height > 512) {
    throw new Error('Размер аватара должен быть от 16×16 до 512×512.');
  }
  try {
    const pixels = PNG.sync.read(source, { checkCRC: true });
    const bytes = PNG.sync.write(pixels, { colorType: 6, bitDepth: 8 });
    if (bytes.length > 220_000) throw new Error('too large');
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    throw new Error('Изображение повреждено или слишком велико. Выберите другое.');
  }
}
