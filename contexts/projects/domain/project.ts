/** Subject-agnostic project container with one mutable draft and numbered,
 * immutable checkpoints. A teacher may own a personal project independently of
 * a class or publish a project inside a class workspace. */

import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';

export type ProjectScope = 'personal' | 'classroom';
export type ProjectStatus = 'active' | 'archived' | 'trashed';

/**
 * What a project card shows. The descriptor comes from the subject module and
 * Project Core never interprets it — it stores it, hands it to the client, and
 * compares digests to tell whether a card is still current.
 */
export interface ProjectPreview {
  readonly digest: string;
  readonly descriptor: ModulePreviewDescriptor;
}

export interface Project {
  readonly id: string;
  readonly scope: ProjectScope;
  readonly classroomId: string | null;
  readonly moduleKey: string;
  readonly title: string;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Null while the project is empty, or on drafts saved before previews. */
  readonly preview: ProjectPreview | null;
  /**
   * The draft revision the stored snapshot was taken from, or null when the
   * editor has never captured one. A card uses it to build a delivery URL that
   * changes with the work, so the image behind it can be cached forever.
   */
  readonly snapshotRevision: number | null;
  /** Что это за работа, своими словами автора. */
  readonly description: string | null;
  /** До десяти коротких слов, по которым работу находят. */
  readonly tags: readonly string[];
  /** Под какой лицензией её можно брать. */
  readonly license: string;
  /**
   * Where this project came from, when it was taken from somebody else's work
   * in the gallery. Set once at copy time and never afterwards: a project that
   * says "copy of X" says it for the rest of its life, so nobody can pass a
   * borrowed model off as their own.
   */
  readonly copiedFrom: {
    readonly projectId: string;
    readonly author: string;
    readonly title: string;
    readonly at: string;
  } | null;
}

export interface ProjectDraft {
  readonly projectId: string;
  readonly document: unknown;
  readonly revision: number;
  readonly updatedAt: string;
  readonly preview: ProjectPreview | null;
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

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === 'active' || value === 'archived' || value === 'trashed';
}

export function isValidProjectTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 255;
}

export function isValidCheckpointLabel(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.trim().length <= 255);
}
