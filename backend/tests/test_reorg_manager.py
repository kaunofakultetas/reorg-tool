############################################################
#  [*] Reorg attack manager regression tests
#
#  The attack view and the actions, end to end against the
#  attack scene — the public network's node and the students'
#  private one, a shared history, then two diverged branches —
#  and a throwaway database:
#
#    sync     — sync_recent_data brings both nodes' blocks and
#               the tracked sightings in, and says whose
#               blocks came through
#    view     — get_blockchain_data serves the day's blocks in
#               height order (the newest 100 when the day has
#               fewer), both tips, and every tracked
#               transaction with its sightings refreshed on
#               both nodes; a node that cannot be read leaves
#               the stored blocks in the view, and a silent one
#               leaves only its own tip out
#    status   — the private node's connection state with the
#               public tip (marked unavailable when the public
#               node is silent) and the stored-block summary
#    actions  — a raw transaction goes to the PRIVATE node
#               only and is tracked under its colour; tracking
#               asks both nodes, the private one first, and
#               refuses a txid neither knows in words; a
#               re-track refreshes the colour; untracking
#               forgets the transaction and its sightings
#    database — ReorgDatabase's reads: the tracked list with
#               its colour fallback, the summary per coinbase,
#               the day's block hashes, one network's blocks
############################################################


import json
import sqlite3
import unittest
from unittest import mock

from app.reorg_attack.reorg import ReorgDatabase, UnknownTransaction
from tests import helpers


RAW_TX = '0200000000010198c12bd8a3f2bf7e3a0c0b1c75d6c3bd8e2b0a4e1c3f5a7b9d2e4f6a8b0c1d3e50000000000fdffffff'

# The block fields the attack page reads
BLOCK_FIELDS = {'height', 'hash', 'prevHash', 'coinbase', 'timestamp', 'scryptHash', 'chainWork'}

# The start of the day two days before the scene's, in UTC
EARLIER_DAY_START = helpers.SCENE_DAY_START - 2 * helpers.DAY








############################################################
# ManagerTestCase
############################################################
#
# The attack scene on the fake network, a throwaway database
# and a manager wired to the two nodes. track_row stores a
# tracked transaction with its sightings the way the tracker
# does; seed_day stores public blocks at noon (UTC) of the
# day starting at the given timestamp.
#
# Used by:
#   - the test classes below
############################################################

class ManagerTestCase(unittest.TestCase):

    def setUp(self):
        self.db = self.enterContext(helpers.TempDatabase())
        self.scene = helpers.attack_scene()
        self.public, self.private = self.scene.public_node, self.scene.private_node
        self.enterContext(helpers.FakeNetwork(self.public, self.private))
        self.manager = helpers.make_manager()
        self.every_block = self.scene.shared + self.scene.public + self.scene.private

    def track_row(self, txid, color, *block_hashes):
        with self.db.connect() as conn:
            conn.execute('INSERT INTO Blockchain_Transactions VALUES (?, ?, ?, ?)', (txid, '[]', '[]', color))
            for block_hash in block_hashes:
                conn.execute('INSERT INTO Blockchain_TxInBlocks VALUES (?, ?)', (txid, block_hash))

    def view(self, since=helpers.SCENE_DAY_START):
        answer = self.manager.get_blockchain_data(since)
        self.assertTrue(answer['success'])
        return answer['data']

    def seed_day(self, day_start, heights):
        label = f'day-{day_start}'
        for height in heights:
            self.db.store_block(height, helpers.block_hash(label, height), helpers.block_hash(label, height - 1),
                                helpers.PUBLIC_MINER, day_start + helpers.DAY // 2)

    def time_of(self, height):
        return next(block['time'] for block in self.every_block if block['height'] == height)








############################################################
# SyncDataTests
############################################################

class SyncDataTests(ManagerTestCase):

    def test_both_nodes_blocks_and_the_tracked_sightings_come_in(self):
        mined = helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.public[0]['hash'])
        self.public.add_tx(mined)
        self.track_row(mined['txid'], 'red')

        self.assertEqual(self.manager.sync_recent_data(), {'private': True, 'public': True})
        self.assertEqual({row[0] for row in self.db.rows('SELECT Hash FROM Blockchain_Blocks')},
                         {block['hash'] for block in self.every_block})
        self.assertEqual(self.db.rows('SELECT TXID, BlockHash FROM Blockchain_TxInBlocks'),
                         [(mined['txid'], self.scene.public[0]['hash'])])

    def test_a_silent_node_is_named_not_raised(self):
        self.public.down = True
        self.assertEqual(self.manager.sync_recent_data(), {'private': True, 'public': False})








