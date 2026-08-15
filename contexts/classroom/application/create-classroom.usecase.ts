import { createHash } from 'node:crypto';
import {
  areValidTopicKeys,
  isClassroomAgeBand,
  isValidClassroomTitle,
  type Classroom,
} from '../domain/classroom.js';
import type { ClassroomRepositoryPort } from './ports.js';

export type CreateClassroomResult =
  | { readonly ok: true; readonly classroom: Classroom; readonly created: boolean }
  | { readonly ok: false; readonly code: 'validation_error'; readonly message: string }
  | { readonly ok: false; readonly code: 'idempotency_conflict'; readonly message: string };

/** Fingerprint of the normalized payload: a retry with the same key must carry
 * the same intent, otherwise the request is rejected as a conflict. */
export function classroomRequestFingerprint(
  title: string,
  ageBand = 'mixed',
  topicKeys: readonly string[] = [],
  safeModeDefault = true,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ title, ageBand, topicKeys: [...topicKeys].sort(), safeModeDefault }))
    .digest('hex');
}

export class CreateClassroomUseCase {
  constructor(private readonly repository: ClassroomRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    classroomId: string;
    schoolId: string;
    academicPeriodId: string;
    teacherId: string;
    title: unknown;
    ageBand: unknown;
    topicKeys: unknown;
    safeModeDefault: unknown;
    joinCodeHash: string;
    idempotencyKey: string;
  }): Promise<CreateClassroomResult> {
    if (!isValidClassroomTitle(input.title)) {
      return { ok: false, code: 'validation_error', message: 'title must be 1..255 characters' };
    }
    if (!isClassroomAgeBand(input.ageBand)) {
      return { ok: false, code: 'validation_error', message: 'invalid age band' };
    }
    if (!areValidTopicKeys(input.topicKeys)) {
      return { ok: false, code: 'validation_error', message: 'invalid classroom topics' };
    }
    if (typeof input.safeModeDefault !== 'boolean') {
      return { ok: false, code: 'validation_error', message: 'safe mode must be boolean' };
    }
    const title = input.title.trim();
    const topicKeys = [...input.topicKeys].sort();
    const result = await this.repository.createWithOwner({
      tenantId: input.tenantId,
      classroomId: input.classroomId,
      schoolId: input.schoolId,
      academicPeriodId: input.academicPeriodId,
      teacherId: input.teacherId,
      title,
      ageBand: input.ageBand,
      topicKeys,
      safeModeDefault: input.safeModeDefault,
      joinCodeHash: input.joinCodeHash,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: classroomRequestFingerprint(
        title,
        input.ageBand,
        topicKeys,
        input.safeModeDefault,
      ),
    });
    if (result.kind === 'conflict') {
      return {
        ok: false,
        code: 'idempotency_conflict',
        message: 'the same Idempotency-Key was already used with a different payload',
      };
    }
    return { ok: true, classroom: result.classroom, created: result.kind === 'created' };
  }
}
