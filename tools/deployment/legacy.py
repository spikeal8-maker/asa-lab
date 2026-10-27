"""Explicit, separately reviewed transition from a constrained source-mounted review.

This module never falls back from the ordinary updater. Planning writes only a
new private plan outside the installation. Application pins a manager separately
from the official product and refuses drift or an ambiguous interrupted switch.
"""

from contextlib import contextmanager
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit, urlunsplit
import uuid

from .backup import db_command
from .contracts import (Blocked, REPOSITORY, file_hash, read_env, require,
                        safe_member, validate_release, verify_backup, verify_embedded_entry_http)
from .legacy_identity import LegacyInstallation
from .legacy_release import github_json, read_exact_release, verify_manager_evidence
from .paths import atomic_bytes, atomic_json, plain_paths
from .releases import apply_release_environment, fetch_images, validate_resolved_images
from .resources import check_resources
from .system import Installation, run

PLAN_FORMAT = 'asa-legacy-transition-plan-v1'
JOURNAL_FORMAT = 'asa-legacy-transition-operation-v1'
COMPOSE_FILES = ('compose.yaml', 'compose.dev.yaml')
CORE_TABLES = ('accounts', 'users', 'projects', 'project_drafts', 'classrooms',
               'ai_usage_journal', 'ai_conversations', 'ai_messages')


def json_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def git_bytes(root, *args):
    result = subprocess.run(['git', *args], cwd=root, env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'},
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0, 'LEGACY_GIT', 'Cannot verify the requested Git object or checkout.',
            'Inspect the selected manager and preserved worktree; never force checkout or reset.')
    return result.stdout


def manager_source():
    root = Path(__file__).resolve().parents[2]
    revision = git_bytes(root, 'rev-parse', 'HEAD').decode().strip()
    require(re.fullmatch(r'[0-9a-f]{40}', revision), 'LEGACY_TOOL', 'Manager source has no exact Git identity.')
    require(not git_bytes(root, 'status', '--porcelain', '--', 'tools/asa_manager.py', 'tools/deployment'),
            'LEGACY_TOOL_DIRTY', 'Manager source differs from its reviewed commit.')
    origin = git_bytes(root, 'remote', 'get-url', 'origin').decode().strip().removesuffix('.git')
    require(origin in (f'https://github.com/{REPOSITORY}', f'git@github.com:{REPOSITORY}'),
            'LEGACY_TOOL', 'Unexpected manager repository.')
    paths = ['tools/asa_manager.py'] + sorted(
        path.relative_to(root).as_posix() for path in (root / 'tools/deployment').glob('*.py'))
    return root, {'revision': revision, 'files': {name: file_hash(root / name) for name in paths}}


