#!/usr/bin/env python3
"""Offline tests: no SSH, browser, DB or certificate-store mutations."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('asa_lan_https', HERE/'lan-https-entry.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class LocalHttpsTests(unittest.TestCase):
    def test_selected_private_entry(self):
        self.assertEqual(module.validate_lan('192.168.1.115','192.168.1.0/24','eno1',4610),
                         'https://192.168.1.115:4610')

    def test_public_ip_is_refused(self):
        with self.assertRaises(module.Refused):
            module.validate_lan('8.8.8.8','8.8.0.0/16','eno1',4610)

    def test_wide_lan_is_refused(self):
        with self.assertRaises(module.Refused):
            module.validate_lan('10.1.2.3','10.0.0.0/8','eno1',4610)

    def test_unmatched_interface_network_is_refused(self):
        with self.assertRaises(module.Refused):
            module.validate_lan('192.168.1.115','192.168.2.0/24','eno1',4610)

    def test_no_vpn_or_virtual_entry(self):
        for interface in ('tailscale0','docker0','br-abc','lo','tun0','wg0'):
            with self.subTest(interface=interface), self.assertRaises(module.Refused):
                module.validate_lan('192.168.1.115','192.168.1.0/24',interface,4610)

    def test_port_does_not_silently_change(self):
        with self.assertRaises(module.Refused):
            module.validate_lan('192.168.1.115','192.168.1.0/24','eno1',4611)

    def test_same_port_redirect_and_tls(self):
        cfg=module.caddy_config('192.168.1.115',4610)
        self.assertIn('http_redirect\n            tls',cfg)
        self.assertIn('bind 192.168.1.115',cfg)
        self.assertIn('https://192.168.1.115:4610',cfg)
        self.assertIn('reverse_proxy 127.0.0.1:4610',cfg)
        self.assertIn('skip_install_trust',cfg)
        self.assertNotIn('0.0.0.0',cfg)

    def test_unprivileged_service(self):
        cfg=module.service_config()
        for required in ('DynamicUser=yes','NoNewPrivileges=yes','ProtectHome=yes',
                         'StateDirectoryMode=0700','CapabilityBoundingSet='):
            self.assertIn(required,cfg)

    def test_only_public_origin_configuration_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'.env'
            path.write_text('POSTGRES_PASSWORD=unit-test-only\nASA_SETTINGS_ENCRYPTION_KEY=unit-test-key\n'
                            'ASA_BLOCKS_RUNTIME_ORIGIN=http://127.0.0.1:4610\n')
            with patch.object(module.os,'chown',create=True):
                module.update_public_env(path,'https://192.168.1.115:4610')
            result=path.read_text()
            self.assertIn('POSTGRES_PASSWORD=unit-test-only\n',result)
            self.assertIn('ASA_SETTINGS_ENCRYPTION_KEY=unit-test-key\n',result)
            for key in module.PUBLIC_KEYS:
                self.assertEqual(result.count(key+'=https://192.168.1.115:4610'),1)

    def test_duplicate_origin_key_stops_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'.env'
            original='ASA_UPDATE_ENTRY_ORIGIN=first\nASA_UPDATE_ENTRY_ORIGIN=second\n'
            path.write_text(original)
            with self.assertRaises(module.Refused):
                module.update_public_env(path,'https://192.168.1.115:4610')
            self.assertEqual(path.read_text(),original)

    def test_windows_trust_is_explicit_and_pinned(self):
        source=(HERE/'trust-local-https.ps1').read_text()
        self.assertIn('if (-not $TrustLocalServer)',source)
        self.assertIn('Get-FileHash',source)
        self.assertIn('ExpectedCaSha256',source)
        self.assertIn('Cert:\\CurrentUser\\Root',source)
        self.assertNotIn('LocalMachine',source)
        self.assertIn('StrictHostKeyChecking=yes',source)

if __name__=='__main__':
    unittest.main(verbosity=2)
