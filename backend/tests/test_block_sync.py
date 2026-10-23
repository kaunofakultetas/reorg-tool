############################################################
#  [*] Block and sighting sync regression tests
#
#  How the two nodes' chains reach the database.
#  sync_recent_blocks walks a node's best chain from its tip
#  downwards, by hash, and stops at the first block already in
#  the table: a warm database only pulls what is new, a node
#  that switched branches is mirrored down to where the
#  branches meet, and both nodes share one table, so the
#  diagram shows every branch either of them ever had. The new
#  blocks are stored oldest first, each in a commit of its
#  own, and only whole — its real coinbase message, its
#  header timestamp as it is (whatever the backend's clock
#  zone: days and hours are the browser's business), its
#  scrypt proof-of-work hash and the log2 of its cumulative
#  work: a block that
#  cannot be read ends the run there, the blocks below it
#  stay, and the next run goes on from them.
#  sync_tracked_transactions records which block each tracked
#  transaction sits in now, and never forgets an earlier
#  sighting. The real blocks of the live chain come out
#  exactly as the production database holds them.
#
#  Offline: a fake node answers over a patched transport, the
#  rows go to a throwaway file with the production schema,
#  and the process clock runs fourteen hours ahead of UTC, so
#  anything still reading it would show.
############################################################


import math
import unittest

from app.reorg_attack.fullnode_rpc import FullNodeRPC
from tests import helpers


ROW_COLUMNS = 'Height, Hash, PrevHash, CoinbaseMessage, Timestamp, ScryptHash, ChainWork'

# A clock zone as far from UTC as there is (UTC+14)
FAR_ZONE = 'Pacific/Kiritimati'








############################################################
# SyncTestCase
############################################################
#
# A throwaway database, the process clock in FAR_ZONE, one
# fake node — the public one — and the client the sync runs
# on.
#
# Used by:
#   - the test classes below
############################################################

class SyncTestCase(unittest.TestCase):

    def setUp(self):
        self.db = self.enterContext(helpers.TempDatabase())
        self.enterContext(helpers.clock_zone(FAR_ZONE))
        self.node = helpers.FakeNode(helpers.PUBLIC_HOST)
        self.network = self.enterContext(helpers.FakeNetwork(self.node))
        self.rpc = FullNodeRPC(helpers.TEST_CONFIG['publicside'])

    def heights(self):
        return [row[0] for row in self.db.rows('SELECT Height FROM Blockchain_Blocks ORDER BY Height')]

    def hashes(self):
        return {row[0] for row in self.db.rows('SELECT Hash FROM Blockchain_Blocks')}

    def row(self, block_hash):
        return self.db.rows(f'SELECT {ROW_COLUMNS} FROM Blockchain_Blocks WHERE Hash = ?', (block_hash,))[0]

    def heights_asked(self):
        return [params[0] for params in self.node.calls_to('getblockhash')]








############################################################
# BlockSyncTests
############################################################

