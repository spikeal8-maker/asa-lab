import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { markdownTables, parseTypedTable } from './ai-markdown-tables';
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

  it('accepts explicitly typed cells and fails closed for broken dates and unsafe data', async () => {
    const table = parseTypedTable(
      '{"rows":[["Код","Сумма","Готово","Дата"],["0007",-1.25,true,{"date":"2026-11-14"}]]}',
    );
    expect(table).not.toBeNull();
    for (const cell of [
      '{"date":"2026-02-29"}',
      '{"date":"1899-01-01"}',
      '{"date":"2026-01-01","formula":true}',
      '{"formula":"1+2"}',
      '1e999',
      '1e308',
      '-1e308',
      '2.225e-308',
      '-2.225e-308',
      '5e-324',
      '12345678901234567',
      'null',
      '[]',
    ]) {
      expect(parseTypedTable('{"rows":[["Значение"],[' + cell + ']]}')).toBeNull();
    }
    expect(parseTypedTable('{"rows":[[1,2],[1,2]]}')).toBeNull();
    expect(parseTypedTable('{"rows":[["A","B"],[1]]}')).toBeNull();
    expect(
      parseTypedTable(
        '{"rows":[["Число"],[0],[2.2251e-308],[-2.2251e-308],[9.99999999999999e307],[-9.99999999999999e307]]}',
      ),
    ).toHaveLength(6);
    const workbook = await exportXlsx([table!]);
    const zip = unzipSync(new Uint8Array(await workbook.arrayBuffer()));
    const contents = strFromU8(zip['xl/worksheets/sheet1.xml']!);
    expect(contents).toContain('<c r="B2"><v>-1.25</v></c>');
    expect(contents).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(contents).toContain('<c r="D2" s="1"><v>46340</v></c>');
    expect(strFromU8(zip['xl/styles.xml']!)).toContain('yyyy-mm-dd');
  });

  it('preserves whole negative decimal cells while guarding formula-like text', async () => {
    const table = [['-2', '-0.5', '-0,5', '-001', '-1+2', ' -1', '-1e2', '-1\n']];
    const csv = exportCsv(table, 'csv');
    expect(await csv.text()).toBe(
      ['-2', '-0.5', '-0,5', "'-001", "'-1+2", "' -1", "'-1e2", "'-1\n"]
        .map((cell) => '"' + cell + '"')
        .join(',') + '\r\n',
    );
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
