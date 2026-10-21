#!/usr/bin/env python3
"""Portable school LAN tests. No network, cloud, root access or real DB required."""
from contextlib import nullcontext
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('school_lan',HERE/'school-lan.py')
m=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=m
spec.loader.exec_module(m)


def record(name='eno1',ip='192.168.1.115',prefix=24,up=True):
    return dict(ifname=name,flags=['UP','LOWER_UP'] if up else [],operstate='UP' if up else 'DOWN',
                addr_info=[dict(family='inet',local=ip,prefixlen=prefix,scope='global')])


class DiscoveryTests(unittest.TestCase):
    def test_unique_physical_interface_is_selected(self):
        x=m.select_endpoint([record()],{'eno1'})
        self.assertEqual(x.origin,'https://192.168.1.115:4610')
        self.assertEqual(x.cidr,'192.168.1.0/24')
    def test_other_school_address_needs_no_source_change(self):
        x=m.select_endpoint([record('ens18','10.42.3.8')],{'ens18'})
        self.assertEqual(x.origin,'https://10.42.3.8:4610')
    def test_vpn_and_docker_are_never_auto_trusted(self):
        records=[record(),record('tailscale0','100.75.149.26'),record('docker0','172.17.0.1'),record('br-lan','10.2.3.4')]
        self.assertEqual(m.select_endpoint(records,{'eno1','tailscale0','docker0','br-lan'}).interface,'eno1')
    def test_two_physical_interfaces_block_automatic_choice(self):
        with self.assertRaises(m.Refused):
            m.select_endpoint([record(),record('wlp2s0','192.168.4.2')],{'eno1','wlp2s0'})
    def test_explicit_choice_persists(self):
        x=m.select_endpoint([record(),record('wlp2s0','192.168.4.2')],{'eno1','wlp2s0'},'eno1')
        self.assertEqual(x.address,'192.168.1.115')
    def test_unplugged_interface_does_not_fall_back_to_another(self):
        with self.assertRaises(m.Refused):
            m.select_endpoint([record(up=False),record('wlp2s0','192.168.4.2')],{'eno1','wlp2s0'},'eno1')
    def test_public_address_refused(self):
        with self.assertRaises(m.Refused):m.select_endpoint([record(ip='8.8.8.8')],{'eno1'})
    def test_broad_subnet_refused(self):
        with self.assertRaises(m.Refused):m.select_endpoint([record(ip='10.0.0.3',prefix=8)],{'eno1'})
    def test_deprecated_dhcp_address_skipped(self):
        old=record();old['addr_info'][0]['preferred_life_time']=0
        self.assertEqual(m.select_endpoint([old,record(ip='192.168.1.116')],{'eno1'},'eno1').address,'192.168.1.116')
    def test_existing_address_during_dhcp_overlap_is_stable(self):
        x=m.select_endpoint([record(),record(ip='192.168.1.116')],{'eno1'},'eno1','192.168.1.115')
        self.assertEqual(x.address,'192.168.1.115')
    def test_address_changed_when_old_address_gone(self):
        x=m.select_endpoint([record(ip='192.168.1.116')],{'eno1'},'eno1','192.168.1.115')
        self.assertEqual(x.address,'192.168.1.116')
    def test_new_subnet_requires_follow_approval(self):
        with self.assertRaises(m.Refused):
            m.assert_transition(dict(interface='eno1',follow_interface=False,approved_cidr='192.168.1.0/24'),
                                m.Endpoint('eno1','10.42.3.8','10.42.3.0/24'))
    def test_approved_interface_can_follow_dhcp_into_new_subnet(self):
        m.assert_transition(dict(interface='eno1',follow_interface=True,approved_cidr='192.168.1.0/24'),
                            m.Endpoint('eno1','10.42.3.8','10.42.3.0/24'))
    def test_new_interface_not_trusted_even_with_follow_approval(self):
        with self.assertRaises(m.Refused):
            m.assert_transition(dict(interface='eno1',follow_interface=True,approved_cidr='192.168.1.0/24'),
                                m.Endpoint('wlp2s0','10.42.3.8','10.42.3.0/24'))
    def test_timer_is_boot_enabled_offline_and_rate_limited(self):
        service,timer=m.timer_units()
        self.assertIn('reconcile',service)
        self.assertIn('OnBootSec=45s',timer)
        self.assertIn('OnUnitInactiveSec=30s',timer)
        self.assertNotIn('curl',service)
        self.assertNotIn('tailscale',service)


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.prefix=Path(self.tmp.name)/'ingress';self.prefix.mkdir()
        self.root=Path(self.tmp.name)/'app';self.root.mkdir()
        (self.root/'.asa').mkdir()
        (self.root/'.asa/installed-release.json').write_text(json.dumps(dict(revision='pinned',schema=213)))
        self.old=m.Endpoint('eno1','192.168.1.115','192.168.1.0/24')
        self.new=m.Endpoint('eno1','10.42.3.8','10.42.3.0/24')
        self.policy=dict(root=str(self.root),interface='eno1',follow_interface=True,
                         approved_cidr=self.old.cidr,current_address=self.old.address,current_cidr=self.old.cidr)
        self.state=dict(phase='READY',root=str(self.root),origin=self.old.origin,ca_sha256='same-ca')
        self.state_file=self.prefix/'state.json';self.state_file.write_text(json.dumps(self.state))
        self.config_file=self.prefix/'network.json';self.config_file.write_text(json.dumps(self.policy))
        (self.prefix/'Caddyfile').write_text('old-config')
        self.key='PRIVATE_PASSWORD_UNCHANGED'
        self.keys=('ASA_PUBLIC_WEB_ORIGINS','ASA_BLOCKS_PARENT_ORIGIN','ASA_BLOCKS_RUNTIME_ORIGIN','ASA_UPDATE_ENTRY_ORIGIN')
        (self.root/'.env').write_text('APP_DATABASE_URL='+self.key+'\n'+'\n'.join(k+'='+self.old.origin for k in self.keys)+'\n')
        self.records={s:dict(id=s+'-original',mounts=[dict(Name=s+'-data')]) for s in ('postgres','minio')}
        self.compose_calls=[]
        parent=self
        class Installation:
            def __init__(self,root,profile):self.root=root;self.state=root/'.asa'
            def identity(self):return parent.records
            def compose(self,*args):parent.compose_calls.append(args)
        self.mods={}
        for name in ('deployment','deployment.system','deployment.contracts','deployment.releases'):
            self.mods[name]=types.ModuleType(name)
        self.mods['deployment.system'].Installation=Installation
        self.mods['deployment.system'].operation_lock=lambda root:nullcontext()
        self.mods['deployment.contracts'].read_env=lambda path:dict(line.split('=',1) for line in path.read_text().splitlines() if '=' in line)
        self.mods['deployment.releases'].validate_resolved_images=lambda inst,release:None
        def update_env(path,origin):
            path.write_text('APP_DATABASE_URL='+self.key+'\n'+'\n'.join(k+'='+origin for k in self.keys)+'\n')
        self.helper=types.SimpleNamespace(PUBLIC_KEYS=self.keys,ROOT_CERT=self.prefix/'root.crt',
                SERVICE='asa-lab-lan-https.service',Refused=RuntimeError,
                cert_digest=lambda path:'same-ca',caddy_config=lambda ip,port:'config '+ip,
                update_public_env=update_env,verify=lambda *args:None)
        for attr,value in [('PREFIX',self.prefix),('CONFIG',self.config_file),('STATE',self.state_file)]:
            patcher=patch.object(m,attr,value);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch.dict(sys.modules,self.mods);patcher.start();self.addCleanup(patcher.stop)
    def test_repeat_configure_preserves_existing_dhcp_follow_approval(self):
        self.helper.validate_lan=lambda *args: None
        args=types.SimpleNamespace(root=self.root,interface='auto',follow_interface=False)
        with patch.object(m,'discover',return_value=self.old) as discover, \
             patch.object(m,'load_helper',return_value=self.helper), \
             patch.object(m,'reconcile',return_value=False), \
             patch.object(m,'export_client_kit'), patch.object(m,'install_timer'):
            m.configure(args)
        discover.assert_called_once_with('eno1', '192.168.1.115')
        self.assertTrue(json.loads(self.config_file.read_text())['follow_interface'])

    def test_existing_install_cannot_silently_expand_dhcp_trust(self):
        self.policy['follow_interface']=False
        self.config_file.write_text(json.dumps(self.policy))
        self.helper.validate_lan=lambda *args: None
        args=types.SimpleNamespace(root=self.root,interface='eno1',follow_interface=True)
        with patch.object(m,'discover',return_value=self.old), \
             patch.object(m,'load_helper',return_value=self.helper), \
             self.assertRaises(m.Refused):
            m.configure(args)

    def test_idle_tick_does_not_restart_anything(self):
        with patch.object(m,'call') as c:
            self.assertFalse(m.reconcile(self.policy,self.helper,self.old))
        c.assert_not_called();self.assertEqual(self.compose_calls,[])
    def test_approved_dhcp_move_changes_only_ingress_keeps_ca_and_db(self):
        with patch.object(m,'call') as c:
            self.assertTrue(m.reconcile(self.policy,self.helper,self.new))
        state=json.loads(self.state_file.read_text())
        self.assertEqual(state['phase'],'READY')
        self.assertEqual(state['origin'],self.new.origin)
        self.assertEqual(state['ca_sha256'],'same-ca')
        self.assertIn('APP_DATABASE_URL='+self.key,(self.root/'.env').read_text())
        self.assertEqual(len(self.compose_calls),1)
        self.assertEqual(self.compose_calls[0][-3:],('api','scratch','web'))
        self.assertIn('--no-deps',self.compose_calls[0]);self.assertIn('never',self.compose_calls[0])
        calls=[tuple(x.args) for x in c.call_args_list]
        self.assertTrue(any('10.42.3.0/24' in a and 'ufw'==a[0] for a in calls))
        self.assertTrue(any('delete' in a and '192.168.1.115' in a for a in calls))
        self.assertFalse(any('5432' in a or '19192' in a or '22' in a for a in calls))
    def test_rollback_restores_old_firewall_after_checkpoint_failure(self):
        original_save = m.save_json
        events = []

        def fail_after_old_rule_deleted(path, data):
            if path == self.state_file and data.get('phase') == 'READY' and \
                    data.get('origin') == self.new.origin:
                raise OSError('simulated lost state write after old rule removal')
            return original_save(path, data)

        def track_rule(endpoint, remove=False):
            events.append((endpoint.address, remove))

        with patch.object(m, 'save_json', side_effect=fail_after_old_rule_deleted), \
             patch.object(m, 'firewall', side_effect=track_rule), \
             patch.object(m, 'call'), \
             self.assertRaisesRegex(OSError, 'lost state write'):
            m.reconcile(self.policy, self.helper, self.new)

        self.assertIn((self.old.address, True), events)
        self.assertIn((self.old.address, False), events)
        self.assertIn((self.new.address, True), events)
        self.assertLess(events.index((self.old.address, False)),
                        events.index((self.new.address, True)))
        self.assertEqual(json.loads(self.state_file.read_text())['phase'],
                         'NETWORK_ROLLBACK_REVIEW')
        self.assertEqual((self.prefix / 'Caddyfile').read_text(), 'old-config')
        self.assertIn(self.old.origin, (self.root / '.env').read_text())

    def test_foreign_ca_is_blocked_before_modification(self):
        self.helper.cert_digest=lambda p:'different-ca'
        with patch.object(m,'call') as c,self.assertRaises(m.Refused):
            m.reconcile(self.policy,self.helper,self.new)
        c.assert_not_called();self.assertEqual(self.compose_calls,[])
    def test_unfinished_transition_is_not_repeated_blindly(self):
        self.state['phase']='NETWORK_SWITCHING';self.state_file.write_text(json.dumps(self.state))
        with patch.object(m,'call') as c,self.assertRaises(m.Refused):
            m.reconcile(self.policy,self.helper,self.new)
        c.assert_not_called()
    def test_data_identity_change_causes_refusal(self):
        altered={**self.records,'postgres':dict(id='other',mounts=[])}
        with self.assertRaises(m.Refused):m.verify_data_unchanged(self.records,altered)
    def test_env_failure_rolls_back_caddy_and_requires_review(self):
        def broken(path,origin):raise OSError('disk full')
        self.helper.update_public_env=broken
        with patch.object(m,'call') as c,self.assertRaises(OSError):
            m.reconcile(self.policy,self.helper,self.new)
        self.assertEqual((self.prefix/'Caddyfile').read_text(),'old-config')
        self.assertEqual(json.loads(self.state_file.read_text())['phase'],'NETWORK_ROLLBACK_REVIEW')
        self.assertIn(self.old.origin,(self.root/'.env').read_text())

if __name__=='__main__':
    unittest.main(verbosity=2)
