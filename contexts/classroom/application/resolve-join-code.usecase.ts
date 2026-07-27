import { isValidJoinCode, joinCodeDigest } from '../domain/join-code.js';
import type {
  ClassroomPreview,
  JoinCodeDirectoryPort,
  JoinCodePepperPort,
} from './join-code.ports.js';

export type ResolveJoinCodeResult =
  | { readonly ok: true; readonly preview: ClassroomPreview }
  | { readonly ok: false; readonly code: 'not_found' | 'unavailable' };

/**
 * Turns a class code into a preview and nothing else.
 *
 * No membership, no session and no seat is created here: the student still has
 * to say who they are on the next screen. A code that matches nothing gets the
 * same answer as a malformed one, so the endpoint cannot be used to enumerate
 * classes.
 */
export class ResolveJoinCodeUseCase {
  constructor(
    private readonly directory: JoinCodeDirectoryPort,
    private readonly pepper: JoinCodePepperPort,
  ) {}

  async execute(rawCode: unknown): Promise<ResolveJoinCodeResult> {
    const pepper = this.pepper.pepper();
    if (pepper === null) {
      return { ok: false, code: 'unavailable' };
    }
    if (!isValidJoinCode(rawCode)) {
      return { ok: false, code: 'not_found' };
    }
    const preview = await this.directory.resolve(joinCodeDigest(rawCode as string, pepper));
    return preview ? { ok: true, preview } : { ok: false, code: 'not_found' };
  }
}
