############################################################
#  [*] Config invariants
#
#  The backend's whole configuration is its way to the two
#  fullnodes: REORG_ATTACK_CONFIG in routes.py (each side's
#  host, port and credentials) and the peer switch's two
#  addresses in fullnode_rpc.py, all read from the
#  environment once, at import. These tests read them exactly
#  that way — in a fresh interpreter per environment — and
#  hold the contract both ways: every variable lands where
#  the clients read it, and without them the backend still
#  finds this stack's own nodes.
############################################################


import os
import sys
import json
import unittest
import subprocess

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Every variable the backend reads for its nodes
NODE_VARIABLES = (
    'PUBLIC_RPC_HOST', 'PUBLIC_RPC_PORT', 'PUBLIC_RPC_USER', 'PUBLIC_RPC_PASSWORD',
    'PRIVATE_RPC_HOST', 'PRIVATE_RPC_PORT', 'PRIVATE_RPC_USER', 'PRIVATE_RPC_PASSWORD',
    'PUBLIC_PEER_ADDR', 'DUMMY_PEER_ADDR',
)

# What a fresh interpreter prints of the configuration the
# backend built at import
CONFIG_PROBE = '''
import json
from app.reorg_attack import routes
from app.reorg_attack.fullnode_rpc import FullNodeConnections
switch = FullNodeConnections(None)
print(json.dumps({
    'config': routes.REORG_ATTACK_CONFIG,
    'public_peer': switch.public_peer_addr,
    'dummy_peer': switch.dummy_peer_addr,
}))
'''








############################################################
# config_under
############################################################
#
# The configuration the backend builds at import under the
# given environment: CONFIG_PROBE runs in a fresh
# interpreter, the node variables of this process taken out
# so only the ones a test names are set. Importing routes
# builds the manager, which opens no connection.
#
# Used by:
#   - NodeConfigTests (below)
############################################################

def config_under(env):
    clean = {key: value for key, value in os.environ.items() if key not in NODE_VARIABLES}
    clean.update(env)
    probe = subprocess.run([sys.executable, '-c', CONFIG_PROBE], env=clean, cwd=APP_ROOT,
                           capture_output=True, text=True, check=True)
    return json.loads(probe.stdout.strip().splitlines()[-1])








############################################################
# NodeConfigTests
############################################################
#
# The environment → configuration contract, both ways: every
# variable lands where the clients read it, and without them
# each side talks to this stack's node on port 19332 with the
# admin credentials, and the switch dials this stack's public
# node.
############################################################

class NodeConfigTests(unittest.TestCase):

    ENV = {
        'PUBLIC_RPC_HOST': 'viesas-mazgas', 'PUBLIC_RPC_PORT': '18001',
        'PUBLIC_RPC_USER': 'vieso-vartotojas', 'PUBLIC_RPC_PASSWORD': 'vieso-slaptazodis',
        'PRIVATE_RPC_HOST': 'privatus-mazgas', 'PRIVATE_RPC_PORT': '18002',
        'PRIVATE_RPC_USER': 'privataus-vartotojas', 'PRIVATE_RPC_PASSWORD': 'privataus-slaptazodis',
        'PUBLIC_PEER_ADDR': 'viesas-mazgas:49333', 'DUMMY_PEER_ADDR': 'manekenas:49333',
    }

    @classmethod
    def setUpClass(cls):
        cls.configured = config_under(cls.ENV)
        cls.defaults = config_under({})

    def test_each_side_reads_its_node_from_the_environment(self):
        self.assertEqual(self.configured['config'], {
            'publicside': {'rpchost': 'viesas-mazgas', 'rpcport': 18001,
                           'rpcuser': 'vieso-vartotojas', 'rpcpassword': 'vieso-slaptazodis'},
            'privateside': {'rpchost': 'privatus-mazgas', 'rpcport': 18002,
                            'rpcuser': 'privataus-vartotojas', 'rpcpassword': 'privataus-slaptazodis'},
        })

    def test_the_peer_switch_reads_its_peers_from_the_environment(self):
        self.assertEqual(self.configured['public_peer'], 'viesas-mazgas:49333')
        self.assertEqual(self.configured['dummy_peer'], 'manekenas:49333')

    def test_ports_become_numbers(self):
        # The URL is built from them — a string port would still work,
        # a port that is not a number must fail at boot
        for side in ('publicside', 'privateside'):
            self.assertIsInstance(self.configured['config'][side]['rpcport'], int)

    def test_without_the_environment_each_side_uses_port_19332_and_the_admin_credentials(self):
        for side in ('publicside', 'privateside'):
            with self.subTest(side=side):
                config = self.defaults['config'][side]
                self.assertEqual((config['rpcport'], config['rpcuser'], config['rpcpassword']), (19332, 'admin', 'admin'))

    def test_without_the_environment_each_side_talks_to_this_stacks_node(self):
        # The service names docker-compose.yml gives the two nodes
        config = self.defaults['config']
        self.assertEqual((config['publicside']['rpchost'], config['privateside']['rpchost']),
                         ('reorg-knfcoind-public', 'reorg-knfcoind-private'))

    def test_without_the_environment_the_switch_dials_this_stacks_public_node(self):
        self.assertEqual(self.defaults['public_peer'], 'reorg-knfcoind-public:49333')


if __name__ == '__main__':
    unittest.main()