############################################################
# ViewTests
############################################################

class ViewTests(ManagerTestCase):

    def test_the_view_holds_both_branches_and_both_tips(self):
        data = self.view()
        self.assertEqual({block['hash'] for block in data['chainBlocks']}, {block['hash'] for block in self.every_block})
        self.assertEqual(data['chainTips'], {'public': self.scene.public[-1]['hash'], 'private': self.scene.private[-1]['hash']})

    def test_each_block_carries_the_fields_the_page_reads(self):
        blocks = {block['hash']: block for block in self.view()['chainBlocks']}
        tip = blocks[self.scene.private[-1]['hash']]
        self.assertEqual(set(tip), BLOCK_FIELDS)
        self.assertEqual((tip['height'], tip['prevHash'], tip['coinbase'], tip['timestamp']),
                         (6403, self.scene.private[-2]['hash'], helpers.ATTACKER, self.scene.private[-1]['time']))

    def test_the_view_reads_both_nodes_before_it_answers(self):
        self.view()
        for node in (self.public, self.private):
            with self.subTest(node=node.host):
                self.assertTrue(node.calls_to('getblockcount'))
                self.assertTrue(node.calls_to('getblockchaininfo'))

    def test_fewer_than_100_blocks_since_shows_the_newest_100_instead(self):
        # The 48 blocks since 6360 give way to the newest 100: the
        # forks' five, then the shared history down to 6306
        blocks = self.view(self.time_of(6360))['chainBlocks']
        self.assertEqual(len(blocks), 100)
        self.assertEqual(min(block['height'] for block in blocks), 6306)
        self.assertEqual(max(block['height'] for block in blocks), 6403)

    def test_no_block_since_shows_the_newest_100(self):
        self.assertEqual(len(self.view(helpers.SCENE_DAY_START + helpers.DAY)['chainBlocks']), 100)

    def test_without_since_the_newest_100_are_shown(self):
        blocks = self.view(None)['chainBlocks']
        self.assertEqual(len(blocks), 100)
        self.assertEqual(min(block['height'] for block in blocks), 6306)

    def test_100_blocks_or_more_since_are_shown_whole(self):
        # Since is a lower bound only: the earlier day's blocks and
        # every block after them
        self.assertEqual(len(self.view()['chainBlocks']), len(self.every_block))
        self.seed_day(EARLIER_DAY_START, range(6100, 6220))
        heights = [block['height'] for block in self.view(EARLIER_DAY_START)['chainBlocks']]
        self.assertEqual(len(heights), 120 + len(self.every_block))
        self.assertTrue(set(range(6100, 6220)) <= set(heights))

    def test_since_counts_to_the_second(self):
        # The block mined at since is in, one mined a second before
        # it is not — both views still hold 100 blocks or more
        first = self.time_of(6304)
        self.assertIn(6304, [block['height'] for block in self.view(first)['chainBlocks']])
        self.assertNotIn(6304, [block['height'] for block in self.view(first + 1)['chainBlocks']])

    def test_every_tracked_transaction_comes_with_its_sightings_on_both_nodes(self):
        spend = helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.public[0]['hash'])
        double = helpers.spend_tx('a2' * 32, 'c1' * 32, blockhash=self.scene.private[1]['hash'])
        self.public.add_tx(spend)
        self.private.add_tx(double)
        self.track_row(spend['txid'], 'red')
        self.track_row(double['txid'], '')

        tracked = {tx['txid']: tx for tx in self.view()['transactions']}
        self.assertEqual(tracked[spend['txid']], {'txid': spend['txid'], 'color': 'red', 'blocks': [self.scene.public[0]['hash']]})
        self.assertEqual(tracked[double['txid']], {'txid': double['txid'], 'color': 'blue', 'blocks': [self.scene.private[1]['hash']]})

    def test_sightings_are_read_again_on_every_view(self):
        waiting = helpers.spend_tx('a3' * 32, 'c1' * 32)
        self.private.add_tx(waiting)
        self.track_row(waiting['txid'], 'green')
        self.assertEqual(self.view()['transactions'][0]['blocks'], [])

        self.private.add_tx(dict(waiting, blockhash=self.scene.private[2]['hash']))
        self.assertEqual(self.view()['transactions'][0]['blocks'], [self.scene.private[2]['hash']])

    def test_a_node_whose_blocks_cannot_be_read_leaves_the_stored_ones_in_the_view(self):
        self.view()
        self.private.refuse('getblock', 'Block not found', code=-5)
        data = self.view()
        self.assertEqual(len(data['chainBlocks']), len(self.every_block))
        self.assertEqual(data['chainTips']['private'], self.scene.private[-1]['hash'])

    def test_a_silent_node_leaves_only_its_own_tip_out_of_the_view(self):
        self.view()
        self.public.down = True
        data = self.view()
        self.assertEqual(data['chainTips'], {'public': None, 'private': self.scene.private[-1]['hash']})
        self.assertEqual(len(data['chainBlocks']), len(self.every_block))

    def test_the_day_comes_in_height_order(self):
        heights = [block['height'] for block in self.view()['chainBlocks']]
        self.assertEqual(heights, sorted(heights))
        self.assertEqual(heights[0], 6304)

    def test_the_newest_100_come_in_height_order_too(self):
        heights = [block['height'] for block in self.view(helpers.SCENE_DAY_START + helpers.DAY)['chainBlocks']]
        self.assertEqual(heights, sorted(heights))








