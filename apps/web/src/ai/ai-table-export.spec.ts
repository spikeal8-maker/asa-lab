import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { markdownTables } from './ai-markdown-tables';
import { exportCsv, exportXlsx } from './ai-table-export';

describe('tabular downloads', () => {
  it('keeps plain Markdown outside spreadsheets and parses table cells visibly', () => {
    expect(markdownTables('A paragraph with | a separator')).toEqual([]);
    expect(markdownTables('| Код | Заметка |\n| --- | --- |\n| 0007 | **да** |')).toEqual([
      [
        ['Код', 'Заметка'],
        ['0007', 'да'],
      ],
    ]);
    expect(markdownTables('| Заголовок |\n| --- |\n| ' + 'a'.repeat(32768) + ' |')).toEqual([]);
  });

  it('writes separate OOXML worksheets and preserves formula-looking strings as literal cells', async () => {
    const blob = await exportXlsx([
      [
        ['Артикул', 'Число'],
        ['0007', '=1+2'],
      ],
      [
        ['Длинный ID', 'Примечание'],
        ['12345678901234567', 'А & <Б>\r\n_x000A_'],
      ],
    ]);
    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(strFromU8(archive['xl/workbook.xml']!)).toContain('Таблица 2');
    const first = strFromU8(archive['xl/worksheets/sheet1.xml']!);
    expect(first).toContain('r="A2" t="inlineStr"');
    expect(first).toContain('>0007<');
    expect(first).toContain('>=1+2<');
    expect(first).not.toContain('<f>');
    const second = strFromU8(archive['xl/worksheets/sheet2.xml']!);
    expect(second).toContain('>12345678901234567<');
    expect(second).toContain('А &amp; &lt;Б&gt;&#13;\n_x005F_x000A_');
    expect(Object.keys(archive).some((path) => /externalLinks|vbaProject/.test(path))).toBe(false);
  });

  it('writes CSV profiles with escaped quotes, embedded newlines and protected formulas', async () => {
    const table = [
      ['Текст', 'Код', 'Сумма'],
      ['цитата "А"\nстрока', '007', '  ＝1+2'],
    ];
    const exchange = exportCsv(table, 'csv');
    const excel = exportCsv(table, 'csv-excel');
    expect(await exchange.text()).toBe(
      '"Текст","Код","Сумма"\r\n"цитата ""А""\nстрока","007","\'  ＝1+2"\r\n',
    );
    expect(await excel.text()).toBe(
      '"Текст";"Код";"Сумма"\r\n"цитата ""А""\nстрока";"007";"\'  ＝1+2"\r\n',
    );
    expect([...new Uint8Array(await excel.arrayBuffer()).slice(0, 3)]).toEqual([239, 187, 191]);
    expect([...new Uint8Array(await exchange.arrayBuffer()).slice(0, 3)]).not.toEqual([
      239, 187, 191,
    ]);
  });
});
