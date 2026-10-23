############################################################
#  [*] Reorg attack — fullnode RPC client
#
#  The blockchain side of the 51% attack tool. FullNodeRPC
#  talks JSON-RPC to one KNF Coin fullnode — reorg.py builds
#  one instance per side, the PUBLIC network node and the
#  student-controlled PRIVATE one — mirrors the node's recent
#  blocks into Blockchain_Blocks and, on the way in,
#  recomputes each block's SCRYPT proof-of-work hash and its
#  log2 cumulative chain-work (the number the whole tool is
#  about). FullNodeConnections wraps the same node's peer
#  switch: the addnode / disconnectnode calls that split the
#  private node off the public network and heal it again.
#
#  Used by:
#    - reorg.py — ReorgAttackManager builds one FullNodeRPC
#      per side and a FullNodeConnections on the private one
############################################################


import requests
from requests.auth import HTTPBasicAuth
from typing import List, Dict
from app.database.db import get_db_connection
import scrypt
import math
import json
import os


# The node's code for "no such transaction" and for "the peer
# is not connected" — the two refusals callers act on
RPC_NO_SUCH_TX = -5
RPC_NOT_CONNECTED = -29

# The extranonce anypool puts between a coinbase's height push
# and its message: the connection's counter and the miner's
# own value, four bytes each
COINBASE_EXTRANONCE_BYTES = 8








############################################################
# RpcError
############################################################
#
# A node's refusal of one call: the JSON-RPC error object it
# answered with, its code kept apart so a caller can tell a
# refusal it expects (a transaction the node does not know, a
# peer already gone) from every other failure. Its message is
# "RPC Error: " followed by the node's error object — the
# reason the routes pass on to the page.
#
# Used by:
#   - FullNodeRPC.rpc_call (below) — every refusal
#   - FullNodeConnections.disconnect (below), reorg.py's
#     track_transaction — the refusals they expect
############################################################

class RpcError(Exception):

    def __init__(self, error):
        self.error = error
        self.code = error.get('code') if isinstance(error, dict) else None
        super().__init__(f"RPC Error: {error}")








############################################################
# FullNodeRPC
############################################################
#
# One JSON-RPC client for a single fullnode. rpc_call is the
# low-level transport; the get_* methods wrap individual RPC
# verbs; sync_recent_blocks and sync_tracked_transactions
# mirror the node's state into the database, deriving the
# SCRYPT hash and log2 chain-work the view needs.
#
#   transport  — rpc_call
#   queries    — get_blockchain_info, get_network_info,
#                get_block_count, get_block_hash, get_block,
#                get_raw_transaction, get_tip_info
#   actions    — send_raw_transaction
#   parsing    — extract_coinbase_message, reverse_hex,
#                get_scrypt_hash
#   sync       — sync_recent_blocks, sync_tracked_transactions
#
# Used by:
#   - reorg.py — one instance per side (public_rpc /
#     private_rpc); the private one is also wrapped by
#     FullNodeConnections
############################################################

