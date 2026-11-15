"""Bounded inert document extraction. Input stdin; JSON stdout; never follow links."""
import io
import json
import posixpath
import sys
import zipfile

MAX_CHARS = 190000
MAX_XML = 32 * 1024 * 1024

def extract(data, extension):
    from defusedxml import ElementTree as ET
    output = []
    count = 0

    def add(value):
        nonlocal count
        count += len(value) + 1
        if count > MAX_CHARS:
            raise ValueError('DOCUMENT_TEXT_LIMIT: document not read in full')
        if '\x00' in value:
            raise ValueError('DOCUMENT_INVALID_TEXT')
        output.append(value)

    if extension == 'pdf':
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError('DOCUMENT_ENCRYPTED')
        if len(reader.pages) > 100:
            raise ValueError('DOCUMENT_PAGE_LIMIT')
        for number, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ''
            if not text.strip():
                raise ValueError('DOCUMENT_OCR_REQUIRED: page ' + str(number))
            add('[Страница ' + str(number) + ']\n' + text)
        add('[Извлечён текст PDF; изображения, рукопись и визуальное расположение элементов не анализировались.]')
    else:
        archive = zipfile.ZipFile(io.BytesIO(data))
        members = archive.infolist()
        if len(members) > 2000 or sum(i.file_size for i in members) > MAX_XML:
            raise ValueError('DOCUMENT_ARCHIVE_LIMIT')
        names = set()
        for member in members:
            if member.filename in names or member.flag_bits & 1 or member.file_size > 8 * 1024 * 1024:
                raise ValueError('DOCUMENT_ARCHIVE_INVALID')
            names.add(member.filename)
            if member.filename.startswith('/') or '..' in member.filename.split('/'):
                raise ValueError('DOCUMENT_ARCHIVE_INVALID')
            if 'vbaProject' in member.filename or member.filename.endswith('.bin'):
                raise ValueError('DOCUMENT_ACTIVE_CONTENT')

        def xml(name):
            return ET.fromstring(archive.read(name), forbid_dtd=True, forbid_entities=True, forbid_external=True)

        def local(tag):
            return tag.rsplit('}', 1)[-1]

        if extension == 'docx':
            document = xml('word/document.xml')
            parents = {child: parent for parent in document.iter() for child in parent}
            paragraphs = 0
            for paragraph in document.iter():
                if local(paragraph.tag) != 'p':
                    continue
                paragraphs += 1
                line = ''.join(node.text or '' if local(node.tag) == 't' else '\t' if local(node.tag) == 'tab' else '\n' if local(node.tag) in ('br', 'cr') else '' for node in paragraph.iter())
                if line:
                    cell = parents.get(paragraph)
                    location = ''
                    if cell is not None and local(cell.tag) == 'tc':
                        row = parents.get(cell)
                        table = parents.get(row) if row is not None else None
                        if row is not None and table is not None:
                            location = '[Таблица: строка ' + str([n for n in table if local(n.tag) == 'tr'].index(row) + 1) + ', ячейка ' + str([n for n in row if local(n.tag) == 'tc'].index(cell) + 1) + '] '
                    add(location + '[Абзац ' + str(paragraphs) + '] ' + line)
            for name in sorted(names):
                if name.startswith(('word/header', 'word/footer', 'word/footnotes', 'word/endnotes')) and name.endswith('.xml'):
                    add('[' + name + '] ' + ' '.join(n.text or '' for n in xml(name).iter() if local(n.tag) == 't'))
            if not output:
                raise ValueError('DOCUMENT_EMPTY')
            add('[Извлечён текст и текст таблиц; изображения, оформление и встроенные объекты не анализировались.]')
        elif extension == 'xlsx':
            strings = []
            if 'xl/sharedStrings.xml' in names:
                strings = [''.join(n.text or '' for n in item.iter() if local(n.tag) == 't') for item in xml('xl/sharedStrings.xml')]
            relationships = {item.get('Id'): item.get('Target') for item in xml('xl/_rels/workbook.xml.rels') if item.get('TargetMode') != 'External'}
            sheets = [item for item in xml('xl/workbook.xml').iter() if local(item.tag) == 'sheet']
            if len(sheets) > 50:
                raise ValueError('DOCUMENT_SHEET_LIMIT')
            for sheet in sheets:
                target_id = next((v for k, v in sheet.attrib.items() if k.endswith('}id')), None)
                target = relationships.get(target_id)
                if not target:
                    raise ValueError('DOCUMENT_SHEET_INVALID')
                path = posixpath.normpath('xl/' + target) if not target.startswith('/') else target.lstrip('/')
                if not path.startswith('xl/worksheets/') or path not in names:
                    raise ValueError('DOCUMENT_SHEET_INVALID')
                add('[Лист: ' + sheet.get('name', '') + ']')
                for cell in xml(path).iter():
                    if local(cell.tag) != 'c':
                        continue
                    values = {local(n.tag): n.text or '' for n in cell}
                    value = values.get('v', '')
                    if cell.get('t') == 's':
                        value = strings[int(value)]
                    elif cell.get('t') == 'inlineStr':
                        value = ''.join(n.text or '' for n in cell.iter() if local(n.tag) == 't')
                    if 'f' in values:
                        value = 'Формула: ' + values['f'] + '; сохранённый результат: ' + value
                    add(cell.get('r', '?') + '\t' + value)
            add('[Числа сохранены как значения ячеек; формулы не выполнялись, изображения и форматирование не анализировались.]')
        else:
            raise ValueError('DOCUMENT_FORMAT_UNSUPPORTED')
    if not output:
        raise ValueError('DOCUMENT_EMPTY')
    return '\n'.join(output)

if __name__ == '__main__':
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
            resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
        except ImportError:
            pass
        data = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise ValueError('DOCUMENT_BYTE_LIMIT')
        print(json.dumps({'text': extract(data, sys.argv[1])}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'error': str(error)[:160]}))
        sys.exit(1)
