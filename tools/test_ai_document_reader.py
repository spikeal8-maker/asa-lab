"""Real binary fixture regression; run with the document-reader Python environment."""
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reader', ROOT / 'apps/api/src/ai-attachments/document-reader.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
FIXTURES = ROOT / 'tests/ai-attachments/documents'

class DocumentReading(unittest.TestCase):
    def test_actual_pdf_pages(self):
        text = reader.extract((FIXTURES / 'review.pdf').read_bytes(), 'pdf')
        self.assertIn('ALPHA-742', text)
        self.assertIn('OMEGA-913', text)
        self.assertIn('[Страница 2]', text)

    def test_actual_docx_table_and_late_fact(self):
        text = reader.extract((FIXTURES / 'review.docx').read_bytes(), 'docx')
        self.assertIn('Контрольный код: КЕДР-742', text)
        self.assertIn('314159', text)
        self.assertIn('последний абзац', text)
        self.assertIn('[Таблица:', text)

    def test_actual_xlsx_all_sheets_addresses_and_cached_formula(self):
        text = reader.extract((FIXTURES / 'review.xlsx').read_bytes(), 'xlsx')
        for expected in ('План', 'Итог', 'A1\tКонтроль', 'B2\t271828', 'Формула: SUM(B2:B3)', 'A8\tКОНЕЦ-913'):
            self.assertIn(expected, text)

    def test_scanned_pdf_is_not_claimed_read(self):
        with self.assertRaisesRegex(ValueError, 'OCR_REQUIRED'):
            reader.extract((FIXTURES / 'no-text.pdf').read_bytes(), 'pdf')

    def test_archive_bomb_is_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('word/document.xml', b' ' * (reader.MAX_XML + 1))
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_LIMIT'):
            reader.extract(buffer.getvalue(), 'docx')

    def test_external_sheet_is_not_fetched(self):
        with zipfile.ZipFile(FIXTURES / 'review.xlsx') as source:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as target:
                for item in source.infolist():
                    data = source.read(item.filename)
                    if item.filename == 'xl/_rels/workbook.xml.rels':
                        data = data.replace(b'Target=', b'TargetMode="External" Target=')
                    target.writestr(item.filename, data)
        with self.assertRaisesRegex(ValueError, 'SHEET_INVALID'):
            reader.extract(buffer.getvalue(), 'xlsx')

if __name__ == '__main__':
    unittest.main()
