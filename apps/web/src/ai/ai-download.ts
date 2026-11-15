const CODE_FORMATS: Record<string, readonly [string, string]> = {
  html: ['html', 'text/html'],
  htm: ['html', 'text/html'],
  javascript: ['js', 'text/javascript'],
  js: ['js', 'text/javascript'],
  typescript: ['ts', 'text/plain'],
  ts: ['ts', 'text/plain'],
  jsx: ['jsx', 'text/plain'],
  tsx: ['tsx', 'text/plain'],
  python: ['py', 'text/x-python'],
  py: ['py', 'text/x-python'],
  json: ['json', 'application/json'],
  csv: ['csv', 'text/csv'],
  css: ['css', 'text/css'],
  markdown: ['md', 'text/markdown'],
  md: ['md', 'text/markdown'],
  yaml: ['yaml', 'text/yaml'],
  yml: ['yml', 'text/yaml'],
  xml: ['xml', 'application/xml'],
  svg: ['svg', 'image/svg+xml'],
  sql: ['sql', 'text/plain'],
  cpp: ['cpp', 'text/plain'],
  c: ['c', 'text/plain'],
  ino: ['ino', 'text/plain'],
  java: ['java', 'text/plain'],
  rust: ['rs', 'text/plain'],
  rs: ['rs', 'text/plain'],
  go: ['go', 'text/plain'],
  bash: ['sh', 'text/plain'],
  sh: ['sh', 'text/plain'],
  text: ['txt', 'text/plain'],
  plaintext: ['txt', 'text/plain'],
  txt: ['txt', 'text/plain'],
};

export function codeDownloadFormat(language: string, code: string): { name: string; mime: string } {
  const key = language.toLowerCase().replace(/^language-/, '');
  const inferred = !key && /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(code) ? 'html' : key;
  const [extension, mime] = Object.hasOwn(CODE_FORMATS, inferred)
    ? CODE_FORMATS[inferred]!
    : ['txt', 'text/plain'];
  return {
    name: extension === 'html' ? 'index.html' : 'code.' + extension,
    mime: mime + ';charset=utf-8',
  };
}

/** Explicit local download only. Never insert generated HTML/SVG into the page. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Allow native mobile/browser download handling to consume the Blob first.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