def verify_preservation(install, directory):
    """Verify the existing private copy; never overwrite it or call it a DB backup."""
    from .legacy_backup import _check_private
    directory = Path(directory).absolute()
    plain_paths(directory, ())
    require(directory.is_dir() and not directory.is_relative_to(install.root),
            'LEGACY_PRESERVATION', 'An existing private WIP copy outside the installation is required.')
    _check_private(directory)
    manifest_path = directory / 'MANIFEST.json'
    plain_paths(directory, ('MANIFEST.json', 'metadata/recovery.json'))
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    require(manifest.get('format') == 1 and manifest.get('independent_git_fetch_fsck') is True
            and manifest.get('database_backup') is False,
            'LEGACY_PRESERVATION', 'Unsupported or unverified WIP preservation set.')
    require(manifest.get('source_head') == install.git('rev-parse', 'HEAD'),
            'LEGACY_PRESERVATION_DRIFT', 'The saved WIP HEAD differs; preserve new work separately first.')
    entries = manifest.get('files')
    require(isinstance(entries, list) and entries, 'LEGACY_PRESERVATION', 'Empty WIP preservation manifest.')
    seen = set()
    for item in entries:
        relative = item.get('path')
        path = safe_member(directory, relative)
        plain_paths(directory, (relative,))
        require(relative not in seen and path.is_file() and path.stat().st_size == item.get('bytes')
                and file_hash(path) == item.get('sha256'),
                'LEGACY_PRESERVATION_HASH', 'The existing private WIP copy is not intact.')
        seen.add(relative)
    # Original input equality is checked in addition to saved-copy integrity.
    # New changes must be preserved separately; old copies are never regenerated.
    copies = manifest.get('source_copies')
    require(isinstance(copies, list) and copies, 'LEGACY_PRESERVATION', 'WIP source-copy inventory is missing.')
    for item in copies:
        path = Path(item['source'])
        plain_paths(path.parent, (path.name,))
        require(path.is_file() and file_hash(path) == item['sha256'],
                'LEGACY_PRESERVATION_DRIFT', 'Original inputs changed after WIP preservation.',
                'Preserve new changes in a separate private set; do not overwrite the original copy.')
    recovery = json.loads((directory / 'metadata/recovery.json').read_text(encoding='utf-8'))
    branch = install.git('symbolic-ref', '--short', 'HEAD')
    require(recovery.get('source_root') == str(install.root)
            and recovery.get('source_head') == manifest['source_head']
            and recovery.get('source_branch') == manifest.get('source_branch') == branch,
            'LEGACY_PRESERVATION_DRIFT', 'The saved WIP belongs to a different source root or branch.')
    for key, arguments in (('tracked_paths', ('diff', '--name-only', '-z', 'HEAD')),
                           ('untracked_paths', ('ls-files', '--others', '--exclude-standard', '-z')),
                           ('staged_paths', ('diff', '--cached', '--name-only', '-z'))):
        observed = sorted(filter(None, install.git(*arguments).split('\0')))
        require(isinstance(recovery.get(key), list) and observed == sorted(recovery[key]),
                'LEGACY_PRESERVATION_DRIFT', 'New or removed WIP is not covered by the existing preservation set.')
    ignored = recovery.get('ignored_inventory')
    require(isinstance(ignored, dict) and set(ignored) == {'.asa/local-review', 'packages/contracts/dist'},
            'LEGACY_PRESERVATION', 'The preserved ignored runtime inventories are missing.')
    for relative, saved in ignored.items():
        path = safe_member(install.root, relative)
        plain_paths(install.root, (relative,))
        observed = sorted(item.relative_to(install.root).as_posix() for item in path.rglob('*') if item.is_file())
        require(isinstance(saved, list) and observed == sorted(saved),
                'LEGACY_PRESERVATION_DRIFT', 'Ignored runtime inputs changed after WIP preservation.')
    index = Path(install.git('rev-parse', '--absolute-git-dir')) / 'index'
    require(file_hash(index) == recovery.get('index_sha256'),
            'LEGACY_PRESERVATION_DRIFT', 'The staging index changed after WIP preservation.')
    return {'path': str(directory), 'manifestSha256': file_hash(manifest_path),
            'head': manifest['source_head'], 'files': len(entries), 'isApplicationBackup': False}


def assert_official_history(source_root, revision):
    # The source is an external tool checkout, never the mounted installation.
    git_bytes(source_root, 'cat-file', '-e', revision + '^{commit}')
    comparison = github_json('compare/' + revision + '...main?per_page=1')
    require(comparison.get('merge_base_commit', {}).get('sha') == revision
            and comparison.get('status') in ('identical', 'ahead'),
            'LEGACY_RELEASE_HISTORY', 'The selected product is not in canonical main history.')


def target_sources(source_root, revision):
    return {name: git_bytes(source_root, 'show', f'{revision}:{name}').decode('utf-8')
            for name in COMPOSE_FILES}


@contextmanager
def target_installation(install, release, sources):
    """Resolve official Compose against the real root, without replacing a file."""
    with tempfile.TemporaryDirectory(prefix='asa-legacy-target-') as directory:
        selected = Installation(install.root, 'dev')
        selected.env.setdefault('ASA_UPDATE_ENTRY_ORIGIN', install.entry_origin)
        selected.process_env['ASA_UPDATE_ENTRY_ORIGIN'] = selected.env['ASA_UPDATE_ENTRY_ORIGIN']
        apply_release_environment(selected, release)
        selected.files = list(COMPOSE_FILES)
        selected.compose_args = ['docker', 'compose', '--project-directory', str(install.root), '-p', install.project]
        for name in COMPOSE_FILES:
            path = Path(directory) / name
            path.write_bytes(sources[name].encode('utf-8'))
            selected.compose_args += ['-f', str(path)]
        yield selected


