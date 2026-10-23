############################################################
#  [*] Test helpers
#
#  Everything the test files share: real blocks of the KNF
#  Coin chain recorded as ANCHORS, a builder for synthetic
#  chains, a fake fullnode answering JSON-RPC through a
#  patched transport, a throwaway database carrying the
#  production schema, the attack scene the manager and route
#  tests play on, and the app as main.py builds it.
#
#  Two safety nets go up the moment this module loads, so a
#  test that forgets its fixtures fails loudly instead of
#  touching production — even when the suite runs inside the
#  live container: a connection opened without a file of its
#  own cannot open the database at /data, and an RPC call
#  made outside a FakeNetwork never leaves the process. The
#  backend's own progress prints are silenced too, so a
#  passing run reads clean.
#
#  The anchors were read from the live chain through the
#  public node (getblock and getrawtransaction), together
#  with the rows the backend had stored for those blocks. If
#  a deliberate change breaks one, re-record it HERE and say
#  so in the commit.
#
#  Used by:
#    - every test_*.py file in this package
############################################################


import os
import json
import time
import runpy
import hashlib
import tempfile
import contextlib
from types import SimpleNamespace
from urllib.parse import urlparse
from unittest import mock

import requests

from app.database import db as db_module
from app.database import db_init
from app.reorg_attack import fullnode_rpc
from app.reorg_attack import reorg


# ---- Recorded anchors (the live KNF Coin chain) -------------

# The coinbase messages the chain carries: the public network's
# miner, a student's named attack, the stack's private stratum
PUBLIC_MINER = '/Public Miner/'
ATTACKER = '/Vardenis Pavardenis ATAKA (2026-10-15)/'
STRATUM = '/VU KNF/'

# Three blocks exactly as the public node's getblock described
# them (the fields the backend reads), one per kind of miner
REAL_BLOCKS = {
    6403: {
        'hash': '52f6acb4ab11d115857981d6b94030564db322846ab659ddb9944e246c10cbe2',
        'height': 6403,
        'versionHex': '20000000',
        'previousblockhash': 'f18c0b6876b46c84853f04b68bbaa9fc488df8d60888f457d180fe85d6b06811',
        'merkleroot': 'c40278d0c5d12177ea9ff1ba517d24fb8f9d41cbd8090f29cc4a4b59fba66d4a',
        'time': 1792376468,
        'bits': '1c10d47b',
        'nonce': 858707740,
        'chainwork': '0000000000000000000000000000000000000000000000000000ba8834500de0',
        'tx': ['c40278d0c5d12177ea9ff1ba517d24fb8f9d41cbd8090f29cc4a4b59fba66d4a'],
    },
    6395: {
        'hash': '8b44fb84978d76d23789831c5f5d6210b38c065525a62e81011af381288ee258',
        'height': 6395,
        'versionHex': '20000000',
        'previousblockhash': '95d47e4ed4707a0db54a311c63e4ca50806b37d97b52cde165bf3494c0332ea4',
        'merkleroot': '5533b0e3b9b060e5c65526ada2c24fd564483951efc2465bce6cb86db5194ace',
        'time': 1792375736,
        'bits': '1c10d47b',
        'nonce': 1341999419,
        'chainwork': '0000000000000000000000000000000000000000000000000000ba0e84535b10',
        'tx': ['0ec2aca298efeca1599c37e3679271edf18d5b48c021d638d65df3e508be9d42'],
    },
    3050: {
        'hash': '12c3315962ee83b8c96a2bfc27de4ae40f7d3aa99e22ea2437e24e663d3d5f43',
        'height': 3050,
        'versionHex': '20000000',
        'previousblockhash': 'c6fdf673c52ca8a33b7949c1a2991ff736fbe2c83c210047453324a9f6b84ef9',
        'merkleroot': '2eb1c56a666ba628c65c6a9b72f14298d9e769e7231088c7673c47ee9389b7a1',
        'time': 1787053987,
        'bits': '1c397f40',
        'nonce': 1097796512,
        'chainwork': '00000000000000000000000000000000000000000000000000000ed2dca43d57',
        'tx': ['2eb1c56a666ba628c65c6a9b72f14298d9e769e7231088c7673c47ee9389b7a1'],
    },
}

