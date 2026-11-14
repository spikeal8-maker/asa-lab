import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string | null;
  lang?: string | null;
  children?: MarkdownNode[];
}

export type TableCell = string | number | boolean | { date: string };
export type MarkdownTable = TableCell[][];
export const TYPED_TABLE_LANGUAGE = 'asa-table';
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 50_000;

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || date < '1900-01-01') return false;
  const value = new Date(date + 'T00:00:00Z');
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

function validCell(cell: unknown): cell is TableCell {
  if (typeof cell === 'string') return cell.length <= 32_767;
  if (typeof cell === 'boolean') return true;
  if (typeof cell === 'number') {
    // Excel's numeric precision is 15 significant digits. Preserve larger IDs as strings.
    return Number.isFinite(cell) && Number(cell.toPrecision(15)) === cell;
  }
  if (!cell || typeof cell !== 'object' || !('date' in cell)) return false;
  return (
    Object.keys(cell).length === 1 && typeof cell.date === 'string' && isCalendarDate(cell.date)
  );
}

export function parseTypedTable(content: string): MarkdownTable | null {
  if (content.length > 250_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || !('rows' in value) || Object.keys(value).length !== 1)
    return null;
  const rows: unknown = value.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS || !Array.isArray(rows[0]))
    return null;
  const columns = rows[0].length;
  if (!columns || columns > MAX_COLUMNS || columns * rows.length > MAX_CELLS) return null;
  if (!rows.every((row) => Array.isArray(row) && row.length === columns && row.every(validCell)))
    return null;
  return rows;
}
const parser = unified().use(remarkParse).use(remarkGfm);

function cellText(node: MarkdownNode): string {
  if (node.type === 'html') return '';
  if (node.type === 'break') return '\n';
  return node.value ?? node.alt ?? node.children?.map(cellText).join('') ?? '';
}

export function markdownTables(content: string): MarkdownTable[] {
  if (
    content.length > 250_000 ||
    (!content.includes('|') && !content.includes(TYPED_TABLE_LANGUAGE))
  )
    return [];
  const tables: MarkdownTable[] = [];
  let cells = 0;
  let valid = true;
  function collect(node: MarkdownNode): void {
    if (!valid) return;
    if (node.type === 'code' && node.lang === TYPED_TABLE_LANGUAGE) {
      const table = parseTypedTable(node.value ?? '');
      if (!table || tables.length >= 20 || table.length * table[0]!.length + cells > MAX_CELLS) {
        valid = false;
        return;
      }
      cells += table.length * table[0]!.length;
      tables.push(table);
      return;
    }
    if (node.type !== 'table') {
      node.children?.forEach(collect);
      return;
    }
    const rows = node.children ?? [];
    const columns = rows[0]?.children?.length ?? 0;
    if (
      !columns ||
      columns > MAX_COLUMNS ||
      rows.length > MAX_ROWS ||
      tables.length >= 20 ||
      rows.length * columns + cells > MAX_CELLS ||
      rows.some((row) => (row.children?.length ?? 0) > columns)
    ) {
      valid = false;
      return;
    }
    const table = rows.map((row) =>
      Array.from({ length: columns }, (_, index) => {
        const cell = row.children?.[index];
        return cell ? cellText(cell) : '';
      }),
    );
    if (table.some((row) => row.some((cell) => cell.length > 32_767))) {
      valid = false;
      return;
    }
    cells += rows.length * columns;
    tables.push(table);
  }
  collect(parser.parse(content) as MarkdownNode);
  return valid ? tables : [];
}
