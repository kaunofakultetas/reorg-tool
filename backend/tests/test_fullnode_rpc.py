############################################################
#  [*] Fullnode RPC client regression tests
#
#  The JSON-RPC plumbing between the backend and the two KNF
#  Coin nodes, against a patched transport — no node, fully
#  deterministic:
#
#    transport — the request every call sends (a JSON-RPC 1.0
#                body, basic auth, a 3 s timeout); a node's
#                refusal raised with the node's own error
#                object, also under the HTTP 500 the node
#                sends it with; an answer that is no JSON-RPC
#                answer, a refused login or a node that cannot
#                be reached raised as a connection error
#    queries   — each wrapper's RPC verb and parameters, the
#                tip's shape
#    parsing   — the coinbase message read off real coinbase
#                scripts of the live chain, laid out as the
#                pool lays them: neither the height push nor
#                the extranonce mistaken for text, a message in
#                Lithuanian read whole, and every fallback of
#                the reader
#    hashing   — the scrypt proof-of-work hash of real blocks,
#                equal to what the backend stored for them and
#                below the target each block's bits encode, and
#                a signalling block's version hashed as the
#                node reports it
############################################################


import unittest
from unittest import mock

import requests
import scrypt

from app.reorg_attack.fullnode_rpc import FullNodeRPC, RpcError
from tests import helpers


NO_SUCH_TX = 'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.'


def answering(response):
    # requests.post answering one canned response — or raising it,
    # when it is an exception
    if isinstance(response, BaseException):
        return mock.patch.object(requests, 'post', side_effect=response)
    return mock.patch.object(requests, 'post', return_value=response)


def coinbase(script):
    # A coinbase transaction around one input script
    return {'vin': [{'coinbase': script, 'sequence': 4294967295}]}








############################################################
# TransportTests
############################################################

class TransportTests(unittest.TestCase):

    def setUp(self):
        self.rpc = FullNodeRPC(helpers.TEST_CONFIG['publicside'])

    def test_every_call_posts_a_json_rpc_1_0_body_with_basic_auth_and_a_3s_timeout(self):
        with answering(helpers.http_response(200, {'result': 6403, 'error': None, 'id': 'python'})) as post:
            self.rpc.rpc_call('getblockhash', [6403])

        url, = post.call_args.args
        kwargs = post.call_args.kwargs
        self.assertEqual(url, f'http://{helpers.PUBLIC_HOST}:{helpers.RPC_PORT}')
        self.assertEqual(kwargs['json'], {'jsonrpc': '1.0', 'id': 'python', 'method': 'getblockhash', 'params': [6403]})
        self.assertEqual((kwargs['auth'].username, kwargs['auth'].password), ('tester', 'test-rpc-secret'))
        self.assertEqual(kwargs['timeout'], 3)

    def test_a_call_without_parameters_sends_an_empty_list(self):
        with answering(helpers.http_response(200, {'result': 6403, 'error': None, 'id': 'python'})) as post:
            self.rpc.rpc_call('getblockcount')
        self.assertEqual(post.call_args.kwargs['json']['params'], [])

    def test_the_answer_is_the_result_field(self):
        with answering(helpers.http_response(200, {'result': {'blocks': 6403}, 'error': None, 'id': 'python'})):
            self.assertEqual(self.rpc.rpc_call('getblockchaininfo'), {'blocks': 6403})

    def test_a_refusal_raises_the_nodes_own_error_also_under_http_500(self):
        # A JSON-RPC 1.0 node sends its refusals with HTTP 500 — the
        # error object, not the status, is what the caller must see
        refusal = {'result': None, 'error': {'code': -5, 'message': NO_SUCH_TX}, 'id': 'python'}
        for status in (500, 200):
            with self.subTest(status=status), answering(helpers.http_response(status, refusal)):
                with self.assertRaises(RpcError) as raised:
                    self.rpc.rpc_call('getrawtransaction', ['cc' * 32, True])
                self.assertEqual(str(raised.exception), f"RPC Error: {{'code': -5, 'message': '{NO_SUCH_TX}'}}")
                self.assertEqual(raised.exception.code, -5)

    def test_a_connection_failure_is_no_refusal(self):
        # Callers act on a refusal's code — a node that did not answer
        # must never look like one
        with answering(requests.ConnectionError('Max retries exceeded')):
            with self.assertRaises(Exception) as raised:
                self.rpc.rpc_call('getblockcount')
        self.assertNotIsInstance(raised.exception, RpcError)

    def test_a_refused_login_is_a_connection_error(self):
        # The node answers a wrong password with a bare 401
        with answering(helpers.http_response(401, b'')):
            with self.assertRaises(Exception) as raised:
                self.rpc.rpc_call('getblockcount')
        self.assertTrue(str(raised.exception).startswith('RPC Connection Error: 401 Client Error'), raised.exception)

    def test_an_error_status_without_a_refusal_is_a_connection_error(self):
        with answering(helpers.http_response(503, {'result': None, 'error': None, 'id': 'python'})):
            with self.assertRaises(Exception) as raised:
                self.rpc.rpc_call('getblockcount')
        self.assertTrue(str(raised.exception).startswith('RPC Connection Error: 503 Server Error'), raised.exception)

    def test_a_success_status_without_json_says_there_was_none(self):
        with answering(helpers.http_response(200, b'<html><body>Bad Gateway</body></html>')):
            with self.assertRaises(Exception) as raised:
                self.rpc.rpc_call('getblockcount')
        self.assertEqual(str(raised.exception), 'No JSON response')

    def test_a_node_that_cannot_be_reached_or_does_not_answer_in_time_is_a_connection_error(self):
        for failure in (requests.ConnectionError('Max retries exceeded'), requests.ReadTimeout('Read timed out. (read timeout=3)')):
            with self.subTest(failure=type(failure).__name__), answering(failure):
                with self.assertRaises(Exception) as raised:
                    self.rpc.rpc_call('getblockcount')
                self.assertEqual(str(raised.exception), f'RPC Connection Error: {failure}')