############################################################
# StatusTests
############################################################

class StatusTests(ManagerTestCase):

    def test_the_status_while_detached(self):
        self.view()
        status = self.manager.get_network_status()

        self.assertTrue(status['success'])
        self.assertIs(status['status']['isConnectedToPublic'], False)
        self.assertEqual(status['status']['connection'], {'peers': []})
        self.assertEqual(status['status']['privateTip'], {'hash': self.scene.private[-1]['hash'], 'height': 6403, 'available': True})
        self.assertEqual(status['status']['publicTip'], {'hash': self.scene.public[-1]['hash'], 'height': 6402, 'available': True})

    def test_the_status_while_attached(self):
        self.private.peers.append(helpers.peer_entry(helpers.PUBLIC_PEER))
        status = self.manager.get_network_status()['status']
        self.assertIs(status['isConnectedToPublic'], True)
        self.assertEqual([peer['addr'] for peer in status['connection']['peers']], [helpers.PUBLIC_PEER])

    def test_the_status_sums_up_the_stored_blocks_per_coinbase(self):
        self.view()
        summary = self.manager.get_network_status()['status']['blocksSummary']
        times = [block['time'] for block in self.every_block]
        self.assertEqual(summary['total'], {'count': len(self.every_block), 'height_range': '6304-6403',
                                            'earliest_timestamp': min(times), 'latest_timestamp': max(times)})
        self.assertEqual(summary['by_coinbase'], {
            helpers.PUBLIC_MINER: {'count': len(self.every_block) - 3, 'height_range': '6304-6402'},
            helpers.ATTACKER: {'count': 3, 'height_range': '6401-6403'},
        })

    def test_a_silent_public_node_leaves_the_private_nodes_state_in_the_status(self):
        # The switch the page shows is the private node's — it stays
        self.public.down = True
        status = self.manager.get_network_status()
        self.assertTrue(status['success'])
        self.assertIs(status['status']['isConnectedToPublic'], False)
        self.assertEqual(status['status']['privateTip']['height'], 6403)
        self.assertEqual(status['status']['publicTip'], {'hash': None, 'height': None, 'available': False})

    def test_a_silent_private_node_leaves_no_status_to_give(self):
        self.private.down = True
        with self.assertRaises(Exception):
            self.manager.get_network_status()

    def test_the_summary_of_an_empty_database(self):
        summary = self.manager.get_network_status()['status']['blocksSummary']
        self.assertEqual(summary, {'total': {'count': 0, 'height_range': 'N/A', 'earliest_timestamp': None,
                                             'latest_timestamp': None}, 'by_coinbase': {}})








############################################################
# ActionTests
############################################################

