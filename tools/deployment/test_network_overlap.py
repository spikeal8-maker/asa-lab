import unittest

from deployment.network_overlap import collisions


class NetworkOverlapTests(unittest.TestCase):
    def test_unattached_scratch_network_can_hide_gpu_from_api(self):
        networks = [{'Name': 'asa-lab-dev_scratch-runtime',
                     'IPAM': {'Config': [{'Subnet': '192.168.0.0/20'}]}}]
        self.assertEqual(collisions(networks, ['192.168.1.112'])[0]['target'],
                         '192.168.1.112/32')

    def test_repaired_range_does_not_hide_lan(self):
        networks = [{'Name': 'scratch', 'IPAM': {
            'Config': [{'Subnet': '10.250.245.64/27'}]}}]
        self.assertEqual(collisions(networks, ['192.168.1.0/24']), [])

    def test_checks_foreign_networks_and_all_ipam_ranges_without_mutation(self):
        networks = [{'Name': 'other', 'IPAM': {'Config': [
            {'Subnet': '10.0.0.0/24'}, {'Subnet': '192.168.0.0/20'}]}},
                    {'Name': 'host', 'IPAM': {'Config': None}}]
        before = repr(networks)
        self.assertEqual(len(collisions(networks, ['192.168.1.0/24'])), 1)
        self.assertEqual(repr(networks), before)