############################################################
# QueryTests
############################################################
#
# Each wrapper against a fake node: the verb and the
# parameters it sends, the answer it hands back.
############################################################

class QueryTests(unittest.TestCase):

    def setUp(self):
        self.node = helpers.FakeNode(helpers.PUBLIC_HOST)
        blocks, txs = helpers.make_chain('public', range(6398, 6404), helpers.PUBLIC_MINER)
        self.node.add_chain(blocks, txs)
        self.blocks, self.txs = blocks, txs
        self.enterContext(helpers.FakeNetwork(self.node))
        self.rpc = FullNodeRPC(helpers.TEST_CONFIG['publicside'])

    def test_each_wrapper_sends_its_verb_and_parameters(self):
        tip, coinbase_tx = self.blocks[-1], self.txs[-1]
        self.rpc.get_blockchain_info()
        self.rpc.get_network_info()
        self.rpc.get_block_count()
        self.rpc.get_block_hash(6403)
        self.rpc.get_block(tip['hash'])
        self.rpc.get_block(tip['hash'], verbosity=2)
        self.rpc.get_raw_transaction(coinbase_tx['txid'])
        self.rpc.get_raw_transaction(coinbase_tx['txid'], verbose=False)

        self.assertEqual(self.node.calls, [
            ('getblockchaininfo', []),
            ('getnetworkinfo', []),
            ('getblockcount', []),
            ('getblockhash', [6403]),
            ('getblock', [tip['hash'], 1]),
            ('getblock', [tip['hash'], 2]),
            ('getrawtransaction', [coinbase_tx['txid'], True]),
            ('getrawtransaction', [coinbase_tx['txid'], False]),
        ])

    def test_the_answers_come_back_as_the_node_gave_them(self):
        self.assertEqual(self.rpc.get_block_count(), 6403)
        self.assertEqual(self.rpc.get_block_hash(6400), self.blocks[2]['hash'])
        self.assertEqual(self.rpc.get_block(self.blocks[2]['hash'])['previousblockhash'], self.blocks[1]['hash'])
        self.assertEqual(self.rpc.get_raw_transaction(self.txs[0]['txid'])['blockhash'], self.blocks[0]['hash'])

    def test_a_raw_transaction_is_broadcast_and_its_txid_handed_back(self):
        self.node.accepts['0200aa'] = helpers.spend_tx('dd' * 32, self.txs[0]['txid'])
        self.assertEqual(self.rpc.send_raw_transaction('0200aa'), 'dd' * 32)
        self.assertEqual(self.node.calls_to('sendrawtransaction'), [['0200aa']])

    def test_the_tip_is_the_best_block_with_its_height(self):
        self.assertEqual(self.rpc.get_tip_info(), {'hash': self.blocks[-1]['hash'], 'height': 6403, 'available': True})

    def test_a_tip_answer_without_its_fields_reads_as_empty(self):
        with mock.patch.object(self.rpc, 'get_blockchain_info', return_value={}):
            self.assertEqual(self.rpc.get_tip_info(), {'hash': '', 'height': 0, 'available': True})

    def test_a_node_that_cannot_be_reached_raises_from_every_query(self):
        # Nothing is swallowed here — the callers decide
        self.node.down = True
        for query in (self.rpc.get_tip_info, self.rpc.get_block_count, lambda: self.rpc.get_block_hash(6403)):
            with self.assertRaises(Exception):
                query()








