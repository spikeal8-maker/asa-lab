export interface ClassroomAccessSettings {
  classroomId: string;
  mode: 'deny' | 'allow' | 'rating';
  minimumRating: number;
  revision: number;
  readOnly: boolean;
  students: Array<{
    seatId: string;
    displayName: string;
    status: 'issued' | 'active' | 'suspended';
    override: 'inherit' | 'allow' | 'deny';
    rating: number | null;
    canGenerate: boolean;
  }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// ai_classroom_access_set accepts expectedRevision as at most 15 decimal digits.
const MAX_EXPECTED_REVISION = 999_999_999_999_999;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const revision = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_EXPECTED_REVISION;
const rating = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

/** Validate the complete projection before it can become editable component state. */
export function isClassroomAccessSettings(
  value: unknown,
  classroomId: string,
): value is ClassroomAccessSettings {
  if (
    !record(value) ||
    !uuid(classroomId) ||
    !uuid(value.classroomId) ||
    value.classroomId.toLowerCase() !== classroomId.toLowerCase() ||
    typeof value.mode !== 'string' ||
    !['deny', 'allow', 'rating'].includes(value.mode) ||
    !rating(value.minimumRating) ||
    !Number.isInteger(value.minimumRating) ||
    !revision(value.revision) ||
    typeof value.readOnly !== 'boolean' ||
    !Array.isArray(value.students)
  )
    return false;
  const seats = new Set<string>();
  for (const student of value.students) {
    if (
      !record(student) ||
      !uuid(student.seatId) ||
      seats.has(student.seatId.toLowerCase()) ||
      typeof student.displayName !== 'string' ||
      student.displayName.trim() === '' ||
      [...student.displayName].length > 120 ||
      typeof student.status !== 'string' ||
      !['issued', 'active', 'suspended'].includes(student.status) ||
      typeof student.override !== 'string' ||
      !['inherit', 'allow', 'deny'].includes(student.override) ||
      (student.rating !== null && !rating(student.rating)) ||
      typeof student.canGenerate !== 'boolean'
    )
      return false;
    seats.add(student.seatId.toLowerCase());
  }
  return true;
}

/** The stored idempotent receipt is exactly one revision after this mutation's input. */
export function isClassroomAccessSaved(
  value: unknown,
  expectedRevision: number,
): value is { saved: true; revision: number } {
  return (
    revision(expectedRevision) &&
    record(value) &&
    value.saved === true &&
    Number.isSafeInteger(value.revision) &&
    value.revision === expectedRevision + 1
  );
}
