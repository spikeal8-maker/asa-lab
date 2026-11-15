import { CANVAS_ANNOTATION_LIMITS } from '@asa-lab/electronics';
import type { SchematicAnnotation, SchematicDocument } from '../api';

export { CANVAS_ANNOTATION_LIMITS };

export function annotationOnlyDocumentChange(
  left: SchematicDocument,
  right: SchematicDocument,
): boolean {
  const electrical = (document: SchematicDocument) => {
    const rest = { ...document };
    delete rest.annotations;
    return { ...rest, schemaVersion: document.schemaVersion === 5 ? 4 : document.schemaVersion };
  };
  return JSON.stringify(electrical(left)) === JSON.stringify(electrical(right));
}

export function retainAnnotationVersion(
  current: SchematicDocument,
  next: SchematicDocument,
): SchematicDocument {
  return current.schemaVersion === 5 && next.schemaVersion !== 5
    ? { ...next, schemaVersion: 5, annotations: next.annotations ?? [] }
    : next;
}

/** Metadata edits keep pending electrical observations bound to the same object. */
export function createAnnotationRuntimeDocumentSelector() {
  let previous: SchematicDocument | null = null;
  let runtime: SchematicDocument | null = null;
  return (document: SchematicDocument | null): SchematicDocument | null => {
    if (document === previous) return runtime;
    if (previous && document && annotationOnlyDocumentChange(previous, document)) {
      previous = document;
      return runtime;
    }
    previous = document;
    if (document?.schemaVersion === 5) {
      const electrical = { ...document };
      delete electrical.annotations;
      runtime = { ...electrical, schemaVersion: 4 };
    } else runtime = document;
    return runtime;
  };
}

export function setDocumentAnnotations(
  document: SchematicDocument,
  annotations: SchematicAnnotation[],
): SchematicDocument {
  return { ...document, schemaVersion: 5, annotations };
}

export function annotationBounds(annotations: readonly SchematicAnnotation[]) {
  if (!annotations.length) return null;
  return annotations.reduce(
    (bounds, annotation) => ({
      minX: Math.min(bounds.minX, annotation.position.x),
      minY: Math.min(bounds.minY, annotation.position.y),
      maxX: Math.max(bounds.maxX, annotation.position.x + annotation.size.width),
      maxY: Math.max(bounds.maxY, annotation.position.y + annotation.size.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function boundedAnnotation(annotation: SchematicAnnotation): SchematicAnnotation {
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(maximum, Math.max(minimum, value));
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  return {
    ...annotation,
    text: annotation.text
      // JSONB text cannot contain NUL; other unsupported controls are removed too.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .slice(0, CANVAS_ANNOTATION_LIMITS.textLength)
      .replace(/[\uD800-\uDFFF]/gu, '\uFFFD'),
    position: {
      x: clamp(
        finite(annotation.position.x, 0),
        -CANVAS_ANNOTATION_LIMITS.coordinate,
        CANVAS_ANNOTATION_LIMITS.coordinate,
      ),
      y: clamp(
        finite(annotation.position.y, 0),
        -CANVAS_ANNOTATION_LIMITS.coordinate,
        CANVAS_ANNOTATION_LIMITS.coordinate,
      ),
    },
    size: {
      width: clamp(
        finite(annotation.size.width, 240),
        CANVAS_ANNOTATION_LIMITS.minWidth,
        CANVAS_ANNOTATION_LIMITS.maxSize,
      ),
      height: clamp(
        finite(annotation.size.height, 96),
        CANVAS_ANNOTATION_LIMITS.minHeight,
        CANVAS_ANNOTATION_LIMITS.maxSize,
      ),
    },
    fontSize: Math.round(
      clamp(
        finite(annotation.fontSize, 18),
        CANVAS_ANNOTATION_LIMITS.minFontSize,
        CANVAS_ANNOTATION_LIMITS.maxFontSize,
      ),
    ),
  };
}
