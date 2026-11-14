import type { MarkdownTable } from './ai-markdown-tables';

export type CsvProfile = 'csv' | 'csv-excel';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function quoteCsv(cell: string): string {
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

/** OOXML with inline string cells only. ZIP compression stays lazy and local. */
export async function exportXlsx(tables: readonly MarkdownTable[]): Promise<Blob> {
  const { strToU8, zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, xml: string) => {
    files[path] = strToU8('<?xml version="1.0" encoding="UTF-8"?>' + xml);
  };
  const sheetIds = tables.map((_, index) => index + 1);
  add(
    '[Content_Types].xml',
    `<Types xmlns="${PACKAGE}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetIds.map((id) => `<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
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
    `<Relationships xmlns="${PACKAGE}/relationships">${sheetIds.map((id) => `<Relationship Id="rId${id}" Type="${OFFICE}/worksheet" Target="worksheets/sheet${id}.xml"/>`).join('')}</Relationships>`,
  );
  tables.forEach((table, index) => {
    const rows = table.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row.map(
        (value, column) =>
          `<c r="${cellColumn(column)}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`,
      );
      return `<row r="${rowNumber}">${cells.join('')}</row>`;
    });
    add(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet xmlns="${SHEET}"><sheetData>${rows.join('')}</sheetData></worksheet>`,
    );
  });
  return new Blob([new Uint8Array(zipSync(files))], { type: MIME });
}