class BlockSyncTests(SyncTestCase):

    def test_a_cold_sync_mirrors_the_newest_blocks_down_to_the_depth(self):
        self.node.add_chain(*helpers.make_chain('main', range(1, 151), helpers.PUBLIC_MINER))
        self.assertTrue(self.rpc.sync_recent_blocks(100))
        self.assertEqual(self.heights(), list(range(51, 151)))

    def test_a_chain_shorter_than_the_depth_is_mirrored_from_height_1_never_the_genesis(self):
        blocks, txs = helpers.make_chain('main', range(0, 21), helpers.PUBLIC_MINER)
        del blocks[0]['previousblockhash']
        self.node.add_chain(blocks, txs)

        self.assertTrue(self.rpc.sync_recent_blocks(100))
        self.assertEqual(self.heights(), list(range(1, 21)))
        self.assertNotIn(0, self.heights_asked())

    def test_each_row_carries_what_the_view_reads(self):
        blocks, txs = helpers.make_chain('main', range(6398, 6404), helpers.PUBLIC_MINER)
        self.node.add_chain(blocks, txs)
        self.rpc.sync_recent_blocks(6)

        tip = blocks[-1]
        self.assertEqual(self.row(tip['hash']), (
            6403, tip['hash'], blocks[-2]['hash'], helpers.PUBLIC_MINER, tip['time'],
            self.rpc.get_scrypt_hash(tip), math.log2(int(tip['chainwork'], 16)),
        ))

    def test_the_real_blocks_come_out_as_production_stored_them(self):
        # Each real block as a node's tip, mirrored one block deep
        for height, block in helpers.REAL_BLOCKS.items():
            with self.subTest(height=height):
                self.node.blocks, self.node.best = {}, {}
                self.node.add_chain([block], [helpers.coinbase_tx(block['tx'][0], helpers.REAL_COINBASE_SCRIPTS[height], block['hash'])])
                self.assertTrue(self.rpc.sync_recent_blocks(1))

                timestamp, message, scrypt_hash, log2_work = helpers.REAL_ROWS[height]
                self.assertEqual(self.row(block['hash']), (
                    height, block['hash'], block['previousblockhash'], message, timestamp, scrypt_hash, log2_work,
                ))

    def test_the_stored_time_is_the_headers_own_timestamp(self):
        # One second before midnight UTC — already the next day on
        # the process clock: nothing turns it into a day here
        blocks, txs = helpers.make_chain('main', [6403], helpers.PUBLIC_MINER)
        blocks[0]['time'] = helpers.SCENE_DAY_START - 1
        self.node.add_chain(blocks, txs)
        self.rpc.sync_recent_blocks(1)
        self.assertEqual(self.row(blocks[0]['hash'])[4], helpers.SCENE_DAY_START - 1)

    def test_a_warm_sync_reads_only_the_new_blocks(self):
        old, old_txs = helpers.make_chain('main', range(1, 121), helpers.PUBLIC_MINER)
        self.node.add_chain(old, old_txs)
        self.rpc.sync_recent_blocks(100)

        new, new_txs = helpers.make_chain('main', range(121, 124), helpers.PUBLIC_MINER, parent=old[-1]['hash'])
        self.node.add_chain(new, new_txs)
        self.node.calls.clear()
        self.assertTrue(self.rpc.sync_recent_blocks(100))

        # The first stored block is recognised by its hash alone; the
        # new ones are read oldest first
        self.assertEqual(self.heights_asked(), [123, 122, 121, 120])
        self.assertEqual([params[0] for params in self.node.calls_to('getblock')], [block['hash'] for block in new])
        self.assertEqual(self.heights(), list(range(21, 124)))

    def test_a_node_that_switched_branches_is_mirrored_down_to_where_they_meet(self):
        first, first_txs = helpers.make_chain('a', range(1, 11), helpers.PUBLIC_MINER)
        self.node.add_chain(first, first_txs)
        self.rpc.sync_recent_blocks(100)

        second, second_txs = helpers.make_chain('b', range(8, 13), helpers.ATTACKER, parent=first[6]['hash'])
        self.node.add_chain(second, second_txs)
        self.node.calls.clear()
        self.rpc.sync_recent_blocks(100)

        self.assertEqual(self.heights_asked(), [12, 11, 10, 9, 8, 7])
        # The branch it left stays: the diagram shows both
        self.assertEqual(self.hashes(), {block['hash'] for block in first + second})

    def test_both_nodes_share_one_table(self):
        shared, shared_txs = helpers.make_chain('shared', range(1, 6), helpers.PUBLIC_MINER)
        public, public_txs = helpers.make_chain('public', range(6, 8), helpers.PUBLIC_MINER, parent=shared[-1]['hash'])
        private, private_txs = helpers.make_chain('private', range(6, 9), helpers.ATTACKER, parent=shared[-1]['hash'])
        self.node.add_chain(shared + public, shared_txs + public_txs)
        private_node = helpers.FakeNode(helpers.PRIVATE_HOST)
        private_node.add_chain(shared + private, shared_txs + private_txs)
        self.network.nodes[helpers.PRIVATE_HOST] = private_node

        self.rpc.sync_recent_blocks(100)
        FullNodeRPC(helpers.TEST_CONFIG['privateside']).sync_recent_blocks(100)

        # The private walk stops at the shared block the public one stored
        self.assertEqual([params[0] for params in private_node.calls_to('getblockhash')], [8, 7, 6, 5])
        self.assertEqual(self.hashes(), {block['hash'] for block in shared + public + private})

    def test_a_block_whose_coinbase_cannot_be_read_waits_for_the_next_run(self):
        # Never stored without its message — the page would paint it
        # as the attacker's for good
        blocks, txs = helpers.make_chain('main', range(6398, 6404), helpers.PUBLIC_MINER)
        self.node.add_chain(blocks, txs)
        self.node.refuse('getrawtransaction', 'Work queue depth exceeded', code=-1,
                         when=lambda params: params[0] == blocks[-1]['tx'][0])

        self.assertFalse(self.rpc.sync_recent_blocks(6))
        self.assertEqual(self.heights(), list(range(6398, 6403)))

        self.node.refusals.clear()
        self.assertTrue(self.rpc.sync_recent_blocks(6))
        self.assertEqual(self.row(blocks[-1]['hash'])[3], helpers.PUBLIC_MINER)

    def test_the_message_is_read_off_the_blocks_first_transaction(self):
        # A student's spends follow the coinbase, and once MWEB is
        # active every block ends in its HogEx — only the first is read
        blocks, txs = helpers.make_chain('main', [6403], helpers.PUBLIC_MINER)
        spend = helpers.spend_tx('dd' * 32, 'cc' * 32, blocks[0]['hash'])
        hogex = helpers.spend_tx('ee' * 32, 'cc' * 32, blocks[0]['hash'])
        blocks[0]['tx'] = blocks[0]['tx'] + [spend['txid'], hogex['txid']]
        self.node.add_chain(blocks, txs + [spend, hogex])

        self.assertTrue(self.rpc.sync_recent_blocks(1))
        self.assertEqual(self.row(blocks[0]['hash'])[3], helpers.PUBLIC_MINER)
        self.assertEqual(self.node.calls_to('getrawtransaction'), [[txs[0]['txid'], True]])

    def test_a_block_without_transactions_keeps_an_empty_message(self):
        blocks, txs = helpers.make_chain('main', [6403], helpers.PUBLIC_MINER)
        blocks[0]['tx'] = []
        self.node.add_chain(blocks, txs)
        self.rpc.sync_recent_blocks(1)
        self.assertEqual(self.row(blocks[0]['hash'])[3], '')

    def test_a_block_that_cannot_be_read_ends_the_run_and_the_next_goes_on_from_there(self):
        # The blocks below it stay — stored blocks always reach down
        # unbroken, so nothing is read twice and nothing is skipped
        blocks, txs = helpers.make_chain('main', range(1, 11), helpers.PUBLIC_MINER)
        self.node.add_chain(blocks, txs)
        self.node.refuse('getblock', 'Block not found', code=-5, when=lambda params: params[0] == blocks[4]['hash'])

        self.assertFalse(self.rpc.sync_recent_blocks(100))
        self.assertEqual(self.heights(), [1, 2, 3, 4])

        self.node.refusals.clear()
        self.node.calls.clear()
        self.assertTrue(self.rpc.sync_recent_blocks(100))
        self.assertEqual(self.heights(), list(range(1, 11)))
        self.assertEqual([params[0] for params in self.node.calls_to('getblock')], [block['hash'] for block in blocks[4:]])

    def test_a_node_that_cannot_be_reached_stores_nothing(self):
        self.node.add_chain(*helpers.make_chain('main', range(1, 11), helpers.PUBLIC_MINER))
        self.node.down = True
        self.assertFalse(self.rpc.sync_recent_blocks(100))
        self.assertEqual(self.heights(), [])

    def test_syncing_again_stores_each_block_once(self):
        self.node.add_chain(*helpers.make_chain('main', range(1, 11), helpers.PUBLIC_MINER))
        self.rpc.sync_recent_blocks(100)
        self.rpc.sync_recent_blocks(100)
        self.assertEqual(self.heights(), list(range(1, 11)))








