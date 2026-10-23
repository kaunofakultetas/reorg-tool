############################################################
#  [*] Live smoke tests (opt-in: RUN_LIVE=1)
#
#  Hits the RUNNING backend on localhost:8000, from inside
#  its container (tests/README.md has the command): the two
#  answers the attack page polls come back in the envelope
#  with the right shape — the status with both nodes' tips,
#  the chain view with its blocks, both tips among them, each
#  block's proof-of-work hash a real one — and the tracked
#  list answers too.
#
#  Nothing here flips the attack switch, sends or tracks a
#  transaction: those change what a class sees. Reading the
#  chain view does mirror the nodes' newest blocks into the
#  database — as every poll of an open attack page does.
############################################################


import os
import re
import json
import unittest
import urllib.request

BASE = 'http://localhost:8000'

HASH = re.compile(r'^[0-9a-f]{64}$')


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as response:
        return json.load(response)








############################################################
# LiveSmokeTests
############################################################

@unittest.skipUnless(os.getenv('RUN_LIVE'), 'live smoke is opt-in: set RUN_LIVE=1')
class LiveSmokeTests(unittest.TestCase):

    def test_the_status_carries_both_tips(self):
        body = get('/api/reorgattack/status')
        self.assertIs(body['success'], True)
        status = body['status']
        self.assertIsInstance(status['isConnectedToPublic'], bool)
        self.assertIsInstance(status['connection']['peers'], list)
        for side in ('privateTip', 'publicTip'):
            with self.subTest(tip=side):
                self.assertRegex(status[side]['hash'], HASH)
                self.assertGreater(status[side]['height'], 0)
                self.assertIs(status[side]['available'], True)

    def test_the_chain_view_carries_real_blocks_and_both_tips(self):
        body = get('/api/reorgattack/blockchain/data')
        self.assertIs(body['success'], True)
        data = body['data']
        self.assertTrue(data['chainBlocks'])
        for block in data['chainBlocks']:
            with self.subTest(height=block['height']):
                self.assertEqual(set(block), {'height', 'hash', 'prevHash', 'coinbase', 'timestamp', 'scryptHash', 'chainWork'})
                self.assertIsInstance(block['timestamp'], int)
                self.assertRegex(block['hash'], HASH)
                self.assertRegex(block['scryptHash'], r'^0000[0-9a-f]{60}$')
                self.assertGreater(block['chainWork'], 0)
        hashes = {block['hash'] for block in data['chainBlocks']}
        self.assertIn(data['chainTips']['public'], hashes)
        self.assertIn(data['chainTips']['private'], hashes)
        self.assertIsInstance(data['transactions'], list)

    def test_the_tracked_list_answers(self):
        body = get('/api/reorgattack/transactions')
        self.assertIs(body['success'], True)
        for tx in body['transactions']:
            self.assertEqual(set(tx), {'txid', 'color', 'blocks'})


if __name__ == '__main__':
    unittest.main()
