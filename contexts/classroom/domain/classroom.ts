export interface Classroom {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly ageBand: ClassroomAgeBand;
  readonly topicKeys: readonly string[];
  readonly safeModeDefault: boolean;
  readonly studentCount: number;
  readonly joinCodeVersion: number | null;
  readonly joinCodeStatus: 'active' | 'revoked' | null;
  readonly createdAt: string;
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
