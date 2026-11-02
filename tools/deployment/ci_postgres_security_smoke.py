"""CI-only owned PostgreSQL volume: root stepdown, restart and non-root reuse."""
import os
import subprocess
import sys
import time
import uuid


def run(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def main(image):
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise RuntimeError('Disposable GitHub runner only; do not run against host data')
    name = 'asa-security-pg-' + uuid.uuid4().hex
    volume = name + '-data'
    run('volume', 'create', volume)
    try:
        for phase, user in [('fresh-root-stepdown', None), ('existing-root-stepdown', None), ('existing-nonroot', 'postgres')]:
            args = ['run', '-d', '--name', name, '--network', 'none', '-e', 'POSTGRES_PASSWORD=disposable-ci-only',
                    '-e', 'POSTGRES_DB=asa_security', '--mount', f'type=volume,source={volume},target=/var/lib/postgresql/data']
            if user:
                args += ['--user', user]
            run(*args, image)
            for attempt in range(90):
                ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'postgres', '-d', 'asa_security'], capture_output=True)
                if ready.returncode == 0:
                    break
                if attempt == 89:
                    raise RuntimeError(phase + ': PostgreSQL readiness timed out')
                time.sleep(1)
            status = run('exec', name, 'cat', '/proc/1/status')
            effective_uid = next(line.split()[2] for line in status.splitlines() if line.startswith('Uid:'))
            expected_uid = run('exec', name, 'id', '-u', 'postgres')
            assert effective_uid == expected_uid != '0', phase + ': server failed to drop root'
            sql = ['exec', '-u', 'postgres', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'asa_security', '-Atc']
            if phase == 'fresh-root-stepdown':
                run(*sql, "CREATE TABLE security_persistence (value text); INSERT INTO security_persistence VALUES ('retained-across-restart')")
            assert run(*sql, 'SELECT value FROM security_persistence') == 'retained-across-restart', phase + ': data lost'
            gosu_version = run('exec', name, 'gosu', '--version')
            assert gosu_version.startswith('1.19') and 'go1.27.3' in gosu_version, 'Unexpected gosu version/compiler'
            run('stop', '--time', '20', name)
            run('rm', name)
            print(phase + ': PASS', flush=True)
    finally:
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run('volume', 'rm', volume)


if __name__ == '__main__':
    main(sys.argv[1])