def ports(config, service):
    # Host endpoints stay fixed; the official Web image may use a different
    # private container port from the legacy development server.
    return sorted((item.get('host_ip', ''), str(item.get('published', '')),
                   item.get('protocol', 'tcp')) for item in config['services'][service].get('ports', []))


def attest_target(legacy, selected, release, old_config):
    target = validate_resolved_images(selected, release)
    require(set(target['services']) == set(old_config['services']),
            'LEGACY_TARGET', 'The target changes the installation service set.')
    # Application images may change. PostgreSQL image and all data identities may not.
    for name in ('postgres', 'minio'):
        before = old_config['services'][name]
        after = target['services'][name]
        require(before.get('volumes') == after.get('volumes'),
                'LEGACY_TARGET_VOLUME', 'A target persistent volume differs from the existing installation.')
    require(target['services']['postgres'] == old_config['services']['postgres'],
            'LEGACY_TARGET_ENGINE', 'PostgreSQL configuration changes require a separate engine operation.')
    for name in target['services']:
        require(ports(target, name) == ports(old_config, name),
                'LEGACY_TARGET_PORTS', 'The selected release changes an installed published port.')
    require(target.get('volumes') == old_config.get('volumes') and target.get('networks') == old_config.get('networks'),
            'LEGACY_TARGET_VOLUME', 'The target changes named storage or network identity.')
    # All old service secrets must continue to resolve from the same private env.
    # The approved overlay may override code/ports only within its own strict policy.
    for name in ('api', 'postgres', 'minio', 'scratch', 'search'):
        previous = old_config['services'][name].get('environment', {})
        following = target['services'][name].get('environment', {})
        keys = [key for key in previous if any(word in key for word in ('SECRET', 'PASSWORD', 'KEY', 'DATABASE_URL'))]
        require(all(previous[key] == following.get(key) for key in keys),
                'LEGACY_TARGET_SECRET', 'A credential or database target would change.')
    return target


def private_plan_path(path):
    from .legacy_backup import _check_private
    path = Path(path).absolute()
    plain_paths(path.parent, (path.name,))
    _check_private(path.parent)
    require(not path.exists(), 'LEGACY_PLAN_EXISTS', 'An existing plan must never be overwritten.')
    return path


