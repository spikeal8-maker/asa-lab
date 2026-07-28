import { verifyJoinIntentToken } from '../domain/join-intent.js';
import type { JoinCodeDirectoryPort, JoinCodeSecretPort } from './join-code.ports.js';

export type DescribeJoinIntentResult =
  | {
      readonly ok: true;
      readonly title: string;
      readonly educatorDisplayName: string;
    }
  | { readonly ok: false; readonly code: 'invalid' | 'expired' | 'unavailable' };

/**
 * Describes the class a join-intent token stands for.
 *
 * The server re-checks the token every time: the signature, the lifetime, and
 * whether the code version it was issued from is still the active one. A
 * rotated or revoked class code therefore invalidates intents taken from it,
 * and nothing the browser stores can name a different class.
 *
 * It still creates nothing — describing an intent is not joining.
 */
export class DescribeJoinIntentUseCase {
  constructor(
    private readonly directory: JoinCodeDirectoryPort,
    private readonly secrets: JoinCodeSecretPort,
  ) {}

  async execute(token: unknown): Promise<DescribeJoinIntentResult> {
    const secret = this.secrets.secret();
    if (secret === null) {
      return { ok: false, code: 'unavailable' };
    }
    const verified = verifyJoinIntentToken(token, secret);
    if (!verified.ok) {
      return { ok: false, code: verified.reason === 'expired' ? 'expired' : 'invalid' };
    }
    const active = await this.directory.isVersionActive(
      verified.claims.classroomId,
      verified.claims.codeVersion,
    );
    if (!active) {
      return { ok: false, code: 'expired' };
    }
    const preview = await this.directory.previewById(verified.claims.classroomId);
    if (!preview) {
      return { ok: false, code: 'invalid' };
    }
    return {
      ok: true,
      title: preview.title,
      educatorDisplayName: preview.educatorDisplayName,
    };
  }
}
