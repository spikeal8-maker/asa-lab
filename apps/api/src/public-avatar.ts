import type { FastifyReply } from 'fastify';
import { isValidAvatarDataUrl } from '@asa-lab/identity';
import { publicationError } from './public-projects.errors.js';
export interface PublicAvatarSource {
  dataUrl?: string;
  builtinKey?: string;
}
export function sendPublicAvatar(
  reply: FastifyReply,
  source: PublicAvatarSource | null | undefined,
) {
  reply
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cross-Origin-Resource-Policy', 'same-origin');
  if (source?.builtinKey && /^asa-avatar-(0[1-9]|[1-5][0-9]|6[0-7])$/.test(source.builtinKey))
    return reply
      .code(302)
      .redirect(`/assets/avatars/default/avatar-${source.builtinKey.slice(-2)}.webp`);
  if (typeof source?.dataUrl !== 'string' || !isValidAvatarDataUrl(source.dataUrl))
    throw publicationError('not_found', 'Аватар недоступен.', 404);
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(source.dataUrl);
  if (!match) throw publicationError('not_found', 'Аватар недоступен.', 404);
  const pixels = Buffer.from(match[2]!, 'base64');
  const valid =
    match[1] === 'png'
      ? pixels.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg'
        ? pixels.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : pixels.toString('ascii', 0, 4) === 'RIFF' && pixels.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw publicationError('not_found', 'Аватар недоступен.', 404);
  return reply.type(`image/${match[1]}`).send(pixels);
}