def create_plan(root, *, revision, output, preservation, entry_origin, review_url):
    tool_root, tool = manager_source()
    install = LegacyInstallation(root, 'dev')
    install.entry_origin = entry_origin
    require(not tool_root.is_relative_to(install.root) and not install.root.is_relative_to(tool_root),
            'LEGACY_TOOL_ROOT', 'Use a reviewed manager copy outside the live mounted checkout.')
    output = private_plan_path(output)
    require(not output.is_relative_to(install.root), 'LEGACY_PLAN_PATH', 'Keep the plan outside the live installation.')
    require(not (install.state / 'installed-release.json').exists(),
            'LEGACY_NOT_APPLICABLE', 'This installation already has an official release; use the ordinary updater.')
    evidence = verify_manager_evidence(tool['revision'], review_url)
    release, registry = read_exact_release(revision)
    assert_official_history(tool_root, revision)
    snapshot = install.snapshot(entry_origin)
    require(release['schema'] > snapshot['runtime']['api']['schema'],
            'RELEASE_DOWNGRADE', 'Legacy transition requires an explicitly forward schema; no downgrade is allowed.')
    preserved = verify_preservation(install, preservation)
    sources = target_sources(tool_root, revision)
    old_config = json.loads(install.compose('config', '--format', 'json', capture=True))
    with target_installation(install, release, sources) as selected:
        target = attest_target(install, selected, release, old_config)
    # Observe again after network/config checks so a slow plan cannot freeze stale bytes.
    install.revalidate(snapshot)
    plan = {'format': PLAN_FORMAT, 'id': uuid.uuid4().hex,
            'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'manager': tool, 'managerEvidence': evidence,
            'source': snapshot, 'preservation': preserved, 'release': release, 'registry': registry,
            'targetSources': sources, 'targetConfigSha256': json_hash(target),
            'lineage': 'legacy-review; exact applied migration history and restored upgrade required before switching',
            'ownerAcceptance': 'pending'}
    plan['sha256'] = json_hash(plan)
    # Exclusive creation keeps an earlier reviewed plan immutable.
    with output.open('x', encoding='utf-8') as stream:
        os.chmod(output, 0o600)
        json.dump(plan, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    print(f"LEGACY_PLANNED id={plan['id']} manager={tool['revision']} product={revision}; no installation changes")
    print('LEGACY_WEB revision=unverified; old image IDs and actual mounted inputs are pinned separately')
    return plan


def read_plan(path):
    path = Path(path).absolute()
    plain_paths(path.parent, (path.name,))
    require(path.is_file() and path.stat().st_size < 20_000_000, 'LEGACY_PLAN', 'Missing or oversized transition plan.')
    plan = json.loads(path.read_text(encoding='utf-8'))
    expected = plan.pop('sha256', None)
    require(plan.get('format') == PLAN_FORMAT and re.fullmatch(r'[a-f0-9]{32}', plan.get('id', ''))
            and json_hash(plan) == expected, 'LEGACY_PLAN_HASH', 'The reviewed plan is invalid or changed.')
    plan['sha256'] = expected
    validate_release(plan['release'])
    return plan


def status(root):
    """Read actual state after an interruption; never resume/erase a journal."""
    install = Installation(root, 'dev')
    path = install.state / 'legacy-transition.json'
    journal = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    actual = {'head': install.git('rev-parse', 'HEAD'), 'dirty': bool(install.git('status', '--porcelain')),
              'containers': sorted((record['id'], record['image'], record['running']) for record in install.containers()
                                   if (record.get('labels') or {}).get('com.docker.compose.project') == install.project)}
    try:
        actual['readiness'] = install.readiness()
    except (Blocked, OSError, ValueError, KeyError):
        actual['readiness'] = 'not_verified'
    result = {'phase': journal.get('phase') if journal else 'not_started',
              'manager': journal.get('manager') if journal else None,
              'product': journal.get('product') if journal else None, 'actual': actual,
              'automaticResume': False, 'automaticDatabaseRestore': False}
    print(json.dumps(result, sort_keys=True))
    return result


def write_journal(install, journal, phase, **details):
    journal.update(details, phase=phase, at=dt.datetime.now(dt.timezone.utc).isoformat())
    atomic_json(install.state / 'legacy-transition.json', journal)


def migration_probe(install, target_config, release, *, database=None, apply=False):
    """Run the shipped runner; live planning is read-only, upgrade only *_test here."""
    migration = target_config['services']['migration']['environment']
    variables = {**install.process_env, **{key: str(value) for key, value in migration.items()}}
    variables['ASA_SEED_DEV'] = 'false'
    arguments = ['--plan']
    if database:
        require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,50}_test', database)
                and database != install.env.get('POSTGRES_DB'), 'RESTORE_TARGET', 'Only a new *_test database can be upgraded here.')
        parsed = urlsplit(migration['MIGRATION_DATABASE_URL'])
        variables['TEST_DATABASE_URL'] = urlunsplit((parsed.scheme, parsed.netloc, '/' + database, '', ''))
        variables['MIGRATION_DATABASE_URL'] = variables['TEST_DATABASE_URL']
        variables['MIGRATION_EXPECT_DATABASE'] = database
        variables['MIGRATION_CONFIRM'] = 'APPLY:' + database
        arguments = ['--smoke'] if apply else ['--plan']
    else:
        require(not apply, 'LEGACY_MIGRATION', 'This probe cannot apply migrations to the live database.')
    network = target_config['networks']['database']['name']
    command = ['docker', 'run', '--rm', '--network', network,
               '--label', 'asa.operation=legacy-migration-probe', '--read-only', '--user', 'node',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp']
    for key in ('MIGRATION_DATABASE_URL', 'MIGRATION_EXPECT_DATABASE', 'MIGRATION_CONFIRM', 'TEST_DATABASE_URL'):
        if key in variables:
            command += ['--env', key]
    command += ['--entrypoint', 'node', release['images']['api'], 'tools/migrate.mjs', *arguments]
    # Capture the runner output privately. SQL errors/connection details never
    # become a public deployment report; the exit status remains fail-closed.
    run(command, env=variables, capture=True)


def data_summary(install, database=None):
    summaries = {}
    for table in CORE_TABLES:
        exists = db_command(install, f'''psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${{RESTORE_DATABASE:-$POSTGRES_DB}}" -c "SELECT to_regclass('public.{table}') IS NOT NULL"''',
                            database=database, capture=True)
        if exists == 't':
            count = db_command(install, f'''psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${{RESTORE_DATABASE:-$POSTGRES_DB}}" -c 'SELECT count(*) FROM public."{table}"' ''',
                               database=database, capture=True)
            summaries[table] = int(count)
    return summaries


def preserve_before_checkout(install, plan, journal):
    """A deliberate stash is permitted only AFTER full backup and restore proof.

    No reset/clean/forced checkout, no stash pop, and no WIP is carried into the
    released product. The original branch and the additional stash ref remain.
    """
    require(journal.get('restoreVerified') is True and journal.get('backup'),
            'LEGACY_BACKUP_REQUIRED', 'Source inputs cannot change before verified full backup and restore.')
    verify_backup(journal['backup'])
    install.revalidate(plan['source'], allow_stopped=True)
    write_journal(install, journal, 'switching_sources', databaseMigrationStarted=False)
    if install.git('status', '--porcelain'):
        before = install.git('for-each-ref', '--format=%(objectname)', 'refs/stash')
        install.git('stash', 'push', '--include-untracked', '--message', 'ASA verified legacy transition ' + plan['id'])
        saved = install.git('rev-parse', 'refs/stash')
        require(saved and saved != before, 'LEGACY_STASH', 'WIP preservation did not create a new stash reference.')
        write_journal(install, journal, 'switching_sources', preservedStash=saved,
                      originalBranch=plan['source']['git']['branch'])
    require(not install.git('status', '--porcelain'), 'LEGACY_STASH', 'The checkout still contains work; no switch is allowed.')
    install.git('fetch', 'origin', plan['release']['revision'])
    install.git('switch', '--detach', plan['release']['revision'])
    require(install.git('rev-parse', 'HEAD') == plan['release']['revision'], 'LEGACY_SOURCE', 'Product checkout differs from the pinned release.')


def verify_running_release(install, plan):
    apply_release_environment(install, plan['release'])
    records = install.identity()
    for name, image in plan['release']['images'].items():
        require(records.get(name, {}).get('image') == image, 'IMAGE_DRIFT', 'Installed image reference differs.')
        expected_id = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], capture=True)
        actual_id = run(['docker', 'inspect', '--format', '{{.Image}}', records[name]['id']], capture=True)
        require(expected_id == actual_id, 'IMAGE_DRIFT', 'Installed image bytes differ.')
    ready = install.readiness(plan['release']['revision'], plan['release']['schema'])
    verify_embedded_entry_http(plan['source']['entryOrigin'], plan['release']['revision'])
    return ready


