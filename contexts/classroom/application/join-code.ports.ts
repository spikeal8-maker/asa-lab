/** What a visitor may see about a class before identifying themselves. */
export interface ClassroomPreview {
  readonly classroomId: string;
  readonly title: string;
  readonly educatorDisplayName: string;
}

export interface JoinCodeDirectoryPort {
  /** Resolves a normalized code, or null when nothing matches. */
  resolve(normalizedCode: string): Promise<ClassroomPreview | null>;
}
