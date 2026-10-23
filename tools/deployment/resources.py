"""Read-only resource sizing. Never resize Docker, tune PostgreSQL or print secrets."""

import json
import re
import subprocess

from .contracts import Blocked, require


POOL_DEFAULTS = {
    'ASA_DB_POOL_MAX': 10,
    'ASA_DB_CONNECTION_TIMEOUT_MS': 5000,
    'ASA_DB_IDLE_TIMEOUT_MS': 30000,
    'ASA_DB_STATEMENT_TIMEOUT_MS': 15000,
    'ASA_DB_QUERY_TIMEOUT_MS': 15000,
}
# One additional persistent pool exists: analyticsPoolSettings(). The collector,
# maintenance/probes and other clients belong in the explicit operator reserve.
ANALYTICS_CONNECTIONS = 1
RESERVE_KEY = 'ASA_DB_OPERATOR_CONNECTION_RESERVE'


def pool_configuration(env):
    result = {}
    for key, default in {**POOL_DEFAULTS, RESERVE_KEY: 8}.items():
        raw = env.get(key, '')
        require(isinstance(raw, str) and (raw == '' or re.fullmatch(r'[0-9]+', raw)),
                'RESOURCE_CONFIG', f'{key} must be a positive integer.')
        value = int(raw) if raw else default
        require(0 < value <= 2147483647, 'RESOURCE_CONFIG', f'{key} must be between 1 and 2147483647.')
        result[key] = value
    return result


def connection_budget(configuration, database):
    maximum = int(database['maxConnections'])
    reserved = int(database['superuserReserved']) + int(database['reservedConnections'])
    usable = maximum - reserved
    application = configuration['ASA_DB_POOL_MAX'] + ANALYTICS_CONNECTIONS
    operator = configuration[RESERVE_KEY]
    return {'maxConnections': maximum, 'postgresReserved': reserved,
            'ordinarySlots': usable, 'selectedMainPool': configuration['ASA_DB_POOL_MAX'],
            'selectedAnalyticsPool': ANALYTICS_CONNECTIONS, 'operatorReserve': operator,
            'plannedConnections': application + operator, 'remainingSlots': usable - application - operator,
            'observedConnectionsIncludingProbe': int(database['connections']),
            'fits': application + operator <= usable}


def _read(args, install):
    try:
        result = subprocess.run(args, cwd=install.root, env=install.process_env,
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=8)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked('RESOURCE_PROBE', 'Resource inspection unavailable or timed out.',
                      'Check Docker/PostgreSQL availability, then retry; no settings were changed.') from exc
    require(result.returncode == 0, 'RESOURCE_PROBE', 'Read-only resource inspection failed.',
            'Check Docker/PostgreSQL availability; private command output is intentionally not printed.')
    try:
        return json.loads(result.stdout)
    except (ValueError, TypeError) as exc:
        raise Blocked('RESOURCE_PROBE', 'Resource inspection returned invalid metadata.',
                      'Check Docker/PostgreSQL availability; no settings were changed.') from exc


def resource_report(install, records):
    configuration = pool_configuration(install.env)
    engine = _read(['docker', 'info', '--format', '{"memoryBytes":{{json .MemTotal}},"cpus":{{json .NCPU}}}'], install)
    require(type(engine.get('memoryBytes')) is int and engine['memoryBytes'] > 0
            and type(engine.get('cpus')) is int and engine['cpus'] > 0,
            'RESOURCE_PROBE', 'Docker did not report a usable CPU/memory envelope.')
    report = {'scope': 'docker-engine-not-host', 'docker': engine,
              'configuredPool': configuration, 'containers': {}, 'warnings': [],
              'database': {'state': 'not-running-or-not-installed'}, 'capacityAcceptance': 'not-measured'}
    for service, record in records.items():
        limits = _read(['docker', 'inspect', '--format',
                        '{"memoryLimitBytes":{{json .HostConfig.Memory}},"memoryReservationBytes":{{json .HostConfig.MemoryReservation}},"nanoCpus":{{json .HostConfig.NanoCpus}},"pidsLimit":{{json .HostConfig.PidsLimit}}}',
                        record['id']], install)
        report['containers'][service] = limits
        if not limits.get('memoryLimitBytes'):
            report['warnings'].append(f'{service}: memory is unbounded within Docker; no capacity isolation')
    if 'api' in records:
        # Read privately with the same bounded probe; never return raw Env.
        values = _read(['docker', 'inspect', '--format', '{{json .Config.Env}}', records['api']['id']], install)
        runtime = dict(value.split('=', 1) for value in values if '=' in value)
        running = pool_configuration({key: runtime[key] for key in POOL_DEFAULTS if key in runtime})
        report['runningPool'] = {key: running[key] for key in POOL_DEFAULTS}
        if any(running[key] != configuration[key] for key in POOL_DEFAULTS):
            report['warnings'].append('Configured pool differs from running API; applied only by an authorized recreate/update')
    if records.get('postgres', {}).get('running'):
        sql = """SELECT json_build_object(
          'maxConnections', current_setting('max_connections')::int,
          'superuserReserved', current_setting('superuser_reserved_connections')::int,
          'reservedConnections', COALESCE(current_setting('reserved_connections', true), '0')::int,
          'connections', (SELECT count(*) FROM pg_stat_activity));"""
        database = _read(['docker', 'exec', '-e', 'PGCONNECT_TIMEOUT=3', '-e', 'PGOPTIONS=-c statement_timeout=3000 -c lock_timeout=1000 -c default_transaction_read_only=on',
                          records['postgres']['id'], 'sh', '-c',
                          'exec psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', 'resource-budget', sql], install)
        report['database'] = {'state': 'observed', **connection_budget(configuration, database)}
    else:
        report['warnings'].append('PostgreSQL connection budget is unknown until the canonical database is running')
    return report


def check_resources(install, records):
    report = resource_report(install, records)
    print('RESOURCE_BUDGET ' + json.dumps(report, sort_keys=True))
    require(report['database'].get('fits', True), 'RESOURCE_CONNECTIONS',
            'Selected API pools plus operator reserve exceed ordinary PostgreSQL connection slots.',
            'Reduce ASA_DB_POOL_MAX or review the explicit operator reserve in private .env. '
            'Do not raise max_connections without a measured database memory budget.')
    return report
