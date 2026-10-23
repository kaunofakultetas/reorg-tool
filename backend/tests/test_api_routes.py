############################################################
#  [*] API route tests — the answers the attack page reads
#
#  The attack page sees the backend only through these
#  answers, and reads them to a strict shape: the { success,
#  message, … } envelope, the chain view under data, the node
#  status under status, a sent transaction's txid, a tracked
#  one under transaction, 201 for a new tracking, 400 for a
#  request missing its field. The other test files call the
#  manager directly, so a route reading the wrong field of a
#  request, answering the wrong status or dropping a field on
#  its way out would pass all of them.
#
#  These tests send real requests through the app as main.py
#  builds it — schema, proxy fix, blueprint — with the route
#  module's manager swapped for one wired to the attack scene's
#  two fake nodes, over a throwaway database: the answers when
#  all is well, the envelope kept through every failure (no
#  route ever answers Flask's HTML error page, with every node
#  down neither), a body that is no JSON object refused as
#  missing its field, a txid no node knows refused with a 404,
#  and the endpoints nothing calls today as they answer.
############################################################


import sys
import sqlite3
import logging
import unittest
from unittest import mock

from tests import helpers


# The failing-node tests make Flask log a traceback ON PURPOSE —
# silenced for this module, so a passing run reads clean
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)








############################################################
# RouteTestCase
############################################################
#
# What every test here shares: one app per test class, since
# running main is the slow part, and per test the attack scene
# on the fake network, a throwaway database and a manager on
# the two nodes swapped into the route module — the route
# functions read its reorg_manager on every request.
#
# Used by:
#   - every test class in this file
############################################################

class RouteTestCase(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with helpers.TempDatabase():
            app, _ = helpers.run_main()
        cls.client = app.test_client()

    def setUp(self):
        self.db = self.enterContext(helpers.TempDatabase())
        self.scene = helpers.attack_scene()
        self.public, self.private = self.scene.public_node, self.scene.private_node
        self.enterContext(helpers.FakeNetwork(self.public, self.private))
        self.manager = helpers.make_manager()
        self.enterContext(mock.patch.object(sys.modules['app.reorg_attack.routes'], 'reorg_manager', self.manager))

    def get(self, path, **params):
        response = self.client.get(path, query_string=params)
        return response.status_code, response.get_json()

    def post(self, path, body):
        response = self.client.post(path, json=body)
        return response.status_code, response.get_json()

    def delete(self, path):
        response = self.client.delete(path)
        return response.status_code, response.get_json()

    def tracked(self):
        return self.db.rows('SELECT TXID, Color FROM Blockchain_Transactions')








############################################################
# SwitchRouteTests
############################################################

class SwitchRouteTests(RouteTestCase):

    def test_connect_attaches_the_private_node_and_says_so(self):
        status, body = self.get('/api/reorgattack/connect')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'success': True, 'message': 'Network activity enabled', 'result': True})
        self.assertEqual(self.private.calls_to('addnode'), [[helpers.PUBLIC_PEER, 'onetry']])

    def test_disconnect_splits_the_private_node_off_and_says_so(self):
        self.private.peers.append(helpers.peer_entry(helpers.PUBLIC_PEER))
        status, body = self.get('/api/reorgattack/disconnect')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'success': True, 'message': 'Network activity disabled and peers disconnected'})
        self.assertEqual(self.private.peers, [])

    def test_the_switch_never_touches_the_public_node(self):
        self.get('/api/reorgattack/connect')
        self.get('/api/reorgattack/disconnect')
        self.assertEqual(self.public.calls, [])








############################################################
# ChainViewRouteTests
############################################################

