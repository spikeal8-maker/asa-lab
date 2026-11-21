const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const CSV_SEPARATORS = [',', ';', '\t'] as const;
type Separator = (typeof CSV_SEPARATORS)[number];
type CsvError = 'encoding' | 'invalid' | 'ambiguous' | 'limit';

export type CsvText = { text: string } | { error: CsvError };

function parseRows(text: string, separator?: Separator): string[][] | 'invalid' | 'limit' {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start';

  function finishField(): void {
    row.push(field);
    field = '';
    state = 'start';
  }
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (state === 'quoted') {
      if (character !== '"') field += character;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else state = 'closed';
      continue;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishField();
      rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) return 'limit';
    } else if (character === separator) {
      finishField();
      if (row.length >= MAX_COLUMNS) return 'limit';
    } else if (state === 'closed') return 'invalid';
    else if (character === '"') {
      if (state !== 'start') return 'invalid';
      state = 'quoted';
    } else {
      field += character;
      state = 'unquoted';
    }
  }
  if (state === 'quoted') return 'invalid';
  if (state !== 'start' || row.length) {
    finishField();
    rows.push(row);
  }
  return rows.length > MAX_ROWS ? 'limit' : rows;
}

/** Read all cells as strings. Formula-looking values, dates and IDs remain literal. */
export function extractCsvText(bytes: Uint8Array): CsvText {
  let source: string;
  try {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return { error: 'encoding' };
  }
  if (!source.trim()) return { error: 'invalid' };
  for (const character of source) {
    const code = character.codePointAt(0)!;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
      return { error: 'invalid' };
  }

  const candidates: { separator: Separator; rows: string[][] }[] = [];
  let limit = false;
  let sawMultipleColumns = false;
  for (const separator of CSV_SEPARATORS) {
    const rows = parseRows(source, separator);
    if (rows === 'limit') limit = true;
    if (!Array.isArray(rows)) continue;
    if (rows.some((row) => row.length > 1)) sawMultipleColumns = true;
    if (rows[0]!.length > 1 && rows.every((row) => row.length === rows[0]!.length))
      candidates.push({ separator, rows });
  }
  if (candidates.length > 1) return { error: 'ambiguous' };
  const match = candidates[0];
  // A broken multi-column table must not silently become one column of text.
  if (!match && limit) return { error: 'limit' };
  if (!match && sawMultipleColumns) return { error: 'invalid' };
  const rows = match?.rows ?? parseRows(source);
  if (!Array.isArray(rows)) return { error: rows };
  const separator = match?.separator === '\t' ? 'табуляция' : (match?.separator ?? 'одна колонка');
  return {
    text: [
      `Таблица CSV · разделитель ${separator} · ${rows.length} строк · ${rows[0]!.length} столбцов. Ячейки — текстовые данные.`,
      ...rows.map((row, index) => `Строка ${index + 1}: ${JSON.stringify(row)}`),
    ].join('\n'),
  };
}
