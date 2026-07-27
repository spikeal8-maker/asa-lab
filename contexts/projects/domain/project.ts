/** Project shell: a subject-agnostic container with one mutable draft and
 * numbered immutable checkpoints. The subject document itself is opaque here. */

export interface Project {
  readonly id: string;
  readonly classroomId: string;
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

export function isValidProjectTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 255;
}

/** Only the electronics module exists in this slice. */
export function isSupportedModuleKey(value: unknown): value is 'electronics' {
  return value === 'electronics';
}

export function isValidCheckpointLabel(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.trim().length <= 255);
}
