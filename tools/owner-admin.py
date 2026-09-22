#!/usr/bin/env python3
"""Preview, grant or verify one platform administrator in the existing Docker installation."""
import argparse
import getpass
import json
from pathlib import Path
import subprocess
import sys

from deployment.contracts import Blocked, require
from deployment.system import Installation, operation_lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--email', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--grant', action='store_true')
    modes.add_argument('--verify', action='store_true')
    parser.add_argument('--account-id')
    parser.add_argument('--reason')
    args = parser.parse_args()
    mode = 'grant' if args.grant else 'verify' if args.verify else 'plan'
    require(not args.grant or (args.account_id and args.reason), 'IDENTITY',
            'Grant requires --account-id from the preview and --reason.')
    with operation_lock(args.root):
        install = Installation(args.root)
        require(not any((install.state / name).exists() for name in ('maintenance.json', 'failed-switch.json')),
                'MAINTENANCE', 'Finish pending maintenance before owner administration.')
        records = install.identity()
        install.readiness()
        require(records.get('api', {}).get('running'), 'API', 'The canonical API container must be running.')
        require(install.env.get('MIGRATION_DATABASE_URL'), 'CONNECTION', 'Private operator connection is missing.')
        source = Path(__file__).with_name('platform-admin.mjs').read_text(encoding='utf-8')
        source = source.removeprefix('#!/usr/bin/env node\n')
        # The image supplies pg; the exact reviewed script comes from this checkout.
        # The connection string is private stdin data, never process arguments or a file.
        program = source + f'\nawait ownerAdminMain(["--stdin", "--{mode}"]);\n'
        payload = {'databaseUrl': install.env['MIGRATION_DATABASE_URL'], 'email': args.email,
                   'accountId': args.account_id, 'expectedDatabase': install.env.get('POSTGRES_DB'),
                   'reason': args.reason, 'operator': getpass.getuser()}
        result = subprocess.run(['docker', 'exec', '-i', '-w', '/app', records['api']['id'],
                                 'node', '--input-type=module', '--eval', program],
                                input=json.dumps(payload), capture_output=True, text=True,
                                encoding='utf-8', timeout=90)
        if result.returncode:
            # Print only the CLI's controlled diagnostic, not arbitrary container output.
            safe = [line for line in result.stderr.splitlines() if line.startswith('platform-admin FAIL:')]
            require(False, 'OWNER_ADMIN', safe[-1] if safe else 'Owner administration did not complete; run preview to inspect current state.')
        outcome = json.loads(result.stdout)
        print(json.dumps(outcome, ensure_ascii=True))


if __name__ == '__main__':
    try:
        main()
    except (Blocked, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print('BLOCKED', getattr(error, 'code', 'OPERATOR'), str(error), file=sys.stderr)
        sys.exit(2)
