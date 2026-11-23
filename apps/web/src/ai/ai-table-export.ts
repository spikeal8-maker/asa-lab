import type { MarkdownTable, TableCell } from './ai-markdown-tables';

export type CsvProfile = 'csv' | 'csv-excel';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function quoteCsv(value: TableCell): string {
  const cell = typeof value === 'object' ? value.date : String(value);
  const leading = cell.trimStart().normalize('NFKC');
  const negativeDecimal = /^-(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?$/u.test(cell);
  const protectedText =
    (!negativeDecimal && /^[=+@-]/u.test(leading)) ||
    ['\t', '\r', '\n'].some((prefix) => cell.startsWith(prefix))
      ? "'" + cell
      : cell;
  return '"' + protectedText.replaceAll('"', '""') + '"';
}

export function exportCsv(table: MarkdownTable, profile: CsvProfile): Blob {
  const excel = profile === 'csv-excel';
  const delimiter = excel ? ';' : ',';
  const text = table.map((row) => row.map(quoteCsv).join(delimiter)).join('\r\n') + '\r\n';
  return new Blob([excel ? '\ufeff' + text : text], { type: 'text/csv;charset=utf-8' });
}

function escapeXml(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    const legal =
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000;
    return legal ? character : '\ufffd';
  })
    .join('')
    .replace(/_x[0-9a-f]{4}_/giu, (token) => '_x005F_' + token.slice(1))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;');
}

function cellColumn(index: number): string {
  let column = '';
  while (index >= 0) {
    column = String.fromCharCode(65 + (index % 26)) + column;
    index = Math.floor(index / 26) - 1;
  }
  return column;
}

function cellXml(reference: string, value: TableCell): string {
  if (typeof value === 'string')
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
  const epoch = Date.UTC(1899, 11, 31);
  const days = (Date.parse(value.date + 'T00:00:00Z') - epoch) / 86_400_000;
  // Excel reserves serial 60 for its historical fictitious leap day.
  return `<c r="${reference}" s="1"><v>${days >= 60 ? days + 1 : days}</v></c>`;
}

/** OOXML explicit values, never formulas. ZIP compression stays lazy and local. */
export async function exportXlsx(tables: readonly MarkdownTable[]): Promise<Blob> {
  const { strToU8, zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, xml: string) => {
    files[path] = strToU8('<?xml version="1.0" encoding="UTF-8"?>' + xml);
  };
  const sheetIds = tables.map((_, index) => index + 1);
  add(
    '[Content_Types].xml',
    `<Types xmlns="${PACKAGE}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetIds.map((id) => `<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  );
  add(
    '_rels/.rels',
    `<Relationships xmlns="${PACKAGE}/relationships"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    'xl/workbook.xml',
    `<workbook xmlns="${SHEET}" xmlns:r="${OFFICE}"><sheets>${sheetIds.map((id) => `<sheet name="Таблица ${id}" sheetId="${id}" r:id="rId${id}"/>`).join('')}</sheets></workbook>`,
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="${PACKAGE}/relationships">${sheetIds.map((id) => `<Relationship Id="rId${id}" Type="${OFFICE}/worksheet" Target="worksheets/sheet${id}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${OFFICE}/styles" Target="styles.xml"/></Relationships>`,
  );
  add(
    'xl/styles.xml',
    `<styleSheet xmlns="${SHEET}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font/></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  tables.forEach((table, index) => {
    const rows = table.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row.map((value, column) => cellXml(cellColumn(column) + rowNumber, value));
      return `<row r="${rowNumber}">${cells.join('')}</row>`;
    });
    const columns = Array.from(
      new Set(
        table.flatMap((row) =>
          row.flatMap((cell, column) => (typeof cell === 'object' ? [column + 1] : [])),
        ),
      ),
    );
    const columnWidths = columns.length
      ? '<cols>' +
        columns
          .sort((a, b) => a - b)
          .map((column) => `<col min="${column}" max="${column}" width="13" customWidth="1"/>`)
          .join('') +
        '</cols>'
      : '';
    add(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet xmlns="${SHEET}">${columnWidths}<sheetData>${rows.join('')}</sheetData></worksheet>`,
    );
  });
  return new Blob([new Uint8Array(zipSync(files))], { type: MIME });
}