# The input script of each block's coinbase transaction: the
# BIP34 height push, an 8-byte extranonce, the miner's message
REAL_COINBASE_SCRIPTS = {
    6403: '0203190000001b1b0000002f5075626c6963204d696e65722f',
    6395: '02fb1800000003100000002f56617264656e697320506176617264656e6973204154414b412028323032362d31302d3135292f',
    3050: '02ea0b00000001010000002f5655204b4e462f',
}

# More live coinbase scripts, with the message each carries:
# the first block, its height a one-byte push, and two whose
# extranonce reads as text — "l9" at 1513, a "2" right against
# the message at 1937
REAL_COINBASE_READINGS = {
    1: ('0101000000010f0000002f5075626c6963204d696e65722f', PUBLIC_MINER),
    1513: ('02e905000000076c3900002f5075626c6963204d696e65722f', PUBLIC_MINER),
    1937: ('02910700000002001087322f5075626c6963204d696e65722f', PUBLIC_MINER),
}

# What the backend stores for each block: its header
# timestamp, coinbase message, scrypt proof-of-work hash and
# the log2 of the cumulative work
REAL_ROWS = {
    6403: (REAL_BLOCKS[6403]['time'], PUBLIC_MINER,
           '0000000008fbc017f86365816f16dbbdede88e8afe2aa4a90ef1953b1d075627', 47.54327971220368),
    6395: (REAL_BLOCKS[6395]['time'], ATTACKER,
           '000000000e67d812fc9fcf6c9f06cf3ed8e40e7f7126cba28041c1b7989ac2ce', 47.539598584782105),
    3050: (REAL_BLOCKS[3050]['time'], STRATUM,
           '000000001d5909a14f74549eeb8556ba32baf4f5a182431026158e3505c71824', 43.88983166250789),
}

# The date and time production stored for each block before
# the move to timestamps — text, in the backend's UTC clock
OLD_TEXT_TIMES = {
    6403: ('2026-10-19', '02:21:08'),
    6395: ('2026-10-19', '02:08:56'),
    3050: ('2026-08-18', '11:53:07'),
}


# ---- The two test nodes -------------------------------------

# Hosts no network would ever resolve — and the transport is
# patched anyway (see FakeNetwork)
PUBLIC_HOST = 'public-node.test'
PRIVATE_HOST = 'private-node.test'
RPC_PORT = 19332

# The peer switch's two addresses, as the environment hands
# them to FullNodeConnections
PUBLIC_PEER = 'public-node.test:49333'
DUMMY_PEER = 'dummy-node.test:49333'

TEST_CONFIG = {
    'publicside': {'rpchost': PUBLIC_HOST, 'rpcport': RPC_PORT, 'rpcuser': 'tester', 'rpcpassword': 'test-rpc-secret'},
    'privateside': {'rpchost': PRIVATE_HOST, 'rpcport': RPC_PORT, 'rpcuser': 'tester', 'rpcpassword': 'test-rpc-secret'},
}

# Synthetic chains run on the live chain's clock and work: one
# block a minute around block 6403, each block worth the live
# chain's average work so far
BASE_HEIGHT = 6403
BASE_TIME = REAL_BLOCKS[6403]['time']
WORK_PER_BLOCK = int(REAL_BLOCKS[6403]['chainwork'], 16) // BASE_HEIGHT

# The start of the day the attack scene's blocks were mined
# on, 2026-10-19 in UTC, and the length of a day — both in
# seconds since the epoch
SCENE_DAY_START = 1792368000
DAY = 86400

MAIN_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'main.py')

# A connection opened without a file of its own lands here — a
# directory that does not exist, so the open FAILS instead of
# reaching the production database the container mounts
UNPATCHED_DB = '/nonexistent/reorg-tests-open-a-temp-database.db'








############################################################
# _refuse_real_node
############################################################
#
# The safety nets (see the header): the default database file
# of get_db_connection is swapped for one that cannot be
# opened — every module holds the same function, so this
# covers them all — and requests.post, the backend's only door
# to the nodes, answers with an assertion until a FakeNetwork
# takes its place. The backend's prints are silenced in the
# two modules that narrate their syncs and in the schema
# module, which announces its migration.
#
# Used by:
#   - this module, once at import
############################################################