############################################################
# CoinbaseMessageTests
############################################################
#
# The message a miner left in its coinbase — what tells the
# public miner's blocks from the attackers' on the page.
############################################################

class CoinbaseMessageTests(unittest.TestCase):

    def setUp(self):
        self.rpc = FullNodeRPC(helpers.TEST_CONFIG['publicside'])

    def message(self, script):
        return self.rpc.extract_coinbase_message(coinbase(script))

    def test_the_messages_of_the_live_chain_are_read_off_their_scripts(self):
        for height, (_, message, _, _) in helpers.REAL_ROWS.items():
            with self.subTest(height=height):
                self.assertEqual(self.message(helpers.REAL_COINBASE_SCRIPTS[height]), message)

    def test_more_scripts_of_the_live_chain_come_out_clean(self):
        # The first block, and two whose extranonce reads as text
        for height, (script, message) in helpers.REAL_COINBASE_READINGS.items():
            with self.subTest(height=height):
                self.assertEqual(self.message(script), message)

    def test_a_synthetic_coinbase_is_laid_out_as_the_live_chains(self):
        # The harness's builder against the live script, byte for byte
        self.assertEqual(helpers.coinbase_script(6403, helpers.PUBLIC_MINER), helpers.REAL_COINBASE_SCRIPTS[6403])

    def test_the_height_push_never_reaches_the_message(self):
        # From 8225 on both of a height's bytes are printable; from
        # 32768 the push grows to three bytes
        heights = (8225, 8257, 12345, 30000, 32768)
        self.assertEqual(helpers.coinbase_script(32768, '')[:8], '03008000')
        self.assertEqual([self.message(helpers.coinbase_script(height, helpers.PUBLIC_MINER)) for height in heights],
                         [helpers.PUBLIC_MINER] * len(heights))

    def test_the_extranonce_never_reaches_the_message_however_readable(self):
        # The pool's counter and the miner's value can be any bytes —
        # here eight printable ones
        script = helpers.coinbase_script(6403, helpers.PUBLIC_MINER, extranonce=b'l9 /AB2/'.hex())
        self.assertEqual(self.message(script), helpers.PUBLIC_MINER)

    def test_a_message_in_lithuanian_is_read_whole(self):
        # Laid out as block 4411's — its "ė" once read as a space
        message = '/Vardenis Pavardenis (2026-10-15) Labas rytas, skanios kavytės/'
        self.assertEqual(self.message(helpers.coinbase_script(4411, message, extranonce='0000000303000000')), message)

    def test_a_byte_that_is_no_utf8_reads_as_the_replacement_character(self):
        script = helpers.coinbase_script(6403, '') + helpers.PUBLIC_MINER.encode().hex() + 'ff'
        self.assertEqual(self.message(script), helpers.PUBLIC_MINER + '�')

    def test_a_height_of_16_or_less_written_as_one_opcode_is_skipped_too(self):
        # The node's own form for those heights: OP_5, a printable "U"
        self.assertEqual(self.message('55' + '00' * 8 + helpers.PUBLIC_MINER.encode().hex()), helpers.PUBLIC_MINER)

    def test_a_script_that_opens_with_text_loses_none_of_it(self):
        # No height push in front — no layout to skip
        self.assertEqual(self.message(helpers.PUBLIC_MINER.encode().hex()), helpers.PUBLIC_MINER)

    def test_control_bytes_and_runs_of_spaces_read_as_one_space(self):
        script = helpers.coinbase_script(6403, '') + b'/Public\x00\x01  Miner/'.hex()
        self.assertEqual(self.message(script), '/Public Miner/')

    def test_the_message_is_cut_at_150_characters(self):
        self.assertEqual(self.message(helpers.coinbase_script(6403, 'k' * 200)), 'k' * 150)

    def test_a_block_the_node_mined_itself_has_no_message(self):
        # The node's own miner writes the height and an OP_0 — no pool,
        # no extranonce, nothing to read
        self.assertEqual(self.message(helpers.coinbase_script(8225, '')[:6] + '00'), 'Binary coinbase: 02212000')

    def test_a_script_with_nothing_readable_shows_its_first_60_hex_digits(self):
        self.assertEqual(self.message('00ff' * 40), 'Binary coinbase: ' + ('00ff' * 15) + '...')
        self.assertEqual(self.message('00ff00ff'), 'Binary coinbase: 00ff00ff')

    def test_an_empty_script_says_so(self):
        self.assertEqual(self.message(''), 'Empty coinbase')

    def test_a_script_that_is_not_hex_says_it_could_not_be_parsed(self):
        self.assertTrue(self.message('zz').startswith('Parse error: non-hexadecimal number found'))

    def test_a_transaction_without_inputs_has_no_coinbase_input(self):
        for tx in ({'vin': []}, {}):
            with self.subTest(tx=tx):
                self.assertEqual(self.rpc.extract_coinbase_message(tx), 'No coinbase input')

    def test_an_ordinary_transaction_is_not_a_coinbase(self):
        tx = helpers.spend_tx('dd' * 32, 'cc' * 32)
        self.assertEqual(self.rpc.extract_coinbase_message(tx), 'Not a coinbase transaction')

    def test_something_that_is_no_transaction_at_all_says_what_went_wrong(self):
        self.assertTrue(self.rpc.extract_coinbase_message(None).startswith('Error: '))








