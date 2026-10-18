#!/usr/bin/env python3
"""Offline, no-network regression checks for ASA Lab host bootstrap wrappers."""
import importlib.util
from contextlib import nullcontext
import io
import json
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


class LinuxInstallerSecurity(unittest.TestCase):
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