def _refuse_real_node(url, *args, **kwargs):
    raise AssertionError(f'a test reached for a real fullnode ({url}) — run it inside helpers.FakeNetwork')


db_module.get_db_connection.__defaults__ = (UNPATCHED_DB,)
mock.patch.object(requests, 'post', _refuse_real_node).start()
for _module in (fullnode_rpc, reorg, db_init):
    mock.patch.object(_module, 'print', lambda *args, **kwargs: None, create=True).start()








############################################################
# target_of
############################################################
#
# The proof-of-work target a block's compact bits encode: the
# three-byte mantissa shifted by the exponent byte. A real
# block's scrypt hash, read as a number, lies at or below it.
#
# Used by:
#   - test_fullnode_rpc.py — the proof-of-work anchors
############################################################

def target_of(bits):
    compact = int(bits, 16)
    return (compact & 0xffffff) << (8 * ((compact >> 24) - 3))








############################################################
# block_hash / coinbase_script / coinbase_tx / spend_tx
############################################################
#
# The pieces of a synthetic chain. A block's hash derives from
# its branch label and height, so two branches never collide
# and a test can name any block in advance. A coinbase script
# is laid out as the live chain's are — the BIP34 height push
# in its minimal form, an extranonce, then the miner's message
# — and comes wrapped in the transaction shape
# getrawtransaction answers with. spend_tx is an ordinary
# transaction spending one output of another, mined into the
# block it names or waiting in the mempool when it names none.
#
# Used by:
#   - make_chain (below), the RPC, sync, manager and route
#     tests
############################################################

def block_hash(label, height):
    return hashlib.sha256(f'{label}/{height}'.encode()).hexdigest()


