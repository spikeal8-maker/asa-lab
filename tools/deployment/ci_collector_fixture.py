"""Package the real collector and its data contract for disposable release CI."""

import shutil


def copy_collector_fixture(source, root):
    (root / 'tools').mkdir()
    for file in ('collect_logs.py', 'collect-windows-logs.ps1', 'collector-scheduler.ps1', 'log_collector.py'):
        shutil.copyfile(source / 'tools' / file, root / 'tools' / file)
    shutil.copytree(source / 'tools/deployment', root / 'tools/deployment', ignore=shutil.ignore_patterns('__pycache__'))
    contract = 'apps/api/src/database-diagnostic-contract.json'
    (root / contract).parent.mkdir(parents=True)
    shutil.copyfile(source / contract, root / contract)
