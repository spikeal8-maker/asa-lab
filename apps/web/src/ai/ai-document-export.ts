import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Content } from 'pdfmake/interfaces';

interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  children?: MarkdownNode[];
}
interface Block {
  text: string;
  kind: 'paragraph' | 'heading' | 'code' | 'table';
  depth?: number;
  rows?: string[][];
}
function text(node: MarkdownNode): string {
  if (node.type === 'html') return '';
  if (node.type === 'break') return '\n';
  return node.value ?? node.children?.map(text).join('') ?? '';
}
function blocks(content: string): Block[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(content) as MarkdownNode;
  const result: Block[] = [];
  function visit(node: MarkdownNode, prefix = ''): void {
    if (node.type === 'html') return;
    if (node.type === 'table') {
      const rows = node.children?.map((row) => row.children?.map(text) ?? []) ?? [];
      result.push({ kind: 'table', text: rows.map((row) => row.join(' | ')).join('\n'), rows });
    } else if (node.type === 'list') {
      node.children?.forEach((item, index) =>
        item.children?.forEach((child, part) =>
          visit(
            child,
            part === 0 ? (node.ordered ? `${(node.start ?? 1) + index}. ` : '• ') : '  ',
          ),
        ),
      );
    } else if (node.type === 'blockquote' || node.type === 'root') {
      node.children?.forEach((child) => visit(child, prefix));
    } else if (node.type === 'heading') {
      result.push({ kind: 'heading', depth: node.depth ?? 1, text: prefix + text(node) });
    } else if (node.type === 'code') {
      result.push({ kind: 'code', text: node.value ?? '' });
    } else if (node.type === 'thematicBreak') {
      result.push({ kind: 'paragraph', text: '────────────────' });
    } else {
      const value = prefix + text(node);
      if (value.trim()) result.push({ kind: 'paragraph', text: value });
    }
  }
  visit(root);
  return result.length ? result : [{ kind: 'paragraph', text: content }];
}

/** Everything is generated locally; no document content or font URL leaves the browser. */
export async function exportAnswer(
  content: string,
  format: 'pdf' | 'docx' | 'md' | 'txt',
): Promise<Blob> {
  if (format === 'md') return new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const parsed = blocks(content);
  if (format === 'txt')
    return new Blob([parsed.map((block) => block.text).join('\n\n')], {
      type: 'text/plain;charset=utf-8',
    });
  if (format === 'pdf') {
    const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);
    pdfMake.addVirtualFileSystem(fonts);
    const body: Content[] = parsed.map((block): Content => {
      if (block.kind === 'table' && block.rows?.length) {
        const columns = Math.max(...block.rows.map((row) => row.length));
        return {
          table: {
            headerRows: 1,
            widths: Array.from({ length: columns }, () => '*'),
            body: block.rows.map((row) =>
              Array.from({ length: columns }, (_, i) => ({ text: row[i] ?? '', fontSize: 9 })),
            ),
          },
          layout: 'lightHorizontalLines',
          margin: [0, 5, 0, 12],
        };
      }
      return {
        text: block.text,
        fontSize:
          block.kind === 'heading'
            ? Math.max(12, 22 - (block.depth ?? 1) * 2)
            : block.kind === 'code'
              ? 9
              : 11,
        bold: block.kind === 'heading',
        margin: [0, block.kind === 'heading' ? 8 : 0, 0, 10],
        ...(block.kind === 'code' ? { background: '#f3f3f3' } : {}),
      };
    });
    return pdfMake
      .createPdf({
        content: body,
        pageMargins: [40, 40, 40, 40],
        defaultStyle: { font: 'Roboto' },
        info: { title: 'Ответ ASA Lab', author: 'ASA Lab' },
      })
      .getBlob();
  }
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    HeadingLevel,
    WidthType,
  } = await import('docx');
  const headings = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  const children = parsed.map((block) => {
    if (block.kind === 'table' && block.rows?.length)
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map(
          (row, index) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun({ text: cell, bold: index === 0 })] }),
                    ],
                  }),
              ),
            }),
        ),
      });
    return new Paragraph({
      ...(block.kind === 'heading'
        ? { heading: headings[Math.min(5, (block.depth ?? 1) - 1)]! }
        : {}),
      spacing: { after: 180 },
      children: block.text.split('\n').flatMap((line, index) => [
        new TextRun({
          text: line,
          ...(index ? { break: 1 } : {}),
          ...(block.kind === 'code' ? { font: 'Consolas', size: 18 } : {}),
        }),
      ]),
    });
  });
  return Packer.toBlob(
    new Document({ creator: 'ASA Lab', title: 'Ответ ASA Lab', sections: [{ children }] }),
  );
}