class ChainViewRouteTests(RouteTestCase):

    def test_the_view_answers_the_envelope_with_blocks_tips_and_transactions(self):
        status, body = self.get('/api/reorgattack/blockchain/data', since=helpers.SCENE_DAY_START)
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {'success', 'data'})
        self.assertIs(body['success'], True)
        self.assertEqual(set(body['data']), {'chainBlocks', 'chainTips', 'transactions'})
        every_block = self.scene.shared + self.scene.public + self.scene.private
        self.assertEqual(len(body['data']['chainBlocks']), len(every_block))
        self.assertEqual(body['data']['chainTips'], {'public': self.scene.public[-1]['hash'], 'private': self.scene.private[-1]['hash']})
        self.assertEqual(body['data']['transactions'], [])

    def test_every_block_carries_the_fields_the_page_reads_with_their_types(self):
        _, body = self.get('/api/reorgattack/blockchain/data', since=helpers.SCENE_DAY_START)
        for block in body['data']['chainBlocks']:
            with self.subTest(height=block['height']):
                self.assertEqual(set(block), {'height', 'hash', 'prevHash', 'coinbase', 'timestamp', 'scryptHash', 'chainWork'})
                self.assertIsInstance(block['height'], int)
                self.assertIsInstance(block['timestamp'], int)
                self.assertIsInstance(block['chainWork'], float)
                self.assertRegex(block['scryptHash'], r'^[0-9a-f]{64}$')

    def test_the_since_asked_for_reaches_the_view_as_a_number(self):
        with mock.patch.object(self.manager, 'get_blockchain_data', wraps=self.manager.get_blockchain_data) as view:
            self.get('/api/reorgattack/blockchain/data', since=str(helpers.SCENE_DAY_START))
        view.assert_called_once_with(since=helpers.SCENE_DAY_START)

    def test_without_since_the_view_is_asked_for_the_newest_blocks(self):
        with mock.patch.object(self.manager, 'get_blockchain_data', wraps=self.manager.get_blockchain_data) as view:
            status, body = self.get('/api/reorgattack/blockchain/data')
        view.assert_called_once_with(since=None)
        self.assertEqual((status, len(body['data']['chainBlocks'])), (200, 100))

    def test_a_since_that_is_no_whole_number_of_seconds_is_refused(self):
        for since in ('vakar', '1792368000.5', '2026-10-19'):
            with self.subTest(since=since):
                status, body = self.get('/api/reorgattack/blockchain/data', since=since)
                self.assertEqual((status, body), (400, {'success': False,
                                                        'message': 'since must be a Unix timestamp in whole seconds'}))

    def test_a_tracked_transaction_reaches_the_page_with_its_sightings(self):
        self.private.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.private[1]['hash']))
        self.post('/api/reorgattack/transactions', {'txid': 'a1' * 32, 'color': 'red'})
        _, body = self.get('/api/reorgattack/blockchain/data', since=helpers.SCENE_DAY_START)
        self.assertEqual(body['data']['transactions'], [{'txid': 'a1' * 32, 'color': 'red', 'blocks': [self.scene.private[1]['hash']]}])








############################################################
# StatusRouteTests
############################################################

class StatusRouteTests(RouteTestCase):

    def test_the_status_answers_the_envelope_with_the_nodes_state(self):
        status, body = self.get('/api/reorgattack/status')
        self.assertEqual(status, 200)
        self.assertIs(body['success'], True)
        self.assertEqual(set(body['status']), {'isConnectedToPublic', 'connection', 'privateTip', 'publicTip', 'blocksSummary'})
        self.assertIs(body['status']['isConnectedToPublic'], False)
        self.assertEqual(body['status']['privateTip']['height'], 6403)
        self.assertEqual(body['status']['publicTip']['height'], 6402)

    def test_the_status_follows_the_switch(self):
        self.get('/api/reorgattack/connect')
        _, body = self.get('/api/reorgattack/status')
        self.assertIs(body['status']['isConnectedToPublic'], True)

        self.get('/api/reorgattack/disconnect')
        _, body = self.get('/api/reorgattack/status')
        self.assertIs(body['status']['isConnectedToPublic'], False)








############################################################
# SendRouteTests
############################################################

