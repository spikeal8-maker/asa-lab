import { isValidJoinCode, normalizeJoinCode } from '../domain/join-code.js';
import type { ClassroomPreview, JoinCodeDirectoryPort } from './join-code.ports.js';

export type ResolveJoinCodeResult =
  | { readonly ok: true; readonly preview: ClassroomPreview }
  | { readonly ok: false; readonly code: 'validation_error' | 'not_found' };

/**
 * Turns a class code into a preview and nothing else.
 *
 * No membership, no session and no seat is created here: the student still has
 * to say who they are on the next screen. A code that matches nothing gets the
 * same answer shape as a malformed one, so the endpoint cannot be used to
 * enumerate classes.
 */
export class ResolveJoinCodeUseCase {
  constructor(private readonly directory: JoinCodeDirectoryPort) {}

  async execute(rawCode: unknown): Promise<ResolveJoinCodeResult> {
    if (!isValidJoinCode(rawCode)) {
      return { ok: false, code: 'validation_error' };
    }
    const preview = await this.directory.resolve(normalizeJoinCode(rawCode as string));
    return preview ? { ok: true, preview } : { ok: false, code: 'not_found' };
  }
}
