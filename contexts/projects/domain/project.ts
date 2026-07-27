/** Subject-agnostic project container with one mutable draft and numbered,
 * immutable checkpoints. A teacher may own a personal project independently of
 * a class or publish a project inside a class workspace. */

export type ProjectScope = 'personal' | 'classroom';

export interface Project {
  readonly id: string;
  readonly scope: ProjectScope;
  readonly classroomId: string | null;
  readonly moduleKey: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface ProjectDraft {
  readonly projectId: string;
  readonly document: unknown;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface ProjectVersion {
  readonly id: string;
  readonly projectId: string;
  readonly versionNo: number;
  readonly label: string | null;
  readonly createdAt: string;
}

export function isProjectScope(value: unknown): value is ProjectScope {
  return value === 'personal' || value === 'classroom';
}

export function isValidProjectTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 255;
}

/** Only the electronics module is executable in this slice. Other module cards
 * may be shown as planned, but the API must not create a fake unsupported project. */
export function isSupportedModuleKey(value: unknown): value is 'electronics' {
  return value === 'electronics';
}

export function isValidCheckpointLabel(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.trim().length <= 255);
}
