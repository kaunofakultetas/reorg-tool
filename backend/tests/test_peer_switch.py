############################################################
#  [*] Peer switch regression tests (FullNodeConnections)
#
#  The mechanism behind the attack toggle, on the private
#  node: its peer list with the retired dummy peer left out,
#  one "onetry" addnode at the public peer to attach, a
#  disconnectnode at it to split — reported as done also when
#  the peer was already gone, and failing for every other
#  reason, a node that cannot be reached included — and the
#  status the toggle reads: attached exactly when a peer is
#  left, each peer cut down to its address and connection,
#  with the node's own tip. Both peer addresses come from the
#  environment. Offline, against a fake private node.
############################################################


import os
import unittest
from unittest import mock

from app.reorg_attack.fullnode_rpc import FullNodeConnections, FullNodeRPC, RpcError
from tests import helpers








############################################################
# PeerSwitchTests
############################################################
#
# The private node of the attack scene: detached, able to
# reach the public peer when asked.
############################################################

class PeerSwitchTests(unittest.TestCase):

    def setUp(self):
        scene = helpers.attack_scene()
        self.node = scene.private_node
        self.tip = scene.private[-1]
        self.enterContext(helpers.FakeNetwork(self.node))
        with mock.patch.dict(os.environ, {'PUBLIC_PEER_ADDR': helpers.PUBLIC_PEER, 'DUMMY_PEER_ADDR': helpers.DUMMY_PEER}):
            self.switch = FullNodeConnections(FullNodeRPC(helpers.TEST_CONFIG['privateside']))

    def attach(self):
        self.node.peers.append(helpers.peer_entry(helpers.PUBLIC_PEER))

    def test_both_peer_addresses_come_from_the_environment(self):
        self.assertEqual((self.switch.public_peer_addr, self.switch.dummy_peer_addr), (helpers.PUBLIC_PEER, helpers.DUMMY_PEER))

    def test_the_peer_list_leaves_the_dummy_peer_out(self):
        self.attach()
        self.node.peers.append(helpers.peer_entry(helpers.DUMMY_PEER, 1))
        self.assertEqual([peer['addr'] for peer in self.switch.get_peer_info()], [helpers.PUBLIC_PEER])

    def test_the_full_peer_list_keeps_it(self):
        self.attach()
        self.node.peers.append(helpers.peer_entry(helpers.DUMMY_PEER, 1))
        self.assertEqual([peer['addr'] for peer in self.switch.get_peer_info(show_dummy=True)], [helpers.PUBLIC_PEER, helpers.DUMMY_PEER])

    def test_attaching_asks_for_one_try_at_the_public_peer(self):
        answer = self.switch.connect()
        self.assertEqual(self.node.calls_to('addnode'), [[helpers.PUBLIC_PEER, 'onetry']])
        self.assertEqual(answer, {'success': True, 'message': 'Network activity enabled', 'result': True})
        self.assertEqual([peer['addr'] for peer in self.node.peers], [helpers.PUBLIC_PEER])

    def test_attaching_raises_when_the_node_refuses(self):
        self.node.refuse('addnode', 'Error: Unable to open connection', code=-23)
        with self.assertRaises(Exception) as raised:
            self.switch.connect()
        self.assertIn('Unable to open connection', str(raised.exception))

    def test_splitting_drops_the_public_peer(self):
        self.attach()
        answer = self.switch.disconnect()
        self.assertEqual(self.node.calls_to('disconnectnode'), [[helpers.PUBLIC_PEER]])
        self.assertEqual(answer, {'success': True, 'message': 'Network activity disabled and peers disconnected'})
        self.assertEqual(self.node.peers, [])

    def test_splitting_when_the_peer_is_already_gone_is_reported_as_done(self):
        # The node refuses with "Node not found in connected nodes" —
        # the split the student asked for is in place all the same
        answer = self.switch.disconnect()
        self.assertEqual(answer['success'], True)

    def test_splitting_a_node_that_cannot_be_reached_fails(self):
        # The split did not happen — the student must not hear it did
        self.node.down = True
        with self.assertRaises(Exception) as raised:
            self.switch.disconnect()
        self.assertIn('RPC Connection Error', str(raised.exception))

    def test_any_other_refusal_of_the_split_fails(self):
        self.attach()
        self.node.refuse('disconnectnode', 'Error: Invalid IP/Subnet', code=-30)
        with self.assertRaises(RpcError) as raised:
            self.switch.disconnect()
        self.assertEqual(raised.exception.code, -30)

    def test_the_status_says_attached_while_a_peer_is_left(self):
        self.attach()
        status = self.switch.get_connection_status()
        self.assertEqual(status['success'], True)
        self.assertIs(status['status']['isConnectedToPublic'], True)
        self.assertEqual([peer['addr'] for peer in status['status']['connection']['peers']], [helpers.PUBLIC_PEER])

    def test_the_status_hands_out_only_each_peers_address_and_connection(self):
        # The rest of getpeerinfo has no business in the browser
        self.attach()
        peers = self.switch.get_connection_status()['status']['connection']['peers']
        self.assertEqual(peers, [{'addr': helpers.PUBLIC_PEER, 'connection_type': 'manual', 'inbound': False}])

    def test_the_status_says_detached_without_peers(self):
        status = self.switch.get_connection_status()
        self.assertIs(status['status']['isConnectedToPublic'], False)
        self.assertEqual(status['status']['connection']['peers'], [])

    def test_the_dummy_peer_alone_counts_as_detached(self):
        self.node.peers.append(helpers.peer_entry(helpers.DUMMY_PEER))
        self.assertIs(self.switch.get_connection_status()['status']['isConnectedToPublic'], False)

    def test_the_status_carries_the_private_nodes_tip(self):
        status = self.switch.get_connection_status()
        self.assertEqual(status['status']['privateTip'], {'hash': self.tip['hash'], 'height': 6403, 'available': True})

    def test_the_status_raises_when_the_node_cannot_be_reached(self):
        self.node.down = True
        with self.assertRaises(Exception):
            self.switch.get_connection_status()


if __name__ == '__main__':
    unittest.main()
