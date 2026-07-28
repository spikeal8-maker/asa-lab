import { isValidJoinCode, joinCodeDigest } from '../domain/join-code.js';
import { issueJoinIntentToken } from '../domain/join-intent.js';
import type { JoinCodeDirectoryPort, JoinCodeSecretPort } from './join-code.ports.js';

export interface ResolvedClass {
  readonly title: string;
  readonly educatorDisplayName: string;
  /** Opaque, signed and short-lived; the browser never learns the class id. */
  readonly joinIntentToken: string;
}

export type ResolveJoinCodeResult =
  | { readonly ok: true; readonly resolved: ResolvedClass }
  | { readonly ok: false; readonly code: 'not_found' | 'unavailable' };

/**
 * Turns a class code into a preview and an intent token, and nothing else.
 *
 * No membership, no session and no seat is created here: the student still has
 * to say who they are on the next screen. A code that matches nothing gets the
 * same answer as a malformed one, so the endpoint cannot be used to enumerate
 * classes, and the classroom identifier never leaves the server.
 */
export class ResolveJoinCodeUseCase {
  constructor(
    private readonly directory: JoinCodeDirectoryPort,
    private readonly secrets: JoinCodeSecretPort,
  ) {}

  async execute(rawCode: unknown): Promise<ResolveJoinCodeResult> {
    const secret = this.secrets.secret();
    if (secret === null) {
      return { ok: false, code: 'unavailable' };
    }
    if (!isValidJoinCode(rawCode)) {
      return { ok: false, code: 'not_found' };
    }
    const preview = await this.directory.resolve(joinCodeDigest(rawCode as string, secret));
    if (!preview) {
      return { ok: false, code: 'not_found' };
    }
    return {
      ok: true,
      resolved: {
        title: preview.title,
        educatorDisplayName: preview.educatorDisplayName,
        joinIntentToken: issueJoinIntentToken(
          { classroomId: preview.classroomId, codeVersion: preview.codeVersion },
          secret,
        ),
      },
    };
  }
}
