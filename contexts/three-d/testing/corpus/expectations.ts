import type { BooleanOperation, ThreeDDocument } from '../../domain/document.js';

export const THREE_D_CORPUS_VERSION = 1 as const;

export type ThreeDGeometryExpectation =
  | { readonly kind: 'valid-solid'; readonly toleranceProfile: 'printable-v1' }
  | { readonly kind: 'valid-empty' }
  | { readonly kind: 'typed-rejection'; readonly codes: readonly string[] }
  | { readonly kind: 'known-legacy-failure'; readonly issue: string };

export interface ThreeDGeometryCase {
  readonly id: string;
  readonly problemIds: readonly string[];
  readonly tags: readonly string[];
  readonly tier: 'correctness' | 'interaction' | 'stress';
  readonly document: ThreeDDocument;
  readonly operation: BooleanOperation;
  readonly expectation: ThreeDGeometryExpectation;
}

export const PRINTABLE_TOLERANCE_V1 = {
  coordinateQuantumMm: 1e-5,
  minimumTriangleAreaSquaredMm: 1e-10,
  minimumVolumeMm3: 1e-8,
} as const;
