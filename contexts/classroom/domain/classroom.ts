export interface Classroom {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
}

export function isValidClassroomTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 255;
}