class SendRouteTests(RouteTestCase):

    RAW_TX = '0200000000010198c12bd8a3f2bf7e3a0c0b1c75d6c3bd8e2b0a4e1c3f5a7b9d2e4f6a8b0c1d3e50000000000fdffffff'

    def setUp(self):
        super().setUp()
        self.sent = helpers.spend_tx('a1' * 32, 'c1' * 32)
        self.private.accepts[self.RAW_TX] = self.sent

    def test_a_sent_transaction_answers_its_txid_and_is_tracked_under_its_colour(self):
        status, body = self.post('/api/reorgattack/transactions/send', {'raw_transaction': self.RAW_TX, 'color': 'cyan'})
        self.assertEqual(status, 200)
        self.assertEqual(body, {'success': True, 'message': 'Transaction sent successfully', 'txid': self.sent['txid']})
        self.assertEqual(self.tracked(), [(self.sent['txid'], 'cyan')])

    def test_without_a_colour_the_transaction_is_tracked_blue(self):
        self.post('/api/reorgattack/transactions/send', {'raw_transaction': self.RAW_TX})
        self.assertEqual(self.tracked(), [(self.sent['txid'], 'blue')])

    def test_a_request_without_the_raw_transaction_is_refused_with_400(self):
        status, body = self.post('/api/reorgattack/transactions/send', {'color': 'cyan'})
        self.assertEqual(status, 400)
        self.assertEqual(body, {'success': False, 'message': 'Missing raw_transaction in request body'})
        self.assertEqual(self.private.calls_to('sendrawtransaction'), [])

    def test_a_transaction_the_node_refuses_answers_500_with_the_nodes_reason(self):
        self.private.refuse('sendrawtransaction', 'bad-txns-inputs-missingorspent', code=-25)
        status, body = self.post('/api/reorgattack/transactions/send', {'raw_transaction': self.RAW_TX, 'color': 'cyan'})
        self.assertEqual(status, 500)
        self.assertEqual(body, {'success': False, 'message': "Failed to send transaction: RPC Error: "
                                                             "{'code': -25, 'message': 'bad-txns-inputs-missingorspent'}"})








############################################################
# TrackRouteTests
############################################################

class TrackRouteTests(RouteTestCase):

    def setUp(self):
        super().setUp()
        self.private.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.private[1]['hash']))

    def test_a_new_tracking_answers_201_with_the_transaction(self):
        status, body = self.post('/api/reorgattack/transactions', {'txid': 'a1' * 32, 'color': 'green'})
        self.assertEqual(status, 201)
        self.assertEqual(body, {'success': True, 'transaction': {'txid': 'a1' * 32, 'color': 'green',
                                                                 'blocks': [self.scene.private[1]['hash']]}})

    def test_without_a_colour_the_transaction_is_tracked_blue(self):
        self.post('/api/reorgattack/transactions', {'txid': 'a1' * 32})
        self.assertEqual(self.tracked(), [('a1' * 32, 'blue')])

    def test_a_request_without_the_txid_is_refused_with_400(self):
        status, body = self.post('/api/reorgattack/transactions', {'color': 'green'})
        self.assertEqual(status, 400)
        self.assertEqual(body, {'success': False, 'message': 'Missing txid in request body'})

    def test_untracking_answers_the_envelope_and_forgets_the_transaction(self):
        self.post('/api/reorgattack/transactions', {'txid': 'a1' * 32, 'color': 'green'})
        status, body = self.delete(f'/api/reorgattack/transactions/{"a1" * 32}')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'success': True, 'message': 'Transaction tracking removed successfully'})
        self.assertEqual(self.tracked(), [])








############################################################
# UnusedRouteTests
############################################################
#
# The endpoints nothing calls today — pinned as they answer,
# so a change to them is a decision, not an accident. The
# chain is synced first; a block's network is its coinbase's
# (the scene's private branch is the attackers').
############################################################