############################################################
# SightingSyncTests
############################################################
#
# Two blocks on the node's chain, one spend mined into each,
# and a third spend waiting in the mempool.
############################################################

class SightingSyncTests(SyncTestCase):

    def setUp(self):
        super().setUp()
        self.blocks, txs = helpers.make_chain('main', range(6398, 6404), helpers.PUBLIC_MINER)
        self.node.add_chain(self.blocks, txs)
        self.mined_first = helpers.spend_tx('a1' * 32, txs[0]['txid'], blockhash=self.blocks[3]['hash'])
        self.mined_second = helpers.spend_tx('a2' * 32, txs[1]['txid'], blockhash=self.blocks[4]['hash'])
        self.waiting = helpers.spend_tx('a3' * 32, txs[2]['txid'])
        for tx in (self.mined_first, self.mined_second, self.waiting):
            self.node.add_tx(tx)

    def sightings(self):
        return set(self.db.rows('SELECT TXID, BlockHash FROM Blockchain_TxInBlocks'))

    def test_records_the_block_each_transaction_sits_in(self):
        self.assertTrue(self.rpc.sync_tracked_transactions(['a1' * 32, 'a2' * 32]))
        self.assertEqual(self.sightings(), {('a1' * 32, self.blocks[3]['hash']), ('a2' * 32, self.blocks[4]['hash'])})

    def test_a_transaction_still_waiting_in_the_mempool_records_nothing(self):
        self.rpc.sync_tracked_transactions(['a3' * 32])
        self.assertEqual(self.sightings(), set())

    def test_a_txid_the_node_does_not_know_is_skipped_and_the_rest_still_read(self):
        self.assertTrue(self.rpc.sync_tracked_transactions(['ff' * 32, 'a1' * 32]))
        self.assertEqual(self.sightings(), {('a1' * 32, self.blocks[3]['hash'])})

    def test_a_sighting_is_recorded_once(self):
        self.rpc.sync_tracked_transactions(['a1' * 32])
        self.rpc.sync_tracked_transactions(['a1' * 32])
        self.assertEqual(len(self.sightings()), 1)

    def test_an_earlier_sighting_stays_after_the_transaction_moved(self):
        # After a reorg the page still shows the coin in the block the
        # transaction left — the double-spend's trail
        self.rpc.sync_tracked_transactions(['a1' * 32])
        self.node.add_tx(dict(self.mined_first, blockhash=self.blocks[5]['hash']))
        self.rpc.sync_tracked_transactions(['a1' * 32])
        self.assertEqual(self.sightings(), {('a1' * 32, self.blocks[3]['hash']), ('a1' * 32, self.blocks[5]['hash'])})

    def test_reports_success_even_when_the_node_cannot_be_reached(self):
        self.node.down = True
        self.assertTrue(self.rpc.sync_tracked_transactions(['a1' * 32, 'a2' * 32]))
        self.assertEqual(self.sightings(), set())


if __name__ == '__main__':
    unittest.main()