class FullNodeRPC:






    ############################################################
    # __init__
    ############################################################
    #
    # Stores the RPC connection settings and builds the HTTP
    # basic-auth once. No network call happens here, so
    # constructing a client is cheap and cannot fail on a
    # node that is still starting.
    #
    # Used by:
    #   - reorg.py — ReorgAttackManager builds public_rpc and
    #     private_rpc
    ############################################################

    def __init__(self, rpc_config: Dict):
        self.rpchost = rpc_config['rpchost']
        self.rpcport = rpc_config['rpcport']
        self.rpcuser = rpc_config['rpcuser']
        self.rpcpass = rpc_config['rpcpassword']
        self.auth = HTTPBasicAuth(self.rpcuser, self.rpcpass)






    ############################################################
    # rpc_call
    ############################################################
    #
    # The low-level JSON-RPC transport: POSTs {method, params}
    # to the node with a 3 s timeout. An RPC-level error in the
    # body is raised as an RpcError BEFORE the HTTP status is
    # checked, so a node that answers a non-200 alongside a JSON
    # error still surfaces the real reason; a body that will not
    # parse falls back to the raw HTTP error.
    #
    # Used by:
    #   - every get_* / send_raw_transaction method (below)
    #   - FullNodeConnections — getpeerinfo / addnode /
    #     disconnectnode
    ############################################################

    def rpc_call(self, method: str, params: List = None) -> Dict:
        if params is None:
            params = []

        payload = {
            "jsonrpc": "1.0",
            "id": "python",
            "method": method,
            "params": params
        }

        try:
            response = requests.post(f"http://{self.rpchost}:{self.rpcport}", json=payload, auth=self.auth, timeout=3)

            # Get the JSON response even if status is not 200
            try:
                data = response.json()
            except:
                # If we can't parse JSON, raise the HTTP error
                response.raise_for_status()
                raise Exception("No JSON response")

            # An RPC-level error outranks the HTTP status
            if "error" in data and data["error"]:
                raise RpcError(data["error"])

            # Only now does the HTTP status matter
            if not response.ok:
                response.raise_for_status()

            return data["result"]

        except requests.exceptions.RequestException as e:
            raise Exception(f"RPC Connection Error: {str(e)}")






    ############################################################
    # get_blockchain_info
    ############################################################
    #
    # getblockchaininfo — the node's chain summary (best block
    # hash, height, cumulative chainwork).
    #
    # Used by:
    #   - get_tip_info (below)
    #   - FullNodeConnections.get_connection_status — the
    #     private tip
    ############################################################

    def get_blockchain_info(self) -> Dict:
        return self.rpc_call("getblockchaininfo")






    ############################################################
    # get_network_info
    ############################################################
    #
    # getnetworkinfo — the node's network view.
    #
    # Used by:
    #   - nothing calls this at the moment
    ############################################################

    def get_network_info(self) -> Dict:
        return self.rpc_call("getnetworkinfo")






    ############################################################
    # get_block_count
    ############################################################
    #
    # getblockcount — the height of the node's current tip.
    #
    # Used by:
    #   - sync_recent_blocks (below) — the top of the sync
    #     range
    ############################################################

    def get_block_count(self) -> int:
        return self.rpc_call("getblockcount")






    ############################################################
    # get_block_hash
    ############################################################
    #
    # getblockhash — the block hash at one height.
    #
    # Used by:
    #   - sync_recent_blocks (below)
    ############################################################

    def get_block_hash(self, height: int) -> str:
        return self.rpc_call("getblockhash", [height])






    ############################################################
    # get_block
    ############################################################
    #
    # getblock — a block's header and transaction list at the
    # given verbosity (1 = decoded header + txids).
    #
    # Used by:
    #   - sync_recent_blocks (below)
    ############################################################

    def get_block(self, block_hash: str, verbosity: int = 1) -> Dict:
        return self.rpc_call("getblock", [block_hash, verbosity])






    ############################################################
    # get_raw_transaction
    ############################################################
    #
    # getrawtransaction — a transaction, verbose by default so
    # the caller gets vin / vout / blockhash rather than raw
    # hex.
    #
    # Used by:
    #   - reorg.py — track_transaction asks both sides
    #   - sync_recent_blocks / sync_tracked_transactions (below)
    ############################################################

    def get_raw_transaction(self, txid: str, verbose: bool = True) -> Dict:
        return self.rpc_call("getrawtransaction", [txid, verbose])






    ############################################################
    # send_raw_transaction
    ############################################################
    #
    # sendrawtransaction — broadcasts a raw HEX transaction and
    # returns its txid.
    #
    # Used by:
    #   - reorg.py — ReorgAttackManager.send_raw_transaction
    #     (into the private node)
    ############################################################

    def send_raw_transaction(self, raw_tx: str) -> str:
        return self.rpc_call("sendrawtransaction", [raw_tx])






    ############################################################
    # extract_coinbase_message
    ############################################################
    #
    # The message a miner left in a coinbase transaction's input
    # script. Every block of this chain is mined through
    # anypool, which lays the script out as the BIP34 height
    # push, then its extranonce (COINBASE_EXTRANONCE_BYTES),
    # then the pool's COINBASE_MESSAGE as raw UTF-8 with no
    # push byte of its own. The extranonce is any bytes at all
    # and often printable, and students write Lithuanian
    # letters, so no scan for readable text can find the
    # message: it is everything after the height push and the
    # extranonce, decoded as UTF-8, a byte that is no UTF-8
    # showing as the replacement character. The height push is
    # read in every form the node accepts — a push of the
    # height's bytes, or one OP_0 / OP_1..OP_16 opcode for the
    # lowest heights; a script that opens with neither has no
    # layout to skip and is read whole. Control bytes and runs
    # of whitespace read as one space. A script with nothing
    # readable falls back to a short hex preview, so the block
    # still has a recognisable coinbase field. The coinbase
    # message is what tells an attacker block apart from an
    # honest one, so getting it right matters.
    #
    # Used by:
    #   - sync_recent_blocks (below) — stored per block
    ############################################################

    def extract_coinbase_message(self, coinbase_tx: Dict) -> str:
        try:
            if not coinbase_tx.get('vin') or len(coinbase_tx['vin']) == 0:
                return "No coinbase input"

            coinbase_input = coinbase_tx['vin'][0]

            if 'coinbase' not in coinbase_input:
                return "Not a coinbase transaction"

            coinbase_script = coinbase_input['coinbase']

            try:
                script_bytes = bytes.fromhex(coinbase_script)

                # The message starts past the height push and the
                # extranonce behind it
                first = script_bytes[0] if script_bytes else None
                if first is not None and 1 <= first <= 8:
                    message_start = 1 + first + COINBASE_EXTRANONCE_BYTES
                elif first == 0 or (first is not None and 0x51 <= first <= 0x60):
                    message_start = 1 + COINBASE_EXTRANONCE_BYTES
                else:
                    message_start = 0

                message = script_bytes[message_start:].decode('utf-8', errors='replace')
                message = ' '.join(''.join(char if char.isprintable() else ' ' for char in message).split())

                # Replacement characters alone are nothing to read
                if message.replace('�', '').strip():
                    return message[:150]  # Cap the stored length

                # Nothing readable — show a hex preview instead so
                # the block still has a recognisable coinbase field
                if len(script_bytes) > 0:
                    return f"Binary coinbase: {coinbase_script[:60]}{'...' if len(coinbase_script) > 60 else ''}"
                else:
                    return "Empty coinbase"

            except Exception as e:
                return f"Parse error: {str(e)[:50]}"

        except Exception as e:
            return f"Error: {str(e)[:50]}"






    ############################################################
    # get_tip_info
    ############################################################
    #
    # The node's current tip as {hash, height, available} —
    # the shape the view and status payloads expect. available
    # is always True here: a node that could not answer would
    # have raised inside get_blockchain_info.
    #
    # Used by:
    #   - reorg.py — get_blockchain_data and get_network_status
    ############################################################

    def get_tip_info(self) -> Dict:
        blockchain_info = self.get_blockchain_info()
        return {
            'hash': blockchain_info.get('bestblockhash', ''),
            'height': blockchain_info.get('blocks', 0),
            'available': True
        }






    ############################################################
    # reverse_hex
    ############################################################
    #
    # Reverses a hex string in 2-character (single-byte) chunks
    # — the little/big-endian flip the block-header fields need
    # before hashing:
    #
    #   IN   01 23 45 67 89 AB CD EF
    #   OUT  EF CD AB 89 67 45 23 01
    #
    # Used by:
    #   - get_scrypt_hash (below) — every header field
    ############################################################

    def reverse_hex(self, hex_str: str) -> str:
        return ''.join(reversed([hex_str[i:i+2] for i in range(0, len(hex_str), 2)]))






    ############################################################
    # get_scrypt_hash
    ############################################################
    #
    # The block's SCRYPT proof-of-work hash: reassemble the
    # 80-byte header from its little-endian fields and run
    # scrypt(N=1024, r=1, p=1) over it, byte-reversed to the
    # usual display order. This is the hash miners actually
    # grind against — distinct from the SHA-256 block hash.
    #
    # Used by:
    #   - sync_recent_blocks (below) — stored per block
    ############################################################

    def get_scrypt_hash(self, block_info: Dict) -> str:
        # Header fields, each flipped to little-endian
        version_final = self.reverse_hex(block_info['versionHex'])
        prevhash_final = self.reverse_hex(block_info['previousblockhash'])
        merkle_final = self.reverse_hex(block_info['merkleroot'])
        ntime_final = self.reverse_hex(f"{block_info['time']:08x}")
        nbits_final = self.reverse_hex(f"{int(block_info["bits"], 16):08x}")
        nonce_final = self.reverse_hex(f"{block_info['nonce']:08x}")

        # Concatenate into the raw 80-byte header
        header_bytes = bytes.fromhex(version_final + prevhash_final + merkle_final + ntime_final + nbits_final + nonce_final)

        # Scrypt over the header, reversed to display order
        scrypt_hash_hex = scrypt.hash(header_bytes, header_bytes, 1024, 1, 1, 32)[::-1].hex()

        return scrypt_hash_hex






    ############################################################
    # sync_recent_blocks
    ############################################################
    #
    # Mirrors the node's newest blocks into Blockchain_Blocks.
    # The walk goes down from the tip by hash only and stops at
    # the first block already stored — so a warm database only
    # pulls what is new, and a node that switched branches is
    # mirrored down to where the branches meet; depth caps how
    # far back a cold sync reaches. The new blocks are then
    # stored OLDEST first, each in a commit of its own, with its
    # coinbase message, header timestamp, SCRYPT hash and log2
    # chain-work — and only once all of it could be read. A block that cannot be
    # read ends the run there: the blocks below it are stored,
    # none above it, so the stored blocks always reach down
    # unbroken and the next run picks up where this one
    # stopped. Best-effort: a failure is printed and the method
    # returns False without raising.
    #
    # Used by:
    #   - reorg.py — sync_recent_data (both sides)
    ############################################################

    def sync_recent_blocks(self, depth: int = 100) -> bool:
        print(f"[*] Syncing recent blocks from full node...")
        try:

            # STEP 1: walk down from the tip by hash, up to the
            # first block already stored or the depth's end
            # =================================================
            block_count = self.get_block_count()
            start_height = max(1, block_count - depth + 1)

            new_blocks = []
            with get_db_connection() as conn:
                for height in reversed(range(start_height, block_count + 1)):
                    block_hash = self.get_block_hash(height)
                    sqlFetchData = conn.execute(' SELECT Hash FROM Blockchain_Blocks WHERE Hash = ? ', (block_hash,))
                    if sqlFetchData.fetchone():
                        break
                    new_blocks.append((height, block_hash))


            # STEP 2: store the new blocks oldest first, one commit
            # each — a block that cannot be read ends the run
            # =====================================================
            for height, block_hash in reversed(new_blocks):
                block_info = self.get_block(block_hash)

                # STEP 2.1: the real coinbase message, off the coinbase tx
                coinbase_message = ""
                if 'tx' in block_info and len(block_info['tx']) > 0:
                    coinbase_tx = self.get_raw_transaction(block_info['tx'][0], verbose=True)
                    coinbase_message = self.extract_coinbase_message(coinbase_tx)

                # STEP 2.2: the SCRYPT proof-of-work hash and the log2 of the cumulative chain-work
                scrypt_hash_hex = self.get_scrypt_hash(block_info)
                log2_chainwork_value = math.log2(int(block_info['chainwork'], 16))

                # STEP 2.3: the row, committed on its own — the block's time as its
                # header timestamp, seconds since the epoch: which day and hour that
                # is depends on the viewer's timezone, left to the browser
                with get_db_connection() as conn:
                    conn.execute(' INSERT OR REPLACE INTO Blockchain_Blocks (Height, Hash, PrevHash, CoinbaseMessage, Timestamp, ScryptHash, Chainwork) VALUES (?,?,?,?,?,?,?)',
                        (height, block_hash, block_info.get('previousblockhash', 'genesis'), coinbase_message, int(block_info['time']), scrypt_hash_hex, log2_chainwork_value))
                    conn.commit()
            return True


        except Exception as e:
            print(f"Error syncing blocks: {e}")
        return False






    ############################################################
    # sync_tracked_transactions
    ############################################################
    #
    # Refreshes, for each tracked txid, which block the node
    # currently sees it in — recording new sightings in
    # Blockchain_TxInBlocks. A txid the node cannot answer for
    # is skipped, not failed. Always returns True.
    #
    # Used by:
    #   - reorg.py — sync_recent_data (both sides)
    ############################################################

    def sync_tracked_transactions(self, txids: List[str]) -> bool:
        print(f"[*] Syncing tracked transactions from full node...")
        for txid in txids:

            # STEP 1: ask the node about the tx and note the block
            # it was sighted in, if any
            # ====================================================
            found_blocks = []
            try:
                private_tx_info = self.get_raw_transaction(txid)
            except Exception as e:
                print(f"Note: Could not get transaction info: {str(e)}")
                continue

            if "blockhash" in private_tx_info:
                found_blocks.append(private_tx_info["blockhash"])


            # STEP 2: store each sighting
            # ===========================
            with get_db_connection() as conn:
                for block_hash in found_blocks:
                    conn.execute('''
                        INSERT OR IGNORE INTO Blockchain_TxInBlocks (TXID, BlockHash)
                        VALUES (?, ?)
                    ''', (txid, block_hash))
                conn.commit()
        return True