class UnusedRouteTests(RouteTestCase):

    def setUp(self):
        super().setUp()
        self.manager.get_blockchain_data(helpers.SCENE_DAY_START)

    def test_the_peer_list_is_the_private_nodes_peer_addresses(self):
        self.private.peers += [helpers.peer_entry(helpers.PUBLIC_PEER), helpers.peer_entry(helpers.DUMMY_PEER, 1)]
        status, body = self.get('/api/reorgattack/privateside/getpeers')
        self.assertEqual((status, body), (200, [helpers.PUBLIC_PEER]))

    def test_the_peer_list_of_a_node_that_cannot_be_reached_says_so_in_the_envelope(self):
        self.private.down = True
        status, body = self.get('/api/reorgattack/privateside/getpeers')
        self.assertEqual(status, 500)
        self.assertIs(body['success'], False)
        self.assertTrue(body['message'].startswith('Failed to get peer info: RPC Connection Error'))

    def test_the_tracked_list_on_its_own(self):
        self.private.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32))
        self.post('/api/reorgattack/transactions', {'txid': 'a1' * 32, 'color': 'green'})
        status, body = self.get('/api/reorgattack/transactions')
        self.assertEqual((status, body), (200, {'success': True, 'transactions': [{'txid': 'a1' * 32, 'color': 'green', 'blocks': []}]}))

    def test_the_sync_status_describes_the_on_demand_sync(self):
        status, body = self.get('/api/reorgattack/system/sync/status')
        self.assertEqual((status, body), (200, {'success': True, 'sync_status': {
            'sync_mode': 'on-demand', 'description': 'Data is synced automatically when endpoints are called'}}))


    def test_one_networks_blocks_in_a_time_range(self):
        day = {'since': helpers.SCENE_DAY_START, 'until': helpers.SCENE_DAY_START + helpers.DAY}
        status, body = self.get('/api/reorgattack/blocks/private', **day)
        self.assertEqual(status, 200)
        self.assertEqual([block['hash'] for block in body['blocks']], [block['hash'] for block in self.scene.private])
        self.assertEqual(body['blocks'][0], {
            'network': 'private', 'height': 6401, 'hash': self.scene.private[0]['hash'],
            'prevHash': self.scene.shared[-1]['hash'], 'coinbaseMessage': helpers.ATTACKER,
            'timestamp': self.scene.private[0]['time']})
        self.assertEqual(body['metadata'], {'network': 'private', **day, 'total_blocks': 3})

        _, public = self.get('/api/reorgattack/blocks/public', **day)
        self.assertEqual(public['metadata']['total_blocks'], len(self.scene.shared) + len(self.scene.public))

    def test_one_networks_blocks_with_open_ends(self):
        _, every = self.get('/api/reorgattack/blocks/public')
        _, none = self.get('/api/reorgattack/blocks/public', until=helpers.SCENE_DAY_START)
        self.assertEqual(every['metadata']['total_blocks'], len(self.scene.shared) + len(self.scene.public))
        self.assertEqual((every['metadata']['since'], every['metadata']['until']), (None, None))
        self.assertEqual(none['blocks'], [])

    def test_a_bound_that_is_no_whole_number_of_seconds_is_refused(self):
        status, body = self.get('/api/reorgattack/blocks/public', until='rytoj')
        self.assertEqual((status, body), (400, {'success': False, 'message': 'until must be a Unix timestamp in whole seconds'}))

    def test_a_network_that_is_neither_public_nor_private_is_refused(self):
        status, body = self.get('/api/reorgattack/blocks/mainnet')
        self.assertEqual((status, body), (400, {'success': False, 'message': 'Unknown network mainnet: expected public or private'}))

    def test_the_days_with_blocks_count_each_networks_blocks(self):
        # Days in UTC when no zone is named: the scene's blocks all
        # fall on 2026-10-19 there
        status, body = self.get('/api/reorgattack/dates/available')
        self.assertEqual(status, 200)
        shared_and_public = len(self.scene.shared) + len(self.scene.public)
        self.assertEqual(body['available_dates'], [{'date': '2026-10-19', 'public_blocks': shared_and_public,
                                                    'private_blocks': 3, 'total_blocks': shared_and_public + 3}])
        self.assertEqual((body['total_dates'], body['timezone']), (1, 'UTC'))
        self.assertEqual(body['has_todays_data'], body['today'] == '2026-10-19')

    def test_the_days_are_counted_in_the_zone_asked_for(self):
        # In Honolulu (UTC-10) the scene's early-morning blocks were
        # mined the afternoon before
        status, body = self.get('/api/reorgattack/dates/available', tz='Pacific/Honolulu')
        self.assertEqual(status, 200)
        self.assertEqual([day['date'] for day in body['available_dates']], ['2026-10-18'])
        self.assertEqual(body['available_dates'][0]['total_blocks'], len(self.scene.shared) + len(self.scene.public) + 3)
        self.assertEqual(body['timezone'], 'Pacific/Honolulu')
        self.assertEqual(body['has_todays_data'], body['today'] == '2026-10-18')

    def test_a_zone_that_does_not_exist_is_refused(self):
        for zone in ('Mars/Olympus_Mons', '../../etc/passwd'):
            with self.subTest(zone=zone):
                status, body = self.get('/api/reorgattack/dates/available', tz=zone)
                self.assertEqual((status, body), (400, {'success': False,
                                                        'message': f'Unknown timezone {zone}: expected an IANA zone name'}))

    def test_the_database_stats_per_network(self):
        status, body = self.get('/api/reorgattack/database/stats')
        self.assertEqual(status, 200)
        stats = body['stats']
        self.assertEqual(stats['public_network'], {'total_blocks': 99, 'min_height': 6304, 'max_height': 6402, 'height_range': 99})
        self.assertEqual(stats['private_network'], {'total_blocks': 3, 'min_height': 6401, 'max_height': 6403, 'height_range': 3})
        self.assertEqual((stats['total_transactions_tracked'], stats['total_tx_block_links']), (0, 0))

    def test_a_forced_sync_says_whose_blocks_came_through(self):
        response = self.client.post('/api/reorgattack/system/sync/force')
        self.assertEqual((response.status_code, response.get_json()), (200, {
            'success': True, 'message': 'Recent data synced successfully', 'synced': {'private': True, 'public': True}}))

    def test_a_forced_sync_with_a_silent_node_names_it(self):
        self.public.down = True
        response = self.client.post('/api/reorgattack/system/sync/force')
        self.assertEqual((response.status_code, response.get_json()), (500, {
            'success': False, 'message': "Failed to force sync: the public node's blocks could not be read",
            'synced': {'private': True, 'public': False}}))

    def test_a_transactions_details_come_from_each_side_that_knows_it(self):
        mined = helpers.spend_tx('a1' * 32, 'c1' * 32, blockhash=self.scene.private[1]['hash'])
        self.private.add_tx(mined)
        self.public.add_tx(helpers.spend_tx('a1' * 32, 'c1' * 32))
        _, body = self.get(f'/api/reorgattack/fetchtxinfo/{mined["txid"]}')
        self.assertEqual(body['privateside'], {'blockhash': self.scene.private[1]['hash'], 'inputs': mined['vin'], 'outputs': mined['vout']})
        self.assertEqual(body['publicside']['blockhash'], '')
        self.assertEqual(body['publicside']['inputs'], mined['vin'])

    def test_a_side_that_does_not_know_the_transaction_keeps_the_empty_skeleton(self):
        _, body = self.get(f'/api/reorgattack/fetchtxinfo/{"ff" * 32}')
        empty = {'blockhash': '', 'inputs': [], 'outputs': []}
        self.assertEqual(body, {'publicside': empty, 'privateside': empty})








