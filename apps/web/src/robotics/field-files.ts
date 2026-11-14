import {
  nextRoboticsObjectId,
  type RoboticsFieldDecoration,
  type RoboticsWorldDocument,
} from '@asa-lab/robotics/world-document';
import { parseRoboticsWorldDocument } from './world';

export const MAX_FIELD_JSON_BYTES = 512_000;
export const MAX_INPUT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_EMBEDDED_IMAGE_LENGTH = 240_000;

export function exportRoboticsField(world: RoboticsWorldDocument): string {
  return JSON.stringify(
    {
      format: 'asa-lab/robotics-field/v1',
      field: world.field,
      // The saved source has no runtime positions or simulation traces.
    },
    null,
    2,
  );
}

export function importRoboticsField(
  current: RoboticsWorldDocument,
  source: string,
): RoboticsWorldDocument {
  if (new TextEncoder().encode(source).length > MAX_FIELD_JSON_BYTES)
    throw new Error('JSON поля должен быть меньше 500 КБ.');
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error('Некорректный JSON поля.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new Error('JSON должен содержать объект поля.');
  const value = data as Record<string, unknown>;
  if (value.format !== undefined && value.format !== 'asa-lab/robotics-field/v1')
    throw new Error('Неизвестный формат JSON поля.');
  const sourceWorld =
    typeof value.world === 'object' && value.world !== null
      ? (value.world as Record<string, unknown>)
      : value;
  const field = sourceWorld.field ?? sourceWorld;
  if (typeof field !== 'object' || field === null || Array.isArray(field))
    throw new Error('Не обнаружены размеры и объекты поля.');
  const proposal: RoboticsWorldDocument = {
    ...current,
    field: field as RoboticsWorldDocument['field'],
  };
  const parsed = parseRoboticsWorldDocument(proposal);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.world;
}

export function createImageVisual(
  world: RoboticsWorldDocument,
  imageData: string,
  imageWidth: number,
  imageHeight: number,
): RoboticsFieldDecoration {
  if (
    !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData) ||
    imageData.length > MAX_EMBEDDED_IMAGE_LENGTH
  )
    throw new Error('Картинка должна быть в безопасном формате и меньше 180 КБ.');
  if (!(imageWidth > 0 && imageHeight > 0) || !Number.isFinite(imageWidth / imageHeight))
    throw new Error('Некорректные размеры изображения.');
  const widthMeters = Math.min(1, world.field.widthMeters * 0.4);
  const heightMeters = Math.min(
    world.field.heightMeters * 0.5,
    (widthMeters * imageHeight) / imageWidth,
  );
  const adjustedWidth =
    heightMeters < (widthMeters * imageHeight) / imageWidth
      ? (heightMeters * imageWidth) / imageHeight
      : widthMeters;
  return {
    id: nextRoboticsObjectId(world, 'image'),
    kind: 'image',
    label: 'Изображение',
    xMeters: Math.max(0, (world.field.widthMeters - adjustedWidth) / 2),
    yMeters: Math.max(0, (world.field.heightMeters - heightMeters) / 2),
    widthMeters: Math.max(0.02, adjustedWidth),
    heightMeters: Math.max(0.02, heightMeters),
    strokeColor: '#7e98a8',
    fillColor: '#ffffff',
    fillEnabled: false,
    imageData,
  };
}

/** Decode and re-encode locally: strip metadata and bound image bytes before persisting. */
export async function optimizeFieldImage(file: File): Promise<{
  data: string;
  width: number;
  height: number;
}> {
  if (file.size > MAX_INPUT_IMAGE_BYTES) throw new Error('Исходное изображение больше 8 МБ.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Поддерживаются PNG, JPEG и WebP.');
  const bitmap = await createImageBitmap(file);
  try {
    let longest = Math.min(640, Math.max(bitmap.width, bitmap.height));
    for (const quality of [0.86, 0.75, 0.64, 0.55]) {
      const ratio = longest / Math.max(bitmap.width, bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * ratio));
      const height = Math.max(1, Math.round(bitmap.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas недоступен для обработки изображения.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_EMBEDDED_IMAGE_LENGTH) return { data, width, height };
      longest = Math.max(190, Math.floor(longest * 0.78));
    }
    throw new Error('Не удалось сжать изображение до допустимого размера.');
  } finally {
    bitmap.close();
  }
}