def coinbase_script(height, message, extranonce='0000001b1b000000'):
    pushed = height.to_bytes(height.bit_length() // 8 + 1, 'little')
    return f'{len(pushed):02x}' + pushed.hex() + extranonce + message.encode().hex()


def coinbase_tx(txid, script, blockhash):
    return {
        'txid': txid,
        'vin': [{'coinbase': script, 'txinwitness': ['00' * 32], 'sequence': 4294967295}],
        'vout': [{'value': 50.0, 'n': 0, 'scriptPubKey': {'type': 'witness_v0_keyhash'}}],
        'blockhash': blockhash,
    }


def spend_tx(txid, spends, blockhash=None):
    tx = {
        'txid': txid,
        'vin': [{'txid': spends, 'vout': 0, 'scriptSig': {'asm': '', 'hex': ''}, 'sequence': 4294967293}],
        'vout': [{'value': 1.5, 'n': 0, 'scriptPubKey': {'type': 'witness_v0_keyhash'}}],
    }
    if blockhash:
        tx['blockhash'] = blockhash
    return tx








############################################################
# make_chain
############################################################
#
# A run of synthetic blocks on one branch, in the exact shape
# getblock answers with (the fields the backend reads), each
# with its coinbase transaction. Every block links to the one
# below it — the first to the parent given, or to the
# branch's own block below — and is mined one minute after
# the previous height, on the bits of the live chain, worth
# one more block's work.
#
# Used by:
#   - attack_scene (below), the RPC and sync tests
############################################################

def make_chain(label, heights, message, parent=None):
    blocks, txs = [], []
    heights = list(heights)
    previous = parent if parent is not None else block_hash(label, heights[0] - 1)

    for height in heights:
        txid = hashlib.sha256(f'{label}/{height}/coinbase'.encode()).hexdigest()
        block = {
            'hash': block_hash(label, height),
            'height': height,
            'versionHex': '20000000',
            'previousblockhash': previous,
            'merkleroot': txid,
            'time': BASE_TIME + (height - BASE_HEIGHT) * 60,
            'bits': '1c10d47b',
            'nonce': height,
            'chainwork': f'{WORK_PER_BLOCK * height:064x}',
            'tx': [txid],
        }
        blocks.append(block)
        txs.append(coinbase_tx(txid, coinbase_script(height, message), block['hash']))
        previous = block['hash']

    return blocks, txs








############################################################
# RpcRefusal
############################################################
#
# A node's refusal of one call: the JSON-RPC error object a
# KNF Coin node answers with — its code and its message.
#
# Used by:
#   - FakeNode (below)
############################################################

class RpcRefusal(Exception):

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message








############################################################
# FakeNode
############################################################
#
# One KNF Coin fullnode as its JSON-RPC interface shows it:
# the blocks it knows on every branch, its best chain by
# height, the transactions it can show, its peers, and the
# raw transactions it would accept. It answers the calls the
# backend makes the way the node does — a result under HTTP
# 200, a refusal as the node's error object under HTTP 500
# (JSON-RPC 1.0) — and records every call it received.
# refuse() makes it refuse one method (or only the calls a
# predicate picks); down makes it not answer at all.
#
# Used by:
#   - FakeNetwork, attack_scene (below), every test that
#     talks to a node
############################################################

class FakeNode:

    def __init__(self, host):
        self.host = host
        self.blocks = {}
        self.best = {}
        self.txs = {}
        self.peers = []
        self.reachable = set()
        self.accepts = {}
        self.refusals = []
        self.down = False
        self.calls = []

    def add_chain(self, blocks, txs=()):
        # The blocks become the node's best chain at their
        # heights; anything it held above them is no longer best
        for block in blocks:
            self.blocks[block['hash']] = block
            self.best[block['height']] = block['hash']
        top = max(block['height'] for block in blocks)
        for height in [h for h in self.best if h > top]:
            del self.best[height]
        for tx in txs:
            self.txs[tx['txid']] = tx

    def add_tx(self, tx):
        self.txs[tx['txid']] = tx

    def refuse(self, method, message, code=-1, when=None):
        self.refusals.append((method, when, code, message))

    def calls_to(self, method):
        return [params for name, params in self.calls if name == method]

    def answer(self, payload):
        if self.down:
            raise requests.ConnectionError(
                f"HTTPConnectionPool(host='{self.host}', port={RPC_PORT}): Max retries exceeded with url: / "
                f"(Caused by NewConnectionError('Failed to establish a new connection: [Errno 111] Connection refused'))")

        method, params = payload['method'], payload['params']
        self.calls.append((method, params))
        try:
            for name, when, code, message in self.refusals:
                if name == method and (when is None or when(params)):
                    raise RpcRefusal(code, message)
            handler = getattr(self, f'rpc_{method}', None)
            if handler is None:
                raise RpcRefusal(-32601, 'Method not found')
            result = handler(*params)
        except RpcRefusal as refusal:
            return 500, {'result': None, 'error': {'code': refusal.code, 'message': refusal.message}, 'id': payload['id']}
        return 200, {'result': result, 'error': None, 'id': payload['id']}

    def rpc_getblockchaininfo(self):
        tip = max(self.best)
        return {
            'chain': 'main',
            'blocks': tip,
            'headers': tip,
            'bestblockhash': self.best[tip],
            'chainwork': self.blocks[self.best[tip]]['chainwork'],
            'initialblockdownload': False,
        }

    def rpc_getnetworkinfo(self):
        return {'version': 210400, 'subversion': '/LitecoinCore:0.21.4/', 'connections': len(self.peers)}

    def rpc_getblockcount(self):
        return max(self.best)

    def rpc_getblockhash(self, height):
        if height not in self.best:
            raise RpcRefusal(-8, 'Block height out of range')
        return self.best[height]

    def rpc_getblock(self, blockhash, verbosity=1):
        if blockhash not in self.blocks:
            raise RpcRefusal(-5, 'Block not found')
        return dict(self.blocks[blockhash])

    def rpc_getrawtransaction(self, txid, verbose=False):
        if txid not in self.txs:
            raise RpcRefusal(-5, 'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.')
        return json.loads(json.dumps(self.txs[txid])) if verbose else '02000000' + txid

    def rpc_sendrawtransaction(self, raw):
        if raw not in self.accepts:
            raise RpcRefusal(-22, 'TX decode failed')
        tx = self.accepts[raw]
        self.txs[tx['txid']] = tx
        return tx['txid']

    def rpc_getpeerinfo(self):
        return [dict(peer) for peer in self.peers]

    def rpc_addnode(self, address, command):
        if command == 'onetry' and address in self.reachable and not any(p['addr'] == address for p in self.peers):
            self.peers.append(peer_entry(address, len(self.peers)))
        return None

    def rpc_disconnectnode(self, address):
        if not any(peer['addr'] == address for peer in self.peers):
            raise RpcRefusal(-29, 'Node not found in connected nodes')
        self.peers = [peer for peer in self.peers if peer['addr'] != address]
        return None








############################################################
# peer_entry
############################################################
#
# One getpeerinfo entry, trimmed from the live private node's
# answer to the fields that tell a peer apart.
#
# Used by:
#   - FakeNode.rpc_addnode (above), the peer-switch, manager
#     and route tests
############################################################

def peer_entry(address, peer_id=0):
    return {
        'addr': address,
        'addrbind': '172.20.0.3:54566',
        'connection_type': 'manual',
        'id': peer_id,
        'inbound': False,
        'network': 'unroutable',
        'subver': '/LitecoinCore:0.21.4/',
        'version': 70017,
    }








############################################################
# http_response
############################################################
#
# A genuine requests.Response carrying a status and a body —
# JSON for a dict or a list, the bytes as they are otherwise —
# so the backend reads it with the library's own json(), ok
# and raise_for_status, exactly as it reads a node's answer.
#
# Used by:
#   - FakeNetwork (below), the transport tests
############################################################

def http_response(status, body, url=f'http://{PUBLIC_HOST}:{RPC_PORT}'):
    response = requests.Response()
    response.status_code = status
    response.url = url
    response._content = body if isinstance(body, bytes) else json.dumps(body).encode()
    response.headers['Content-Type'] = 'application/json' if not isinstance(body, bytes) else 'text/html'
    response.encoding = 'utf-8'
    return response








############################################################
# FakeNetwork
############################################################
#
# A context in which requests.post reaches FakeNodes instead
# of the network: each request goes to the node whose host
# the URL names and comes back as that node's answer, a host
# no node serves fails as an unresolvable name would, and
# every request is recorded with its URL, body, credentials
# and timeout.
#
# Used by:
#   - every test that talks to a node
############################################################

class FakeNetwork:

    def __init__(self, *nodes):
        self.nodes = {node.host: node for node in nodes}
        self.requests = []

    def post(self, url, json=None, auth=None, timeout=None, **kwargs):
        self.requests.append({'url': url, 'payload': json, 'auth': auth, 'timeout': timeout})
        node = self.nodes.get(urlparse(url).hostname)
        if node is None:
            raise requests.ConnectionError(f"Failed to resolve '{urlparse(url).hostname}' ([Errno -2] Name or service not known)")
        status, body = node.answer(json)
        return http_response(status, body, url)

    def __enter__(self):
        self._patch = mock.patch.object(requests, 'post', self.post)
        self._patch.start()
        return self

    def __exit__(self, *exc):
        self._patch.stop()








############################################################
# TempDatabase
############################################################
#
# A throwaway SQLite file carrying the PRODUCTION schema
# (init_db_tables run against it), with every module that
# opens connections pointed at it while the context lasts —
# db_init, reorg, fullnode_rpc and routes each hold a
# reference of their own to get_db_connection. connect opens
# a connection of the test's own, store_block writes a row
# the way the sync does, rows reads a query back as plain
# tuples. The copy the migration keeps of an old database
# goes when the file does.
#
# Used by:
#   - every test that touches the database
############################################################

class TempDatabase:

    MODULES = ('app.database.db_init', 'app.reorg_attack.reorg', 'app.reorg_attack.fullnode_rpc',
               'app.reorg_attack.routes')

    def __init__(self):
        handle, self.path = tempfile.mkstemp(suffix='.db')
        os.close(handle)

    def connect(self):
        return db_module.get_db_connection(self.path)

    def store_block(self, height, block_hash, prev_hash, coinbase, timestamp, scrypt_hash='00' * 32, work=1.0):
        with self.connect() as conn:
            conn.execute('''
                INSERT INTO Blockchain_Blocks (Height, Hash, PrevHash, CoinbaseMessage, Timestamp, ScryptHash, ChainWork)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (height, block_hash, prev_hash, coinbase, timestamp, scrypt_hash, work))

    def rows(self, sql, params=()):
        with self.connect() as conn:
            return [tuple(row) for row in conn.execute(sql, params).fetchall()]

    def __enter__(self):
        self._stack = contextlib.ExitStack()
        for module in self.MODULES:
            self._stack.enter_context(mock.patch(f'{module}.get_db_connection', side_effect=self.connect))
        db_init.init_db_tables()
        return self

    def __exit__(self, *exc):
        self._stack.close()
        for suffix in ('', '-wal', '-shm', '-journal', db_init.PRE_MIGRATION_SUFFIX):
            try:
                os.unlink(self.path + suffix)
            except FileNotFoundError:
                pass








############################################################
# clock_zone
############################################################
#
# The process clock's zone pinned to the given IANA zone
# while the context lasts. The backend no longer reads the
# local clock except in the one migration of old databases,
# whose text dates and times were written in it — so the
# migration tests pin the zone the rows were written in, and
# the sync tests run in a zone far from UTC to show nothing
# else depends on it.
#
# Used by:
#   - test_database.py — the migration tests
#   - test_block_sync.py — the timestamp tests
############################################################

@contextlib.contextmanager
def clock_zone(name):
    try:
        with mock.patch.dict(os.environ, {'TZ': name}):
            time.tzset()
            yield
    finally:
        time.tzset()








############################################################
# attack_scene
############################################################
#
# The middle of an attack, on two fake nodes: a shared
# history the public miner mined (heights 6304–6400 — as deep
# as a cold sync walks from the private tip, 100 blocks),
# then the public network's branch (6401–6402) on the public
# node and the students' private branch (6401–6403, their
# named attack in every coinbase) on the private one. The
# private node is detached — no peers — and would reach the
# public peer if asked to. Every block is mined on the day
# that starts at SCENE_DAY_START.
#
# Used by:
#   - test_peer_switch.py — its private node
#   - test_reorg_manager.py, test_api_routes.py
############################################################

def attack_scene():
    shared, shared_txs = make_chain('shared', range(6304, 6401), PUBLIC_MINER)
    public, public_txs = make_chain('public', range(6401, 6403), PUBLIC_MINER, parent=shared[-1]['hash'])
    private, private_txs = make_chain('private', range(6401, 6404), ATTACKER, parent=shared[-1]['hash'])

    public_node = FakeNode(PUBLIC_HOST)
    public_node.add_chain(shared + public, shared_txs + public_txs)

    private_node = FakeNode(PRIVATE_HOST)
    private_node.add_chain(shared + private, shared_txs + private_txs)
    private_node.reachable.add(PUBLIC_PEER)

    return SimpleNamespace(public_node=public_node, private_node=private_node,
                           shared=shared, public=public, private=private)








############################################################
# make_manager
############################################################
#
# A ReorgAttackManager wired to the two test nodes (see
# TEST_CONFIG), its peer switch reading the test peers from
# the environment as the real one does. Building it opens no
# connection — the nodes are only asked once a method runs.
#
# Used by:
#   - test_reorg_manager.py, test_api_routes.py
############################################################

def make_manager():
    with mock.patch.dict(os.environ, {'PUBLIC_PEER_ADDR': PUBLIC_PEER, 'DUMMY_PEER_ADDR': DUMMY_PEER}):
        return reorg.ReorgAttackManager(TEST_CONFIG)








############################################################
# run_main
############################################################
#
# Runs main.py as the container does — the __main__ block:
# schema, proxy fix, blueprint, server — with the server
# start patched out, and hands back the wired app and the
# patched run, whose call shows how the server would have
# started. app_debug is APP_DEBUG's value, absent when None.
# The schema goes wherever get_db_connection points, so it is
# called inside a TempDatabase.
#
# Used by:
#   - test_main.py, test_api_routes.py
############################################################

def run_main(app_debug=None):
    with mock.patch.dict(os.environ), mock.patch('flask.Flask.run') as served:
        os.environ.pop('APP_DEBUG', None)
        if app_debug is not None:
            os.environ['APP_DEBUG'] = app_debug
        main_globals = runpy.run_path(MAIN_PATH, run_name='__main__')
    return main_globals['app'], served
