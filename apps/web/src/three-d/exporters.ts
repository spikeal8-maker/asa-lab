import type { ThreeDDocument } from '@asa-lab/three-d';

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zа-яё0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'asa-3d'
  );
}

function download(data: BlobPart, mime: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  window.document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // The browser consumes a Blob download asynchronously, after click returns.
    // Revoking on the next task races that handoff (especially in a busy tab).
    // Bound retention; unloading the document also releases its object URLs.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function downloadThreeDJson(document: ThreeDDocument, title: string): void {
  download(
    JSON.stringify(document, null, 2),
    'application/json',
    `${safeFileName(title)}.asa3d.json`,
  );
}

export function downloadThreeDStl(result: DataView<ArrayBuffer>, title: string): void {
  download(result, 'model/stl', `${safeFileName(title)}.stl`);
}