############################################################
# ProofOfWorkTests
############################################################
#
# The scrypt hash miners grind against, from the header's
# little-endian fields — anchored to real blocks.
############################################################

class ProofOfWorkTests(unittest.TestCase):

    def setUp(self):
        self.rpc = FullNodeRPC(helpers.TEST_CONFIG['publicside'])

    def test_reverse_hex_flips_bytes_not_digits(self):
        self.assertEqual(self.rpc.reverse_hex('01234567'), '67452301')
        self.assertEqual(self.rpc.reverse_hex('ab'), 'ab')
        self.assertEqual(self.rpc.reverse_hex(''), '')

    def test_the_scrypt_hash_of_each_real_block_is_the_one_production_stored(self):
        for height, block in helpers.REAL_BLOCKS.items():
            with self.subTest(height=height):
                self.assertEqual(self.rpc.get_scrypt_hash(block), helpers.REAL_ROWS[height][2])

    def test_each_real_hash_meets_its_blocks_target(self):
        # Only the right header, byte for byte, hashes below it
        for height, block in helpers.REAL_BLOCKS.items():
            with self.subTest(height=height):
                self.assertLessEqual(int(self.rpc.get_scrypt_hash(block), 16), helpers.target_of(block['bits']))

    def test_a_signalling_version_goes_into_the_header_as_the_node_reports_it(self):
        # From block 8064 the blocks signal the Taproot and MWEB
        # deployments: only the header's first four bytes change
        with mock.patch.object(scrypt, 'hash', wraps=scrypt.hash) as hashed:
            for version in ('20000000', '30000014'):
                self.rpc.get_scrypt_hash(dict(helpers.REAL_BLOCKS[6403], versionHex=version))
        plain, signalling = (call.args[0] for call in hashed.call_args_list)
        self.assertEqual((plain[:4].hex(), signalling[:4].hex()), ('00000020', '14000030'))
        self.assertEqual(signalling[4:], plain[4:])

    def test_one_nonce_off_is_no_proof_of_work(self):
        block = dict(helpers.REAL_BLOCKS[6403], nonce=helpers.REAL_BLOCKS[6403]['nonce'] + 1)
        self.assertGreater(int(self.rpc.get_scrypt_hash(block), 16), helpers.target_of(block['bits']))

    def test_the_genesis_block_has_no_parent_to_hash(self):
        # Why the sync never reaches height 0
        genesis = {key: value for key, value in helpers.REAL_BLOCKS[6403].items() if key != 'previousblockhash'}
        with self.assertRaises(KeyError):
            self.rpc.get_scrypt_hash(genesis)


if __name__ == '__main__':
    unittest.main()