############################################################
# EnvelopeTests
############################################################
#
# A failure under a route — a node that refuses, a node that
# does not answer, a database that is locked — comes back in
# the envelope with its reason, never as Flask's HTML error
# page; a silent node the answer can do without leaves only
# its own part empty.
############################################################

class EnvelopeTests(RouteTestCase):

    def test_a_refused_connect_says_why(self):
        self.private.refuse('addnode', 'Error: Unable to open connection', code=-23)
        status, body = self.get('/api/reorgattack/connect')
        self.assertEqual((status, body), (500, {'success': False, 'message': "Failed to connect to the public network: RPC Error: "
                                                                             "{'code': -23, 'message': 'Error: Unable to open connection'}"}))

    def test_a_split_of_a_node_that_cannot_be_reached_says_so(self):
        self.private.down = True
        status, body = self.get('/api/reorgattack/disconnect')
        self.assertEqual(status, 500)
        self.assertIs(body['success'], False)
        self.assertTrue(body['message'].startswith('Failed to disconnect from the public network: RPC Connection Error'))

    def test_the_status_of_a_silent_private_node_says_so(self):
        self.private.down = True
        status, body = self.get('/api/reorgattack/status')
        self.assertEqual(status, 500)
        self.assertTrue(body['message'].startswith('Failed to get network status: RPC Connection Error'))

    def test_the_status_of_a_silent_public_node_still_answers(self):
        self.public.down = True
        status, body = self.get('/api/reorgattack/status')
        self.assertEqual(status, 200)
        self.assertEqual(body['status']['publicTip'], {'hash': None, 'height': None, 'available': False})
        self.assertEqual(body['status']['privateTip']['height'], 6403)

    def test_the_chain_view_with_a_silent_node_still_answers(self):
        self.public.down = True
        status, body = self.get('/api/reorgattack/blockchain/data', since=helpers.SCENE_DAY_START)
        self.assertEqual(status, 200)
        self.assertEqual(body['data']['chainTips'], {'public': None, 'private': self.scene.private[-1]['hash']})

    def test_the_chain_view_of_a_locked_database_says_so(self):
        with mock.patch.object(self.manager, 'get_blockchain_data', side_effect=sqlite3.OperationalError('database is locked')):
            status, body = self.get('/api/reorgattack/blockchain/data')
        self.assertEqual((status, body), (500, {'success': False, 'message': 'Failed to get blockchain data: database is locked'}))

    def test_an_untrack_on_a_locked_database_says_so(self):
        with mock.patch.object(self.manager, 'remove_transaction_tracking', side_effect=sqlite3.OperationalError('database is locked')):
            status, body = self.delete(f'/api/reorgattack/transactions/{"a1" * 32}')
        self.assertEqual((status, body), (500, {'success': False, 'message': 'Failed to remove transaction tracking: database is locked'}))

    def test_no_route_answers_html_with_every_node_down(self):
        self.public.down = self.private.down = True
        calls = [
            ('get', '/api/reorgattack/connect'), ('get', '/api/reorgattack/disconnect'),
            ('get', '/api/reorgattack/privateside/getpeers'), ('get', f'/api/reorgattack/fetchtxinfo/{"a1" * 32}'),
            ('post', '/api/reorgattack/transactions/send'), ('get', '/api/reorgattack/blockchain/data'),
            ('get', '/api/reorgattack/blocks/public'), ('get', '/api/reorgattack/dates/available'),
            ('get', '/api/reorgattack/transactions'), ('post', '/api/reorgattack/transactions'),
            ('delete', f'/api/reorgattack/transactions/{"a1" * 32}'), ('get', '/api/reorgattack/status'),
            ('get', '/api/reorgattack/database/stats'), ('get', '/api/reorgattack/system/sync/status'),
            ('post', '/api/reorgattack/system/sync/force'),
        ]
        for method, path in calls:
            with self.subTest(route=f'{method.upper()} {path}'):
                body = {'raw_transaction': '0200', 'txid': 'a1' * 32} if method == 'post' else None
                response = getattr(self.client, method)(path, json=body)
                self.assertTrue(response.is_json, response.content_type)








