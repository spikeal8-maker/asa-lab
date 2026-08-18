export interface Classroom {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly ageBand: ClassroomAgeBand;
  readonly topicKeys: readonly string[];
  readonly safeModeDefault: boolean;
  readonly studentCount: number;
  /** Сдано и ещё не отвечено — счётчик проверки. */
  readonly awaitingReview?: number;
  readonly joinCodeVersion: number | null;
  readonly joinCodeStatus: 'active' | 'revoked' | null;
  readonly teacherRole: 'owner' | 'co_teacher';
  readonly workspaceKind: 'personal' | 'organization';
  readonly workspaceTitle: string;
  readonly createdAt: string;
  /** Set while the class is put away; null while it is running. */
  readonly archivedAt: string | null;
}

/**
 * A class outlives a school year. It runs, then it is put away, and sometimes a
 * teacher decides it should not have existed at all. Removal is a state rather
 * than a DELETE: the class holds children's work and a record of who did what,
 * and neither should vanish because a register was tidied.
 */
export const CLASSROOM_STATUSES = ['active', 'archived', 'deleted'] as const;
export type ClassroomStatus = (typeof CLASSROOM_STATUSES)[number];

export function isClassroomStatus(value: unknown): value is ClassroomStatus {
  return typeof value === 'string' && CLASSROOM_STATUSES.includes(value as ClassroomStatus);
}

export const CLASSROOM_AGE_BANDS = ['6-8', '9-10', '11-12', '13-15', '16-18', 'mixed'] as const;
export type ClassroomAgeBand = (typeof CLASSROOM_AGE_BANDS)[number];

export function isClassroomAgeBand(value: unknown): value is ClassroomAgeBand {
  return typeof value === 'string' && CLASSROOM_AGE_BANDS.includes(value as ClassroomAgeBand);
}

export function areValidTopicKeys(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 12 &&
    value.every((entry) => typeof entry === 'string' && /^[a-z0-9-]{1,32}$/.test(entry))
  );
}

export function isValidClassroomTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 255;
}

/**
 * A learner's picture, named rather than uploaded.
 *
 * A seat picks from the set the product ships with. Letting a child put an
 * arbitrary image on a class register would mean policing photographs of
 * children, which safe mode exists precisely to avoid; and a name is a dozen
 * bytes where a data URL is three hundred kilobytes on every roster row.
 *
 * Null is a real answer: nobody has chosen, and the client draws one from the
 * same set keyed by the seat.
 */
export function isSeatAvatarKey(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^asa-avatar-[0-9]{2}$/.test(value));
}
