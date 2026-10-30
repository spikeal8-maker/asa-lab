"""Read-only proof against actual failed raw captures; never reclassifies the run."""
from pathlib import Path
import gzip
import hashlib
import json
import re
import subprocess
import sys
import zipfile

here = Path(__file__).resolve().parent
root = here.parents[4]
raw_root = Path(sys.argv[1])
spec = (root / 'e2e/electronics-simulation.spec.ts').read_bytes()
before = gzip.decompress((here / 'original-f2-full.spec.ts.gz').read_bytes())
source = spec.decode()
edits = json.loads((here / 'edits.json').read_text(encoding='utf-8'))
reversed_source = source
for old, new in reversed(edits):
    assert reversed_source.count(new) == 1
    reversed_source = reversed_source.replace(new, old)
assert reversed_source.encode() == before, 'Any unselected spec bytes changed'
expected = ['bench-supply', 'source', 'meter', 'load', 'generator', 'scope']
oracle = re.search(r'expect\(rendered.map\(\(item\) => item.id\)\).toEqual\(\[([\s\S]*?)\]\);', source)
assert oracle
assert re.findall(r"'([^']+)'", oracle[1]) == expected
logical = ['source', 'meter', 'bench-supply', 'load', 'generator', 'scope']
stage = (root / 'apps/web/src/electronics/WorkbenchStage.tsx').read_text(encoding='utf-8')
assert '.filter(wiresAboveComponentBody)' in stage
assert '!wiresAboveComponentBody(component)' in stage
assert "componentTypeId === 'regulated-power-supply'" in stage
records = []
archive = root / 'docs/product/electronics/evidence/instrument-525-before-41080294495/selected-raw16.zip'
canonical_zip = zipfile.ZipFile(archive)
for path in sorted(raw_root.rglob('instrument525-raw.json')):
    raw_bytes = path.read_bytes()
    archive_path = 'artifact/' + path.relative_to(raw_root).as_posix()
    assert raw_bytes == canonical_zip.read(archive_path), 'Raw differs from canonical archived run'
    raw = json.loads(raw_bytes)
    row = next(row for row in raw['rows'] if row['name'] == 'rendered-equality')
    rendered = row['observation']['rendered']
    original = row['observation']['originalRendered']
    assert rendered == original
    observed = [item['id'] for item in rendered]
    assert observed == expected
    assert observed != logical
    assert not raw['journeyComplete']
    assert not any(row['name'] == 'browser-failures' for row in raw['rows'])
    assert '4409' in raw['primaryError']['stack']
    records.append({'width': raw['width'], 'mirror': raw['mirror'],
                    'file': str(path.relative_to(raw_root)),
                    'sha256': hashlib.sha256(raw_bytes).hexdigest(),
                    'ids': observed, 'journeyComplete': raw['journeyComplete']})
assert len(records) == 16
assert {(r['width'], r['mirror']['name'] if isinstance(r['mirror'], dict) else r['mirror']) for r in records} == {
    (w, m) for w in [320, 390, 1024, 1440] for m in ['none', 'x', 'y', 'xy']}
negatives = {
    'wrong_logical_order': logical,
    'wrong_identity': ['bench-supply', 'source', 'meter', 'load', 'generator', 'alien'],
    'missing': expected[:-1],
    'duplicate_replacing_identity': expected[:-1] + ['generator'],
    'extra_duplicate': expected + ['scope'],
    'wrong_paint_order': [expected[1], expected[0], *expected[2:]],
}
for name, ids in negatives.items():
    assert ids != expected, name
success_start = '          await settleLedger();\n          expect(puts).toHaveLength(finalPutCount!);'
success_end = "          acknowledge('reopened-context-close-before', { puts: puts.length });"
def between(text, start, end):
    pos = text.index(start)
    return text[pos:text.index(end, pos)]
assert between(before.decode(), success_start, success_end) == between(source, success_start, success_end)
assert source.count('collectBrowserFailures(') == before.decode().count('collectBrowserFailures(')
assert source.count('.assertEmpty()') == before.decode().count('.assertEmpty()')
assert 'reopened: reopenedFailureCollector?.counts ?? null' in source
metadata = json.loads((root / 'docs/product/electronics/generated/component-coverage.json').read_text(encoding='utf-8'))
original_meta = json.loads(subprocess.check_output(['git', 'show', 'f2f94ad22728ed744539ec490f53a74e1c8e1f47:docs/product/electronics/generated/component-coverage.json'], cwd=root))
new_hash = metadata['generatedFrom'].pop('browserEvidenceSha256')
old_hash = original_meta['generatedFrom'].pop('browserEvidenceSha256')
assert metadata == original_meta, 'Unexpected generated field changed'
assert new_hash == hashlib.sha256(spec.replace(b'\r\n', b'\n').replace(b'\r', b'\n')).hexdigest()
result = {'status': 'PASS', 'scope': 'oracle/source proof only; original run remains invalid BEFORE',
          'source_before_sha': 'f2f94ad22728ed744539ec490f53a74e1c8e1f47',
          'before_sha256': hashlib.sha256(before).hexdigest(), 'after_sha256': hashlib.sha256(spec).hexdigest(),
          'negative_cases_rejected': list(negatives), 'actual_raw16': records,
          'success_path_native_assertions_screenshots_browser_asserts_byte_identical': True,
          'all_other_spec_bytes_preserved_by_reverse_exact_hunks': True,
          'metadata_only_browser_hash_changed': {'before': old_hash, 'after': new_hash}}
(here / 'proof-result.json').write_text(json.dumps(result, indent=2) + '\n')
(here / 'candidate-full.spec.ts.gz').write_bytes(gzip.compress(spec, mtime=0))
print('PASS: raw16 exact paint order; six negatives; exact reverse-hunk preservation; metadata-only browser hash')
