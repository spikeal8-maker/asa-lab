import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
}

export type MarkdownTable = string[][];
const parser = unified().use(remarkParse).use(remarkGfm);

function cellText(node: MarkdownNode): string {
  if (node.type === 'html') return '';
  if (node.type === 'break') return '\n';
  return node.value ?? node.alt ?? node.children?.map(cellText).join('') ?? '';
}

export function markdownTables(content: string): MarkdownTable[] {
  if (content.length > 250_000 || !content.includes('|')) return [];
  const tables: MarkdownTable[] = [];
  let cells = 0;
  let valid = true;
  function collect(node: MarkdownNode): void {
    if (!valid) return;
    if (node.type !== 'table') {
      node.children?.forEach(collect);
      return;
    }
    const rows = node.children ?? [];
    const columns = rows[0]?.children?.length ?? 0;
    if (
      !columns ||
      columns > 256 ||
      rows.length > 10_000 ||
      tables.length >= 20 ||
      rows.length * columns + cells > 50_000 ||
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