class ActionTests(ManagerTestCase):

    def tracked(self):
        return self.db.rows('SELECT TXID, Inputs, Outputs, Color FROM Blockchain_Transactions')

    def sightings(self):
        return set(self.db.rows('SELECT TXID, BlockHash FROM Blockchain_TxInBlocks'))

    def test_a_raw_transaction_goes_to_the_private_node_only(self):
        sent = helpers.spend_tx('a1' * 32, 'c1' * 32)
        self.private.accepts[RAW_TX] = sent

        answer = self.manager.send_raw_transaction(RAW_TX, 'cyan')

        self.assertEqual(answer, {'success': True, 'message': 'Transaction sent successfully', 'txid': sent['txid']})
        self.assertEqual(self.private.calls_to('sendrawtransaction'), [[RAW_TX]])
        self.assertEqual(self.public.calls_to('sendrawtransaction'), [])

    def test_a_sent_transaction_is_tracked_under_its_colour(self):
        sent = helpers.spend_tx('a1' * 32, 'c1' * 32)
        self.private.accepts[RAW_TX] = sent
        self.manager.send_raw_transaction(RAW_TX, 'cyan')
        self.assertEqual(self.tracked(), [(sent['txid'], json.dumps(sent['vin']), json.dumps(sent['vout']), 'cyan')])

    def test_a_send_still_succeeds_when_the_tracking_fails(self):
        # The broadcast already happened — the student must hear so
        self.private.accepts[RAW_TX] = helpers.spend_tx('a1' * 32, 'c1' * 32)
        with mock.patch.object(self.manager, 'track_transaction', side_effect=sqlite3.OperationalError('database is locked')):
            self.assertTrue(self.manager.send_raw_transaction(RAW_TX, 'cyan')['success'])

    def test_a_refused_transaction_says_why_and_tracks_nothing(self):
        self.private.refuse('sendrawtransaction', 'bad-txns-inputs-missingorspent', code=-25)
        answer = self.manager.send_raw_transaction(RAW_TX, 'cyan')
        self.assertEqual(answer, {'success': False, 'message': "Failed to send transaction: RPC Error: "
                                                               "{'code': -25, 'message': 'bad-txns-inputs-missingorspent'}"})
        self.assertEqual(self.tracked(), [])

    def test_tracking_takes_the_transaction_from_the_private_node_first(self):
        private_view = helpers.spend_tx('a1' * 32, 'c1' * 32)
        public_view = dict(private_view, vout=[{'value': 9.0, 'n': 0, 'scriptPubKey': {'type': 'pubkeyhash'}}])
        self.private.add_tx(private_view)
        self.public.add_tx(public_view)
        self.manager.track_transaction('a1' * 32, 'green')
        self.assertEqual(self.tracked()[0][2], json.dumps(private_view['vout']))

    def test_a_transaction_only_the_public_node_knows_is_read_from_there(self):
        public_view = helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.public[0]['hash'])
        self.public.add_tx(public_view)
        answer = self.manager.track_transaction('a1' * 32, 'green')
        self.assertEqual(answer['transaction']['blocks'], [self.scene.public[0]['hash']])
        self.assertEqual(self.tracked(), [('a1' * 32, json.dumps(public_view['vin']), json.dumps(public_view['vout']), 'green')])

    def test_tracking_notes_the_block_on_each_node_that_mined_it(self):
        self.private.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.private[1]['hash']))
        self.public.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.public[0]['hash']))

        answer = self.manager.track_transaction('a1' * 32, 'green')

        self.assertEqual(answer, {'success': True, 'transaction': {
            'txid': 'a1' * 32, 'color': 'green', 'blocks': [self.scene.private[1]['hash'], self.scene.public[0]['hash']]}})
        self.assertEqual(self.sightings(), {('a1' * 32, self.scene.private[1]['hash']), ('a1' * 32, self.scene.public[0]['hash'])})

    def test_a_transaction_waiting_in_the_mempool_is_tracked_without_a_block(self):
        self.private.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32))
        answer = self.manager.track_transaction('a1' * 32, 'orange')
        self.assertEqual(answer['transaction']['blocks'], [])
        self.assertEqual([row[0] for row in self.tracked()], ['a1' * 32])
        self.assertEqual(self.sightings(), set())

    def test_tracking_again_refreshes_the_colour_and_keeps_the_sightings(self):
        self.private.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.private[1]['hash']))
        self.manager.track_transaction('a1' * 32, 'green')
        self.manager.track_transaction('a1' * 32, 'purple')
        self.assertEqual([row[3] for row in self.tracked()], ['purple'])
        self.assertEqual(self.sightings(), {('a1' * 32, self.scene.private[1]['hash'])})

    def test_a_txid_neither_node_knows_is_refused_in_words_and_not_stored(self):
        with self.assertRaises(UnknownTransaction) as raised:
            self.manager.track_transaction('ff' * 32, 'green')
        self.assertEqual(str(raised.exception), f'Transaction {"ff" * 32} is not known to either node')
        self.assertEqual(self.tracked(), [])

    def test_a_node_that_cannot_be_asked_fails_the_tracking_as_itself(self):
        # The public node does not know it — the private one may
        self.private.down = True
        with self.assertRaises(Exception) as raised:
            self.manager.track_transaction('ff' * 32, 'green')
        self.assertNotIsInstance(raised.exception, UnknownTransaction)
        self.assertIn('RPC Connection Error', str(raised.exception))
        self.assertEqual(self.tracked(), [])

    def test_untracking_forgets_the_transaction_and_its_sightings(self):
        self.track_row('a1' * 32, 'green', self.scene.private[1]['hash'])
        self.track_row('a2' * 32, 'red', self.scene.public[0]['hash'])

        answer = self.manager.remove_transaction_tracking('a1' * 32)

        self.assertEqual(answer, {'success': True, 'message': 'Transaction tracking removed successfully'})
        self.assertEqual([row[0] for row in self.tracked()], ['a2' * 32])
        self.assertEqual(self.sightings(), {('a2' * 32, self.scene.public[0]['hash'])})

    def test_untracking_a_txid_never_tracked_is_harmless(self):
        self.assertTrue(self.manager.remove_transaction_tracking('ff' * 32)['success'])








