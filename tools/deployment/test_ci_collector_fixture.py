"""Exercise real collector imports from the packaged disposable release root."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tools.deployment.ci_collector_fixture import copy_collector_fixture


class CollectorFixtureTest(unittest.TestCase):
    def test_packaged_collector_loads_its_real_database_contract(self):
        source = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix='asa-collector-fixture-') as directory:
            root = Path(directory)
            copy_collector_fixture(source, root)
            contract = root / 'apps/api/src/database-diagnostic-contract.json'
            self.assertEqual(contract.read_bytes(), (source / contract.relative_to(root)).read_bytes())
            program = (
                'import json,sys; from pathlib import Path; '
                'sys.path.insert(0, sys.argv[1]); import collect_logs; '
                'assert collect_logs.DATABASE_DIAGNOSTICS == '
                'json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))'
            )
            result = subprocess.run([sys.executable, '-I', '-B', '-c', program,
                                     str(root / 'tools'), str(contract)],
                                    cwd=root, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            # The regression must actually require the packaged file, rather
            # than accidentally importing the collector from the checkout.
            contract.unlink()
            missing = subprocess.run([sys.executable, '-I', '-B', '-c', program,
                                      str(root / 'tools'), str(contract)],
                                     cwd=root, capture_output=True, text=True, timeout=15)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn('database-diagnostic-contract.json', missing.stderr)