def accepted_state(install, plan):
    installed = install.state / 'installed-release.json'
    require(installed.exists() and json.loads(installed.read_text(encoding='utf-8')) == plan['release'],
            'LEGACY_ACCEPTED_DRIFT', 'Installed release differs; this transition must not replay or downgrade.')
    return verify_running_release(install, plan)


def verify_neighbours(legacy, snapshot):
    foreign = [{key: record.get(key) for key in ('id', 'imageId', 'running', 'mounts', 'ports')}
               for record in legacy.containers()
               if (record.get('labels') or {}).get('com.docker.compose.project') != legacy.project]
    require(json_hash(sorted(foreign, key=lambda item: item['id'])) == snapshot['foreignSha256'],
            'LEGACY_NEIGHBOUR_DRIFT', 'Neighbouring containers changed; inspect the concurrent operation.')


def apply_plan(root, plan_path, *, output, database, object_sandbox=False):
    from .legacy_backup import export_legacy_backup, verify_legacy_restore
    plan = read_plan(plan_path)
    ordinary = Installation(root, 'dev')
    require(str(ordinary.root) == plan['source']['root'] and ordinary.project == plan['source']['project'],
            'LEGACY_PLAN_ROOT', 'The plan belongs to another root or project.')
    require(isinstance(database, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,50}_test', database)
            and database != ordinary.env.get('POSTGRES_DB'),
            'RESTORE_TARGET', 'A new disposable *_test database is required before any transition work.')
    from .legacy_backup import _destination
    _destination(ordinary, output)
    path = ordinary.state / 'legacy-transition.json'
    if path.exists():
        journal = json.loads(path.read_text(encoding='utf-8'))
        require(journal.get('planSha256') == plan['sha256'], 'LEGACY_OPERATION', 'A different transition journal already exists.')
        if journal.get('phase') == 'accepted':
            accepted_state(ordinary, plan)
            print('NO_CHANGE the pinned release is already verified; no backup, migration or restart')
            return journal
        # A read of actual state precedes a refusal. Never turn a lost response
        # into a second dump, stash, migration, or an old-runtime restart.
        status(root)
        raise Blocked('LEGACY_INTERRUPTED', 'An earlier transition is incomplete.',
                      'Inspect the recorded phase, exact containers and backup; no automatic retry or database restore is allowed.')
    require(object_sandbox is True, 'LEGACY_RESTORE_AUTHORITY', 'Explicit isolated object restore verification is required.')
    tool_root, tool = manager_source()
    require(tool == plan['manager'] and not tool_root.is_relative_to(ordinary.root),
            'LEGACY_TOOL_DRIFT', 'Use the same external reviewed manager that prepared the plan.')
    verify_manager_evidence(tool['revision'], plan['managerEvidence']['review'])
    release, registry = read_exact_release(plan['release']['revision'], deployment_digest=plan['registry']['deploymentDigest'])
    require(release == plan['release'] and registry == plan['registry'], 'LEGACY_RELEASE_DRIFT', 'Pinned release evidence changed.')
    assert_official_history(tool_root, release['revision'])
    require(target_sources(tool_root, release['revision']) == plan['targetSources'], 'LEGACY_TARGET', 'Pinned product configuration changed.')
    install = LegacyInstallation(root, 'dev')
    install.entry_origin = plan['source']['entryOrigin']
    install.revalidate(plan['source'])
    require(verify_preservation(install, plan['preservation']['path']) == plan['preservation'],
            'LEGACY_PRESERVATION_DRIFT', 'Existing WIP preservation changed.')
    old_config = json.loads(install.compose('config', '--format', 'json', capture=True))
    with target_installation(install, release, plan['targetSources']) as selected:
        target = attest_target(install, selected, release, old_config)
    require(json_hash(target) == plan['targetConfigSha256'], 'LEGACY_TARGET_DRIFT', 'Resolved target configuration changed.')
    check_resources(install, install.identity())
    fetch_images(release)
    migration_probe(install, target, release)
    install.revalidate(plan['source'])
    journal = {'format': JOURNAL_FORMAT, 'planSha256': plan['sha256'], 'planId': plan['id'],
               'manager': tool['revision'], 'product': release['revision'], 'previous': plan['source']['runtime'],
               'automaticDatabaseRestore': False, 'ownerAcceptance': 'pending'}
    write_journal(install, journal, 'prepared')
    try:
        write_journal(install, journal, 'backing_up')
        backup = export_legacy_backup(install, plan['source'], output,
                    revalidate=lambda **kwargs: install.revalidate(plan['source'], **kwargs), leave_stopped=True)
        write_journal(install, journal, 'backed_up', backup=str(backup))
        baseline = data_summary(install)
        restored = verify_legacy_restore(install, backup, database, object_sandbox=True)
        require(data_summary(install, database) == baseline, 'LEGACY_RESTORE_DATA', 'Restored application row counts differ.')
        migration_probe(install, target, release, database=database, apply=True)
        require(data_summary(install, database) == baseline, 'LEGACY_UPGRADE_DATA', 'Application row counts changed during the restored upgrade.')
        write_journal(install, journal, 'restore_verified', restoreVerified=True, restore=restored,
                      previousCounts=baseline, restoredUpgrade='pass', restoredDatabase=database)
        preserve_before_checkout(install, plan, journal)
        # Persist only the explicitly supplied missing entry choice after backup;
        # existing configuration bytes/keys are never regenerated.
        if 'ASA_UPDATE_ENTRY_ORIGIN' not in install.env:
            env_path = install.root / '.env'
            current = env_path.read_bytes()
            suffix = (b'' if current.endswith(b'\n') else b'\n') + ('ASA_UPDATE_ENTRY_ORIGIN=' + install.entry_origin + '\n').encode()
            atomic_bytes(env_path, current + suffix, mode=0o600)
        selected = Installation(root, 'dev')
        apply_release_environment(selected, release)
        configuration = validate_resolved_images(selected, release)
        require(json_hash(configuration) == plan['targetConfigSha256'], 'LEGACY_TARGET_DRIFT', 'Checked-out target differs from the prepared configuration.')
        require(all(selected.env.get(key) == value for key, value in install.env.items()),
                'LEGACY_SECRET_DRIFT', 'Private configuration changed during source switch.')
        # Stop boundary was already crossed for a consistent verified backup.
        # From this marker onward, automatic old-app restart is always forbidden.
        write_journal(install, journal, 'switching', databaseMigrationStarted=True)
        postgres = plan['source']['containers']['postgres']
        require(run(['docker', 'image', 'inspect', '--format', '{{.Id}}', postgres['image']], capture=True) == postgres['imageId'],
                'DATABASE_ENGINE', 'The PostgreSQL tag changed; never pull or upgrade the engine in this transition.')
        # Recreate with the SAME exact engine bytes and volume to acquire honest
        # standard Compose provenance. Relabelling an old container is forbidden.
        selected.compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'postgres')
        selected.compose('run', '--rm', '--no-deps', '-e', 'ASA_SEED_DEV=false', 'migration')
        # The shipped dev Compose seeds on an ordinary migration startup. Run
        # migration once above with seeding disabled; do not create login users.
        selected.compose('create', '--no-build', 'migration', 'minio-init')
        selected.compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'minio', 'search', 'scratch', 'api', 'web')
        write_journal(install, journal, 'verifying')
        selected.wait_ready(release['revision'], release['schema'])
        verify_embedded_entry_http(plan['source']['entryOrigin'], release['revision'])
        records = selected.identity()
        require(run(['docker', 'inspect', '--format', '{{.Image}}', records['postgres']['id']], capture=True) == postgres['imageId'],
                'DATABASE_ENGINE', 'The PostgreSQL engine bytes changed.')
        require(data_summary(selected) == baseline, 'LEGACY_DATA_DRIFT', 'Application row counts differ after the actual update.')
        require(all(selected.env.get(key) == value for key, value in install.env.items()),
                'LEGACY_SECRET_DRIFT', 'Existing configuration values were not preserved.')
        verify_running_release(selected, plan)
        verify_neighbours(install, plan['source'])
        atomic_json(selected.state / 'installed-release.json', release)
        # Preserve the maintenance receipt rather than discarding its history.
        maintenance = selected.state / 'maintenance.json'
        if maintenance.exists():
            maintenance.rename(selected.state / ('legacy-backup-' + plan['id'] + '.json'))
        write_journal(selected, journal, 'accepted', actualRevision=release['revision'], actualSchema=release['schema'],
                      entryOrigin=plan['source']['entryOrigin'], installedDemo='not_run')
        selected.receipt({'status': 'success', 'action': 'legacy-transition', 'managerRevision': tool['revision'],
                          'productRevision': release['revision'], 'backup': str(backup), 'userFlow': 'not_run'})
        print(f"LEGACY_UPDATED manager={tool['revision']} product={release['revision']} schema={release['schema']}")
        print('USER_FLOW NOT_RUN: ordinary administrator sign-in and installed browser evidence remain required')
        return journal
    except BaseException:
        previous_phase = journal['phase']
        write_journal(install, journal, 'failed', failedPhase=previous_phase)
        raise