############################################################
# FullNodeConnections
############################################################
#
# The peer switch on one node (the private one, in practice):
# the getpeerinfo read plus the addnode / disconnectnode
# calls that attach the node to the public network or split
# it off — the actual mechanism behind the attack toggle.
#
# Used by:
#   - reorg.py — ReorgAttackManager wraps the private
#     FullNodeRPC in one FullNodeConnections
############################################################

class FullNodeConnections:






    ############################################################
    # __init__
    ############################################################
    #
    # Holds the FullNodeRPC whose peers this switch drives,
    # plus the public / dummy peer addresses it acts on — read
    # from PUBLIC_PEER_ADDR / DUMMY_PEER_ADDR so the stack's
    # service names are never baked into the image (defaults
    # are the compose service names, host:p2p-port).
    #
    # Used by:
    #   - reorg.py — built on the private node's client
    ############################################################

    def __init__(self, rpc_client: FullNodeRPC):
        self.rpc = rpc_client

        # The public P2P peer the switch attaches to / detaches
        # from, and the retired peer filtered out of getpeerinfo
        self.public_peer_addr = os.getenv('PUBLIC_PEER_ADDR', 'reorg-knfcoind-public:49333')
        self.dummy_peer_addr = os.getenv('DUMMY_PEER_ADDR', 'reorg-knfcoind-dummy:49333')






    ############################################################
    # get_peer_info
    ############################################################
    #
    # getpeerinfo, with the retired dummy peer (DUMMY_PEER_ADDR)
    # filtered out by default — that container is gone from the
    # stack, so its address only ever appears as stale noise.
    # show_dummy=True returns the unfiltered list.
    #
    # Used by:
    #   - get_connection_status (below)
    #   - routes.py — the peers endpoint (no live caller)
    ############################################################

    def get_peer_info(self, show_dummy: bool = False) -> List[Dict]:
        peer_info = []
        if not show_dummy:
            peer_info = self.rpc.rpc_call("getpeerinfo")
            peer_info = [peer for peer in peer_info if peer['addr'] != self.dummy_peer_addr]
        else:
            peer_info = self.rpc.rpc_call("getpeerinfo")
        return peer_info






    ############################################################
    # connect
    ############################################################
    #
    # Attaches the node to the public network — one addnode
    # 'onetry' at the public peer (PUBLIC_PEER_ADDR). The
    # 'heal' side of the attack switch; always reports success
    # (addnode itself does not raise on an already-known peer).
    #
    # Used by:
    #   - routes.py — the connect endpoint
    ############################################################

    def connect(self) -> Dict:
        self.rpc.rpc_call("addnode", [self.public_peer_addr, "onetry"])

        return {
            'success': True,
            'message': 'Network activity enabled',
            'result': True
        }






    ############################################################
    # disconnect
    ############################################################
    #
    # Splits the node off the public network by disconnecting
    # the public peer (PUBLIC_PEER_ADDR) — the 'attack' side of
    # the switch. A peer that is already gone is the split
    # done: the node's "not connected" refusal is reported as
    # success. Every other failure — a node that cannot be
    # reached, any other refusal — is raised: the split did not
    # happen, and the student must not be told it did.
    #
    # Used by:
    #   - routes.py — the disconnect endpoint
    ############################################################

    def disconnect(self) -> Dict:
        try:
            self.rpc.rpc_call("disconnectnode", [self.public_peer_addr])
        except RpcError as e:
            if e.code != RPC_NOT_CONNECTED:
                raise

        return {
            'success': True,
            'message': 'Network activity disabled and peers disconnected'
        }






    ############################################################
    # get_connection_status
    ############################################################
    #
    # Whether the node is currently attached to the public
    # network (any peer left after the dummy filter), together
    # with the node's own tip — the payload the status endpoint
    # and the attack toggle read. Each peer is cut down to its
    # address and how it is connected: the rest of getpeerinfo
    # (the node's own bound address, traffic counters, versions)
    # has no business in the browser.
    #
    # Used by:
    #   - reorg.py — get_network_status
    ############################################################

    def get_connection_status(self) -> Dict:
        peer_info = self.get_peer_info()
        blockchain_info = self.rpc.get_blockchain_info()

        is_connected = len(peer_info) > 0

        return {
            'success': True,
            'status': {
                'isConnectedToPublic': is_connected,
                'connection': {
                    'peers': [
                        {'addr': peer.get('addr'), 'connection_type': peer.get('connection_type'), 'inbound': peer.get('inbound')}
                        for peer in peer_info
                    ]
                },
                'privateTip': {
                    'hash': blockchain_info.get('bestblockhash', ''),
                    'height': blockchain_info.get('blocks', 0),
                    'available': True
                }
            }
        }
