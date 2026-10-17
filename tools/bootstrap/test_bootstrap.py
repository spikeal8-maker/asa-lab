#!/usr/bin/env python3
"""Offline, no-network regression checks for ASA Lab host bootstrap wrappers."""
import importlib.util
import io
import json
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


if __name__ == '__main__':unittest.main(verbosity=2)