############################################################
# DatabaseReadTests
############################################################
#
# ReorgDatabase on its own, over rows written directly.
############################################################

class DatabaseReadTests(ManagerTestCase):

    def test_the_tracked_list_carries_each_transactions_colour_and_blocks(self):
        self.track_row('a1' * 32, 'green', 'b1' * 32, 'b2' * 32)
        self.track_row('a2' * 32, 'red')
        self.assertEqual(ReorgDatabase.get_all_tracked_transactions(), [
            {'txid': 'a1' * 32, 'color': 'green', 'blocks': ['b1' * 32, 'b2' * 32]},
            {'txid': 'a2' * 32, 'color': 'red', 'blocks': []},
        ])

    def test_a_transaction_stored_without_a_colour_reads_as_blue(self):
        self.track_row('a1' * 32, '')
        self.assertEqual(ReorgDatabase.get_all_tracked_transactions()[0]['color'], 'blue')

    def test_the_summary_groups_by_the_exact_coinbase_message(self):
        self.db.store_block(10, 'h10', 'h9', helpers.PUBLIC_MINER, EARLIER_DAY_START)
        self.db.store_block(11, 'h11', 'h10', helpers.STRATUM, EARLIER_DAY_START + helpers.DAY)
        self.db.store_block(12, 'h12', 'h11', helpers.STRATUM, helpers.SCENE_DAY_START)
        self.assertEqual(ReorgDatabase.get_blocks_summary(), {
            'total': {'count': 3, 'height_range': '10-12', 'earliest_timestamp': EARLIER_DAY_START,
                      'latest_timestamp': helpers.SCENE_DAY_START},
            'by_coinbase': {helpers.STRATUM: {'count': 2, 'height_range': '11-12'},
                            helpers.PUBLIC_MINER: {'count': 1, 'height_range': '10-10'}},
        })

    def test_the_block_hashes_of_a_time_range_newest_first(self):
        # Nothing calls this at the moment. The range is half-open:
        # the earlier day's start is in, the next day's start is out
        next_day = EARLIER_DAY_START + helpers.DAY
        self.seed_day(EARLIER_DAY_START, range(1, 4))
        self.seed_day(next_day, range(4, 6))
        self.assertEqual(ReorgDatabase.get_existing_block_hashes(EARLIER_DAY_START, next_day),
                         [helpers.block_hash(f'day-{EARLIER_DAY_START}', height) for height in (3, 2, 1)])
        self.assertEqual(ReorgDatabase.get_existing_block_hashes(since=next_day),
                         [helpers.block_hash(f'day-{next_day}', height) for height in (5, 4)])
        self.assertEqual(len(ReorgDatabase.get_existing_block_hashes()), 5)
        self.assertEqual(ReorgDatabase.get_existing_block_hashes(0, EARLIER_DAY_START), [])

    def test_the_blocks_of_one_network_in_a_time_range(self):
        # The network is the coinbase's: "Public Miner" or not
        ten = EARLIER_DAY_START + 10 * 3600
        self.db.store_block(11, 'h11', 'h10', helpers.STRATUM, ten)
        self.db.store_block(10, 'h10', 'h9', helpers.PUBLIC_MINER, ten - 60)
        self.db.store_block(12, 'h12', 'h11', helpers.ATTACKER, ten + 60)
        self.db.store_block(13, 'h13', 'h12', helpers.ATTACKER, EARLIER_DAY_START + helpers.DAY)

        day = (EARLIER_DAY_START, EARLIER_DAY_START + helpers.DAY)
        self.assertEqual(ReorgDatabase.get_blocks_by_network('private', *day), [
            ('private', 11, 'h11', 'h10', helpers.STRATUM, ten),
            ('private', 12, 'h12', 'h11', helpers.ATTACKER, ten + 60),
        ])
        self.assertEqual(ReorgDatabase.get_blocks_by_network('public', *day),
                         [('public', 10, 'h10', 'h9', helpers.PUBLIC_MINER, ten - 60)])
        self.assertEqual([row[1] for row in ReorgDatabase.get_blocks_by_network('private')], [11, 12, 13])


if __name__ == '__main__':
    unittest.main()