############################################################
# RequestBodyTests
############################################################
#
# The two POST routes read a JSON object: anything else —
# another content type, no body, broken JSON, a JSON value
# that is no object — is missing its field like any other.
############################################################

class RequestBodyTests(RouteTestCase):

    CASES = {
        '/api/reorgattack/transactions/send': 'Missing raw_transaction in request body',
        '/api/reorgattack/transactions': 'Missing txid in request body',
    }

    def test_a_body_that_is_no_json_object_is_refused_as_missing_its_field(self):
        bodies = {
            'a form': {'data': 'txid=a1&raw_transaction=0200'},
            'no body': {},
            'an empty json body': {'data': '', 'content_type': 'application/json'},
            'broken json': {'data': '{"txid": ', 'content_type': 'application/json'},
            'a json list': {'json': ['txid', 'raw_transaction']},
        }
        for path, message in self.CASES.items():
            for case, kwargs in bodies.items():
                with self.subTest(path=path, body=case):
                    response = self.client.post(path, **kwargs)
                    self.assertEqual((response.status_code, response.get_json()), (400, {'success': False, 'message': message}))

    def test_a_txid_no_node_knows_is_refused_with_404(self):
        status, body = self.post('/api/reorgattack/transactions', {'txid': 'ff' * 32, 'color': 'green'})
        self.assertEqual((status, body), (404, {'success': False, 'message': f'Transaction {"ff" * 32} is not known to either node'}))
        self.assertEqual(self.tracked(), [])


if __name__ == '__main__':
    unittest.main()
