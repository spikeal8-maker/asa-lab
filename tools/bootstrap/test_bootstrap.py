#!/usr/bin/env python3
"""Offline, no-network regression checks for ASA Lab host bootstrap wrappers."""
import importlib.util
from contextlib import nullcontext
import io
import json
import hashlib
import sys
from pathlib import Path
import tarfile
import tempfile
import types
import unittest
from unittest import mock

BASE = Path(__file__).resolve().parent


def import_script(path, name):
    spec = importlib.util.spec_from_file_location(name, BASE / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rebuild = import_script('install-ubuntu-1panel.py', 'install_ubuntu')
age = import_script('prepare-age-backup.py', 'prepare_age')
transfer = import_script('transfer-backup-ssh.py', 'transfer_backup')


class ArchiveSecurity(unittest.TestCase):
    def test_normal_file_is_within_target(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(age.safe_destination(Path(d), tarfile.TarInfo('snapshot/database.dump')).name,
                             'database.dump')

    def test_blocks_parent_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                age.safe_destination(Path(d), tarfile.TarInfo('snapshot/../../passwd'))

    def test_blocks_absolute_path(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                age.safe_destination(Path(d), tarfile.TarInfo('/etc/hosts'))

    def test_blocks_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            info = tarfile.TarInfo('snapshot/config'); info.type = tarfile.SYMTYPE; info.linkname='/etc'
            with self.assertRaises(ValueError):
                age.safe_destination(Path(d), info)

    def test_rejects_existing_destination(self):
        with tempfile.TemporaryDirectory() as d:
            a=types.SimpleNamespace(archive=Path(d)/'asa-lab-20261016T231505Z-7b457013.tar.age', yandex_folder=Path(d),
                                    age=Path(d)/'age', identity=Path(d)/'id', extract=True,
                                    output=Path(d))
            for p in (a.archive,a.age,a.identity):p.write_text('dummy')
            with self.assertRaises(FileExistsError):
                age.verify_or_extract(a)

    def test_snapshot_selection_uses_name_timestamp(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ('asa-lab-20261010T231504Z-aaaa1111.tar.age',
                         'asa-lab-20261016T231505Z-bbbb2222.tar.age'):
                (Path(d)/name).write_text('x')
            (Path(d)/'unknown.age').write_text('x')
            found=age.find_latest(Path(d))
            self.assertIn('20261016',found.name)

    def test_expected_filename_contract(self):
        self.assertTrue(age.SNAPSHOT.fullmatch('asa-lab-20261016T231505Z-7b457013.tar.age'))
        self.assertFalse(age.SNAPSHOT.fullmatch('asa-lab-SOME.tar.age'))


class PrivateExtractionBoundary(unittest.TestCase):
    """Private plaintext must never be written into a cloud sync directory."""

    def test_explicit_archive_cannot_extract_into_recognized_cloud_folder(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archives = root / "ASA-Backups"
            archives.mkdir()
            source = archives / "asa-lab-20261017T231505Z-65b68074.tar.age"
            binary = root / "age"
            identity = root / "identity"
            for path in (source, binary, identity):
                path.write_bytes(b"test")
            dest = archives / "plaintext-restore"
            args = types.SimpleNamespace(archive=source, age=binary,
                identity=identity, yandex_folder=None, extract=True, output=dest)
            with self.assertRaisesRegex(ValueError, "Yandex Disk"):
                age.verify_or_extract(args)
            self.assertFalse(dest.exists())

    def test_explicit_archive_cannot_extract_elsewhere_in_yandex_sync_root(self):
        with tempfile.TemporaryDirectory() as d:
            sync = Path(d) / "Yandex.Disk"
            archives = sync / "ASA-Backups"
            archives.mkdir(parents=True)
            source = archives / "asa-lab-20261017T231505Z-65b68074.tar.age"
            binary = Path(d) / "age"
            identity = Path(d) / "identity"
            for path in (source, binary, identity):
                path.write_bytes(b"test")
            dest = sync / "private-plaintext"
            args = types.SimpleNamespace(archive=source, age=binary,
                identity=identity, yandex_folder=archives, extract=True, output=dest)
            with self.assertRaisesRegex(ValueError, "Yandex Disk"):
                age.verify_or_extract(args)
            self.assertFalse(dest.exists())


class EncryptedRestoreLayout(unittest.TestCase):
    """End-to-end manifest and extracted-layout proof, without real secrets."""

    @staticmethod
    def make_archive(*, different_root=False, duplicate=False, manifest_id=None):
        payloads = {
            "database.dump": b"verified-postgresql-dump",
            "private.env": b"verified-private-config",
            "objects/asa-blocks/folder/blob": b"verified-minio-object",
        }
        manifest = {
            "format": "asa-backup-v1", "complete": True,
            "createdAt": manifest_id or "20261017T231505Z-65b68074",
            "runtime": {"schema": 212},
            "files": {key: {"sha256": hashlib.sha256(data).hexdigest(),
                            "bytes": len(data)} for key, data in payloads.items()},
        }
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w") as stream:
            for directory in ("snapshot", "snapshot/objects", "snapshot/objects/asa-blocks",
                              "snapshot/objects/asa-blocks/folder"):
                member = tarfile.TarInfo(directory)
                member.type = tarfile.DIRTYPE
                member.mode = 0o700
                stream.addfile(member)
            for key, value in {"manifest.json": json.dumps(manifest).encode(),
                               **payloads}.items():
                prefix = "another-root" if different_root and key == "private.env" else "snapshot"
                member = tarfile.TarInfo(prefix + "/" + key)
                member.size = len(value)
                stream.addfile(member, io.BytesIO(value))
                if duplicate and key == "database.dump":
                    stream.addfile(member, io.BytesIO(value))
        return raw.getvalue()

    def extract(self, payload: bytes, *, extracting: bool):
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d)
            source = directory / "asa-lab-20261017T231505Z-65b68074.tar.age"
            binary, identity = directory / "age", directory / "identity"
            for path in (source, binary, identity):
                path.write_bytes(b"test")
            extracted = directory / "recovered"
            args = types.SimpleNamespace(archive=source, age=binary, identity=identity,
                                         yandex_folder=None, extract=extracting,
                                         output=extracted)
            process = mock.Mock()
            process.stdout = io.BytesIO(payload)
            process.wait.return_value = 0
            process.poll.return_value = 0
            with mock.patch.object(age.subprocess, "Popen", return_value=process):
                if payload == self.make_archive():
                    result = age.verify_or_extract(args)
                    self.assertEqual(result["files_verified"], 3)
                    if extracting:
                        self.assertTrue((extracted / "manifest.json").is_file())
                        self.assertTrue((extracted / "database.dump").is_file())
                        self.assertTrue((extracted / "private.env").is_file())
                        self.assertEqual((extracted / "objects/asa-blocks/folder/blob").read_bytes(),
                                         b"verified-minio-object")
                        self.assertFalse((extracted / "snapshot").exists())
                    else:
                        self.assertFalse(extracted.exists())
                else:
                    with self.assertRaises(ValueError):
                        age.verify_or_extract(args)
                    self.assertFalse(extracted.exists())

    def test_archive_root_is_stripped_to_restore_contract(self):
        self.extract(self.make_archive(), extracting=True)

    def test_verify_only_uses_same_checks_without_writing_files(self):
        self.extract(self.make_archive(), extracting=False)

    def test_mixed_archive_roots_are_rejected(self):
        self.extract(self.make_archive(different_root=True), extracting=True)

    def test_duplicate_files_are_rejected(self):
        self.extract(self.make_archive(duplicate=True), extracting=True)

    def test_renamed_archive_cannot_pass_manifest_identity_check(self):
        self.extract(
            self.make_archive(manifest_id="20261016T231505Z-7b457013"),
            extracting=True
        )

    def test_top_level_file_is_not_a_valid_backup_member(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                age.safe_destination(Path(d), tarfile.TarInfo("manifest.json"))

    def test_archive_root_directory_is_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            header = tarfile.TarInfo("snapshot/")
            header.type = tarfile.DIRTYPE
            self.assertEqual(age.safe_destination(root, header), root)


class ExtractedBackupPreflight(unittest.TestCase):
    SNAPSHOT = '20261017T231505Z-65b68074'

    @staticmethod
    def make_valid(directory):
        root = Path(directory) / 'backup'
        root.mkdir()
        data = {
            'database.dump': b'validated-postgresql-dump',
            'globals.sql': b'validated-database-roles',
            'private.env': b'validated-configuration',
        }
        for relative, content in data.items():
            (root / relative).write_bytes(content)
        manifest = {
            'format': 'asa-backup-v1', 'complete': True,
            'createdAt': ExtractedBackupPreflight.SNAPSHOT,
            'runtime': {'schema': 212},
            'files': {key: {'bytes': len(value),
                            'sha256': hashlib.sha256(value).hexdigest()}
                      for key, value in data.items()},
        }
        (root / 'manifest.json').write_text(json.dumps(manifest))
        return root

    def test_valid_extracted_snapshot_is_verified_readonly(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.make_valid(d)
            rebuild.verify_extracted_before_host_setup(root, self.SNAPSHOT)
            self.assertEqual((root / 'database.dump').read_bytes(),
                             b'validated-postgresql-dump')

    def test_snapshot_id_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.make_valid(d)
            with self.assertRaisesRegex(rebuild.Blocked, 'manifest ID'):
                rebuild.verify_extracted_before_host_setup(
                    root, '20261016T231505Z-7b457013')

    def test_corrupt_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.make_valid(d)
            source = (root / 'database.dump').read_bytes()
            (root / 'database.dump').write_bytes(b'X' + source[1:])
            with self.assertRaisesRegex(rebuild.Blocked, 'checksum mismatch'):
                rebuild.verify_extracted_before_host_setup(root, self.SNAPSHOT)

    def test_extra_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.make_valid(d)
            (root / 'untracked.txt').write_bytes(b'not in manifest')
            with self.assertRaisesRegex(rebuild.Blocked, 'Unexpected file'):
                rebuild.verify_extracted_before_host_setup(root, self.SNAPSHOT)

    def test_backup_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.make_valid(d)
            (root / 'link').symlink_to(root / 'database.dump')
            with self.assertRaisesRegex(rebuild.Blocked, 'symlink'):
                rebuild.verify_extracted_before_host_setup(root, self.SNAPSHOT)

    def test_bad_backup_blocks_before_host_provisioning(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.make_valid(d)
            argv = ['installer','install','--profile','production',
                    '--root',str(Path(d) / 'brand-new-school'),
                    '--admin-cidr','192.168.1.0/24',
                    '--require-restore','--restore-backup',str(root),
                    '--restore-snapshot','20261016T231505Z-7b457013']
            with mock.patch.object(sys,'argv',argv), \
                 mock.patch.object(rebuild,'exclusive') as lock, \
                 mock.patch.object(rebuild,'preflight') as preflight, \
                 mock.patch.object(rebuild,'panel_install') as panel:
                self.assertEqual(rebuild.main(),2)
                lock.assert_not_called()
                preflight.assert_not_called()
                panel.assert_not_called()


class StableManagerCodeHandoffTests(unittest.TestCase):
    """Regression for the observed RETRY_NEW_MANAGER on a freshly wiped host."""

    @staticmethod
    def checkout(path):
        (path / ".asa").mkdir()
        (path / ".git").mkdir()
        private = path / ".env"
        private.write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\nPOSTGRES_DB=asalab\n"
                           "ASA_SEED_DEV=false\n")
        private.chmod(0o600)
        (path / ".asa/installation.json").write_text(json.dumps({
            "format": "asa-installation-v1",
            "profile": "production",
            "project": "asa-lab-dev",
        }))
        return types.SimpleNamespace(operator="root", profile="production", root=path)

    @staticmethod
    def read_only_git_and_docker(*argv, **kwargs):
        if argv[:4] == ("git", "remote", "get-url", "origin"):
            return rebuild.REPO
        if argv[:3] in (("git", "branch", "--show-current"),
                        ("git", "status", "--porcelain")):
            return ""
        if argv[:3] == ("git", "rev-parse", "--is-shallow-repository"):
            return "false"
        if argv[:3] == ("git", "merge-base", "--is-ancestor"):
            return 0
        if argv[:2] == ("docker", "ps"):
            return ""
        if argv[:3] == ("docker", "volume", "ls"):
            return "1panel_persistent_data"
        raise AssertionError(f"unexpected test command: {argv}")

    def test_exact_detached_clean_handoff_reuses_private_env(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            args = self.checkout(path)
            with mock.patch.object(rebuild, "run",
                                   side_effect=self.read_only_git_and_docker):
                self.assertTrue(rebuild.manager_handoff_resume_ready(args, path))

    def test_handoff_rejected_if_database_switch_in_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            args = self.checkout(path)
            (path / ".asa/maintenance.json").write_text("{}")
            with mock.patch.object(rebuild, "run") as run:
                self.assertFalse(rebuild.manager_handoff_resume_ready(args, path))
                run.assert_not_called()

    def test_handoff_rejected_if_private_env_permissions_weak(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            args = self.checkout(path)
            (path / ".env").chmod(0o644)
            with mock.patch.object(rebuild, "run") as run:
                self.assertFalse(rebuild.manager_handoff_resume_ready(args, path))
                run.assert_not_called()

    def test_manager_exit_two_on_exact_checkout_switch_retries_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            args = self.checkout(path)
            attempts = []
            old_sha, new_sha = "a" * 40, "b" * 40

            def installer(*argv, **kwargs):
                if argv[:3] == ("git", "rev-parse", "HEAD"):
                    return old_sha if not attempts else new_sha
                if argv[:2] == ("python3", "tools/asa_manager.py"):
                    attempts.append(argv)
                    return 2 if len(attempts) == 1 else 0
                return self.read_only_git_and_docker(*argv, **kwargs)

            with mock.patch.object(rebuild, "run", side_effect=installer), \
                 mock.patch.object(rebuild, "record") as record:
                rebuild.install_manager_with_bounded_handoff(args, path)
                self.assertEqual(len(attempts), 2)
                record.assert_called_once()

    def test_manager_unrelated_failure_never_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            args = self.checkout(path)
            calls = []

            def failure(*argv, **kwargs):
                if argv[:3] == ("git", "rev-parse", "HEAD"):
                    return "b" * 40
                if argv[:2] == ("python3", "tools/asa_manager.py"):
                    calls.append(argv)
                    return 2
                raise AssertionError("must stop before any recovery attempt")

            with mock.patch.object(rebuild, "run", side_effect=failure):
                with self.assertRaises(rebuild.Blocked):
                    rebuild.install_manager_with_bounded_handoff(args, path)
            self.assertEqual(len(calls), 1)


class LinuxInstallerSecurity(unittest.TestCase):
    def test_occupied_web_port_blocks_without_creating_installation(self):
        class Occupied:
            def __enter__(self): return self
            def __exit__(self, *unused): return False
            def bind(self, target):
                raise OSError("address already in use")
        with mock.patch.object(rebuild.socket, "socket", return_value=Occupied()):
            with self.assertRaisesRegex(rebuild.Blocked, "127.0.0.1:4610"):
                rebuild.assert_fresh_host_ports_available()

    def test_port_preflight_runs_before_host_mutations(self):
        events = []
        with tempfile.TemporaryDirectory() as d:
            argv = ['installer','install','--profile','staging','--root',
                    str(Path(d)/'fresh'), '--admin-cidr','192.168.1.0/24']
            with mock.patch.object(sys,'argv',argv), \
                 mock.patch.object(rebuild,'exclusive',return_value=nullcontext()), \
                 mock.patch.object(rebuild,'assert_fresh_host_ports_available',
                                   side_effect=lambda:events.append('ports')), \
                 mock.patch.object(rebuild,'preflight',
                                   side_effect=lambda args:events.append('host')), \
                 mock.patch.object(rebuild,'panel_install'), \
                 mock.patch.object(rebuild,'harden_panel_firewall'), \
                 mock.patch.object(rebuild,'source_install'):
                self.assertEqual(rebuild.main(),0)
        self.assertEqual(events,['ports','host'])

    def test_fresh_git_checkout_includes_stable_release_history(self):
        source = (BASE / "install-ubuntu-1panel.py").read_text()
        self.assertIn('"clone", "--filter=blob:none", "--single-branch"', source)
        self.assertNotIn('"clone", "--depth", "1"', source)

    def test_windows_checkout_includes_stable_release_history(self):
        script = (BASE / 'install-windows.ps1').read_text(encoding='utf-8')
        self.assertIn("'--filter=blob:none'", script)
        self.assertNotIn("'--depth'", script)

    def test_require_blocks(self):
        with self.assertRaises(rebuild.Blocked):rebuild.require(False,'fail closed')

    def test_refuses_anywhere_cidr(self):
        with self.assertRaises(rebuild.Blocked):rebuild.assert_subnet_for_host('0.0.0.0/0')

    def test_refuses_unrelated_remote_ssh_address(self):
        with mock.patch.dict(rebuild.os.environ, {'SSH_CONNECTION': '10.0.0.10 70000 192.168.1.115 22'}):
            with self.assertRaises(rebuild.Blocked):
                rebuild.assert_subnet_for_host('192.168.1.0/24')

    def test_accepts_remote_ssh_cidr(self):
        with mock.patch.dict(rebuild.os.environ, {'SSH_CONNECTION': '192.168.1.111 70000 192.168.1.115 22'}):
            rebuild.assert_subnet_for_host('192.168.1.0/24')

    def test_panel_pin_is_sha256(self):
        self.assertEqual(len(rebuild.PANEL_SHA256),64)
        int(rebuild.PANEL_SHA256,16)

    def test_doctor_rejects_mixed_revision(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.asa').mkdir();(root/'.asa/installed-release.json').write_text('{"revision":"r"}')
            args=types.SimpleNamespace(root=root,profile='staging',operator='admins')
            def fake_url(url, timeout):
                class Response:
                    def read(self):
                        if url.endswith('health/ready'):
                            return b'{"status":"ready","deployment":{"revision":"a","synchronized":true,"schemaVersion":213,"expectedSchemaVersion":213}}'
                        return b'{"revision":"b"}'
                    def __enter__(self):return self
                    def __exit__(self,*a):pass
                    status=200
                return Response()
            with mock.patch.object(rebuild,'run'), mock.patch.object(rebuild.urllib.request,'urlopen',side_effect=fake_url):
                with self.assertRaises(rebuild.Blocked):rebuild.doctor(args)



class SchoolLanInstallerTests(unittest.TestCase):
    def test_production_install_invokes_school_https_after_install(self):
        events = []
        argv = ['installer', 'install', '--profile', 'production',
                '--root', '/srv/asa-lab', '--admin-cidr', '192.168.1.0/24',
                '--fresh-empty', '--school-lan-https', '--school-lan-follow-interface']
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(rebuild, 'exclusive', return_value=nullcontext()), \
             mock.patch.object(rebuild, 'preflight'), \
             mock.patch.object(rebuild, 'assert_fresh_host_ports_available'), \
             mock.patch.object(rebuild, 'panel_install'), \
             mock.patch.object(rebuild, 'harden_panel_firewall'), \
             mock.patch.object(rebuild, 'source_install', side_effect=lambda _: events.append('install')), \
             mock.patch.object(rebuild, 'configure_school_lan', side_effect=lambda _: events.append('https')):
            self.assertEqual(rebuild.main(), 0)
        self.assertEqual(events, ['install', 'https'])

    def test_legacy_http_preview_cannot_override_secure_school_mode(self):
        argv = ['installer', 'install', '--profile', 'production', '--fresh-empty',
                '--school-lan-https', '--lan-preview-ip', '192.168.1.115',
                '--lan-preview-cidr', '192.168.1.0/24', '--lan-preview-interface', 'eno1',
                '--ack-production-http-preview']
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(rebuild, 'exclusive') as lock:
            self.assertEqual(rebuild.main(), 2)
            lock.assert_not_called()

    def test_school_https_is_not_enabled_for_staging(self):
        argv = ['installer', 'install', '--profile', 'staging', '--school-lan-https']
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(rebuild, 'exclusive') as lock:
            self.assertEqual(rebuild.main(), 2)
            lock.assert_not_called()

    def test_existing_installation_uses_ingress_only_action(self):
        argv = ['installer', 'school-lan', '--profile', 'production',
                '--root', '/srv/asa-lab']
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(rebuild, 'exclusive', return_value=nullcontext()), \
             mock.patch.object(rebuild.os, 'geteuid', return_value=0), \
             mock.patch.object(rebuild, 'preflight') as preflight, \
             mock.patch.object(rebuild, 'panel_install') as panel, \
             mock.patch.object(rebuild, 'source_install') as install, \
             mock.patch.object(rebuild, 'configure_school_lan') as secure:
            self.assertEqual(rebuild.main(), 0)
            secure.assert_called_once()
            preflight.assert_not_called()
            panel.assert_not_called()
            install.assert_not_called()

    def test_school_kit_uses_bundled_helper_without_touching_volumes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / '.asa').mkdir()
            (root / '.asa/installed-release.json').write_text('{}')
            args = types.SimpleNamespace(root=root, profile='production',
                                         school_lan_interface='eno1',
                                         school_lan_follow_interface=True)
            with mock.patch.object(rebuild, 'run') as run, \
                 mock.patch.object(rebuild, 'record'):
                rebuild.configure_school_lan(args)
            command = run.call_args.args
            self.assertEqual(command[0], 'python3')
            self.assertTrue(command[1].endswith('school-lan.py'))
            self.assertEqual(command[2:5], ('configure', '--root', str(root)))
            self.assertEqual(command[-3:], ('--interface', 'eno1', '--follow-interface'))


class SSHTransferSafety(unittest.TestCase):
    def test_rejects_shell_characters_in_path(self):
        with self.assertRaises(ValueError):
            transfer.validate_remote('admins', '192.168.1.115', '/srv/backup;rm')

    def test_rejects_parent_traversal(self):
        with self.assertRaises(ValueError):
            transfer.validate_remote('admins', '192.168.1.115', '/srv/a/../../root')

    def test_rejects_unsafe_username(self):
        with self.assertRaises(ValueError):
            transfer.validate_remote('admins;id', '192.168.1.115', '/srv/recovery')

    def test_accepts_private_staging_dir(self):
        self.assertEqual(str(transfer.validate_remote('admins', '192.168.1.115', '/srv/asa-test-restore')), '/srv/asa-test-restore')


if __name__ == '__main__':unittest.main(verbosity=2)