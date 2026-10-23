############################################################
#  [*] Reorg attack — manager & database helpers
#
#  The backend half of the 51% attack tool: ReorgDatabase
#  wraps the Blockchain_* tables (blocks mirrored from the
#  fullnodes, tracked transactions and the blocks they were
#  sighted in), ReorgAttackManager drives the attack view —
#  one FullNodeRPC client per side (the PUBLIC network node
#  and the student-controlled PRIVATE one, fullnode_rpc.py)
#  plus the peer-connection switch that splits and heals the
#  two networks.
#
#  Used by:
#    - routes.py — the Flask endpoints under /api/reorgattack/*
############################################################


import json
from typing import Dict, List
from app.database.db import get_db_connection
from .fullnode_rpc import FullNodeRPC, FullNodeConnections, RpcError, RPC_NO_SUCH_TX


# The public network's miner stamps this in its coinbase — the
# one mark that tells its blocks from the attackers' (the page
# paints the diagram by the same rule)
PUBLIC_COINBASE_MARK = 'Public Miner'

# The network a stored block came from, as an SQL expression
# over Blockchain_Blocks: the table keeps no network column,
# the coinbase message tells the two apart
NETWORK_OF_BLOCK = f"CASE WHEN instr(CoinbaseMessage, '{PUBLIC_COINBASE_MARK}') > 0 THEN 'public' ELSE 'private' END"

# The block columns the attack view reads, in its order
BLOCK_COLUMNS = 'Height, Hash, PrevHash, CoinbaseMessage, Timestamp, ScryptHash, ChainWork'








############################################################
# UnknownTransaction
############################################################
#
# A txid neither node can show — there is nothing to track.
# Its message says so in words; the track endpoint answers it
# with a 404.
#
# Used by:
#   - ReorgAttackManager.track_transaction (below)
#   - routes.py — the track endpoint
############################################################

class UnknownTransaction(LookupError):

    def __init__(self, txid):
        super().__init__(f'Transaction {txid} is not known to either node')








############################################################
# ReorgDatabase
############################################################
#
# Static read helpers over the Blockchain_* tables — no
# state, no RPC; every method opens its own connection.
#
# Used by:
#   - ReorgAttackManager (below) and routes.py
############################################################

class ReorgDatabase:






    ############################################################
    # get_existing_block_hashes
    ############################################################
    #
    # The stored block hashes whose header timestamp lies in a
    # half-open range — from since, up to but not including
    # until, an end left open when not given — newest block
    # first, as a plain list; meant as a cheap duplicate check
    # before inserting synced blocks. The range is in seconds
    # since the epoch and the caller's to choose: which day a
    # block falls on depends on the viewer's timezone.
    #
    # Used by:
    #   - nothing calls this at the moment — the sync path in
    #     fullnode_rpc.py checks duplicates its own way
    ############################################################

    @staticmethod
    def get_existing_block_hashes(since=None, until=None) -> List[str]:
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT Hash
                FROM Blockchain_Blocks
                WHERE (? IS NULL OR Timestamp >= ?) AND (? IS NULL OR Timestamp < ?)
                ORDER BY Height DESC, Hash DESC
            ''', [since, since, until, until])
            return [row[0] for row in sqlFetchData.fetchall()]






    ############################################################
    # get_all_tracked_transactions
    ############################################################
    #
    # Every tracked transaction as {txid, color, blocks}: the
    # student-assigned color (empty column falls back to
    # 'blue') and the hashes of every block the tx was sighted
    # in — one extra query per transaction, fine for the
    # handful a class tracks.
    #
    # Used by:
    #   - ReorgAttackManager.get_blockchain_data (below)
    #   - routes.py — the transaction list endpoint
    ############################################################

    @staticmethod
    def get_all_tracked_transactions():
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT DISTINCT t.TXID, t.Inputs, t.Outputs, t.Color
                FROM Blockchain_Transactions t
            ''')

            transactions = []
            for row in sqlFetchData.fetchall():
                txid = row[0]
                color = row[3] if row[3] else 'blue'

                sqlFetchData = conn.execute('''
                    SELECT BlockHash FROM Blockchain_TxInBlocks WHERE TXID = ?
                ''', (txid,))

                blocks = [block[0] for block in sqlFetchData.fetchall()]

                transactions.append({
                    'txid': txid,
                    'color': color,
                    'blocks': blocks
                })

            return transactions






    ############################################################
    # get_blocks_summary
    ############################################################
    #
    # Two views of the stored blocks: the overall count, height
    # range and the first and last header timestamps (seconds
    # since the epoch, None while nothing is stored), and the
    # count and height range broken down by coinbase message — the coinbase is what distinguishes
    # which network (public vs the students' private chain)
    # mined a block.
    #
    # Used by:
    #   - ReorgAttackManager.get_network_status (below)
    ############################################################

    @staticmethod
    def get_blocks_summary():
        with get_db_connection() as conn:
            sqlFetchData = conn.execute('''
                SELECT 
                    COUNT(*) as total_count,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height,
                    MIN(Timestamp) as earliest_timestamp,
                    MAX(Timestamp) as latest_timestamp
                FROM Blockchain_Blocks
            ''')

            overall = sqlFetchData.fetchone()

            sqlFetchData = conn.execute('''
                SELECT 
                    CoinbaseMessage,
                    COUNT(*) as count,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height
                FROM Blockchain_Blocks 
                GROUP BY CoinbaseMessage
                ORDER BY count DESC
            ''')

            by_coinbase = sqlFetchData.fetchall()

            summary = {
                'total': {
                    'count': overall[0] if overall else 0,
                    'height_range': f"{overall[1]}-{overall[2]}" if overall and overall[1] else "N/A",
                    'earliest_timestamp': overall[3] if overall else None,
                    'latest_timestamp': overall[4] if overall else None
                },
                'by_coinbase': {}
            }

            for row in by_coinbase:
                summary['by_coinbase'][row[0]] = {
                    'count': row[1],
                    'height_range': f"{row[2]}-{row[3]}"
                }

            return summary






    ############################################################
    # get_blocks_by_network
    ############################################################
    #
    # The stored blocks of one network — 'public' or 'private',
    # told apart by their coinbase (see NETWORK_OF_BLOCK) —
    # whose header timestamp lies from since up to but not
    # including until (an end left open when not given), in
    # height order. Each row holds the network, height, hash,
    # previous hash, coinbase message and timestamp, in that
    # order.
    #
    # Used by:
    #   - routes.py — the per-network blocks endpoint (no live
    #     caller)
    ############################################################

    @staticmethod
    def get_blocks_by_network(network, since=None, until=None):
        with get_db_connection() as conn:
            sqlFetchData = conn.execute(f'''
                SELECT {NETWORK_OF_BLOCK}, Height, Hash, PrevHash, CoinbaseMessage, Timestamp
                FROM Blockchain_Blocks
                WHERE {NETWORK_OF_BLOCK} = ?
                  AND (? IS NULL OR Timestamp >= ?) AND (? IS NULL OR Timestamp < ?)
                ORDER BY Height ASC, Hash ASC
            ''', [network, since, since, until, until])
            return [tuple(row) for row in sqlFetchData.fetchall()]








############################################################
# ReorgAttackManager
############################################################
#
# The attack orchestrator: one FullNodeRPC per side (public /
# private, from the config's connection settings) plus the
# FullNodeConnections switch on the private node. Methods:
#
#   sync     — sync_recent_data
#   view     — get_blockchain_data, get_network_status, read_tip
#   actions  — send_raw_transaction, track_transaction,
#              remove_transaction_tracking
#
# Used by:
#   - routes.py — the single shared instance
############################################################

class ReorgAttackManager:






    ############################################################
    # __init__
    ############################################################
    #
    # Builds both RPC clients from the config dict
    # ('publicside' / 'privateside' connection settings) and
    # the peer-connection switch on the private node.
    # depth_per_sync caps how many recent blocks each view
    # refresh pulls from each node.
    #
    # Used by:
    #   - routes.py — at import time, the single instance
    ############################################################

    def __init__(self, config: Dict):
        self.config = config
        self.depth_per_sync = 100

        self.public_rpc = FullNodeRPC(self.config['publicside'])
        self.private_rpc = FullNodeRPC(self.config['privateside'])
        self.fullnode_connections = FullNodeConnections(self.private_rpc)






    ############################################################
    # sync_recent_data
    ############################################################
    #
    # Brings the database up to date with both nodes: each
    # node's newest blocks (the private node's first) and every
    # tracked transaction's block sightings on both. Best-
    # effort, like the syncs it runs: it hands back whether
    # each node's blocks came through, and never raises for a
    # node that does not answer.
    #
    # Used by:
    #   - get_blockchain_data (below) — before every view
    #   - routes.py — the force-sync endpoint (no live caller)
    ############################################################

    def sync_recent_data(self) -> Dict:
        blocks_synced = {
            'private': self.private_rpc.sync_recent_blocks(self.depth_per_sync),
            'public': self.public_rpc.sync_recent_blocks(self.depth_per_sync),
        }

        with get_db_connection() as conn:
            sqlFetchData = conn.execute('SELECT TXID FROM Blockchain_Transactions')
            tracked_txids = [row[0] for row in sqlFetchData.fetchall()]
        self.public_rpc.sync_tracked_transactions(tracked_txids)
        self.private_rpc.sync_tracked_transactions(tracked_txids)

        return blocks_synced






    ############################################################
    # read_tip
    ############################################################
    #
    # One node's tip as get_tip_info reads it — or, when the
    # node does not answer, the same shape marked unavailable,
    # with no hash and no height: the view and the status still
    # answer, and show that side as unknown.
    #
    # Used by:
    #   - get_blockchain_data, get_network_status (below)
    ############################################################

    @staticmethod
    def read_tip(rpc) -> Dict:
        try:
            return rpc.get_tip_info()
        except Exception as e:
            print(f"Note: Could not read the tip of {rpc.rpchost}: {str(e)}")
            return {'hash': None, 'height': None, 'available': False}






    ############################################################
    # get_blockchain_data
    ############################################################
    #
    # The attack view in one payload: syncs both nodes into the
    # database, serves the blocks mined since the given
    # timestamp — the browser sends the start of the viewer's
    # own day, as only it knows the viewer's timezone — in
    # height order, and returns them with the two chain tips
    # and the tracked transactions. A node that does not answer
    # leaves its tip out (None) — the stored blocks and the
    # other node's tip still make a view.
    #
    # Used by:
    #   - routes.py — the visualization's poll endpoint
    ############################################################

    def get_blockchain_data(self, since=None) -> Dict:

        # STEP 1: bring the database up to date with both nodes,
        # so the view below reads fresh data.
        # ======================================================
        self.sync_recent_data()


        # STEP 2: the blocks since the given timestamp, in height
        # order. Fewer than 100 of them (fresh install, early in
        # the viewer's day) or no timestamp at all falls back to
        # the newest 100 overall, so the view never renders
        # near-empty. Rows are ordered in SQL and shaped here: an
        # aggregate would not keep their order.
        # =======================================================
        with get_db_connection() as conn:
            rows = []
            if since is not None:
                rows = conn.execute(f'''
                    SELECT {BLOCK_COLUMNS}
                    FROM Blockchain_Blocks
                    WHERE Timestamp >= ?
                    ORDER BY Height ASC, Hash ASC
                ''', [since]).fetchall()

            if len(rows) < 100:
                rows = conn.execute(f'''
                    SELECT * FROM (
                        SELECT {BLOCK_COLUMNS}
                        FROM Blockchain_Blocks
                        ORDER BY Height DESC, Hash DESC
                        LIMIT 100
                    )
                    ORDER BY Height ASC, Hash ASC
                ''').fetchall()

        all_blocks = [
            {
                'height': row['Height'],
                'hash': row['Hash'],
                'prevHash': row['PrevHash'],
                'coinbase': row['CoinbaseMessage'],
                'timestamp': row['Timestamp'],
                'scryptHash': row['ScryptHash'],
                'chainWork': row['ChainWork'],
            }
            for row in rows
        ]


        # STEP 3: assemble — tracked transactions, both tips, the
        # blocks.
        # =======================================================
        tracked_transactions = ReorgDatabase.get_all_tracked_transactions()

        return {
            'success': True,
            'data': {
                'chainBlocks': all_blocks,
                'chainTips': {
                    'public': self.read_tip(self.public_rpc)['hash'],
                    'private': self.read_tip(self.private_rpc)['hash'],
                },
                'transactions': tracked_transactions
            }
        }






    ############################################################
    # get_network_status
    ############################################################
    #
    # The private node's peer-connection status — the attack
    # switch's state; a private node that does not answer
    # raises, there is no status without it — enriched with
    # the public tip (marked unavailable when the public node
    # does not answer) and the stored-blocks summary.
    #
    # Used by:
    #   - routes.py — the network status endpoint
    ############################################################

    def get_network_status(self) -> Dict:
        connection_status = self.fullnode_connections.get_connection_status()

        if connection_status['success']:
            connection_status['status']['publicTip'] = self.read_tip(self.public_rpc)
            connection_status['status']['blocksSummary'] = ReorgDatabase.get_blocks_summary()

        return connection_status






    ############################################################
    # send_raw_transaction
    ############################################################
    #
    # Broadcasts a raw transaction to the PRIVATE node and
    # auto-tracks it under the given color. Tracking is
    # best-effort: the broadcast already happened, so a
    # tracking failure only warns instead of failing the
    # request.
    #
    # Used by:
    #   - routes.py — the send endpoint
    ############################################################

    def send_raw_transaction(self, raw_tx: str, color: str = 'blue') -> Dict:
        try:
            txid = self.private_rpc.send_raw_transaction(raw_tx)

            # Log tracking errors but don't fail the transaction send
            try:
                self.track_transaction(txid, color)
            except Exception as track_err:
                print(f"Warning: Failed to track transaction {txid}: {str(track_err)}")

            return {
                'success': True,
                'message': 'Transaction sent successfully',
                'txid': txid
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'Failed to send transaction: {str(e)}'
            }






    ############################################################
    # track_transaction
    ############################################################
    #
    # Starts (or refreshes) tracking one transaction: asks
    # BOTH networks about it — the first answer supplies the
    # inputs/outputs, every answer may add a block sighting —
    # and upserts the result. A tx in no block yet is stored
    # anyway (INSERT OR REPLACE also refreshes the color on
    # re-track). A tx no node could show is not stored: when
    # both nodes refused it as unknown, UnknownTransaction is
    # raised; when a node could not be asked at all, its
    # failure is raised — the tx may well exist there.
    #
    # Used by:
    #   - send_raw_transaction (above) — auto-track
    #   - routes.py — the manual track endpoint
    ############################################################

    def track_transaction(self, txid: str, color: str = 'blue') -> Dict:

        inputs_json = None
        outputs_json = None
        found_blocks = []
        failures = []


        # STEP 1: the private network's view of the tx.
        # =============================================
        try:
            private_tx_info = self.private_rpc.get_raw_transaction(txid)
            if(inputs_json is None and outputs_json is None):
                inputs_json = json.dumps(private_tx_info.get("vin", []))
                outputs_json = json.dumps(private_tx_info.get("vout", []))
            if "blockhash" in private_tx_info:
                found_blocks.append(private_tx_info["blockhash"])
        except Exception as e:
            failures.append(e)
            print(f"Note: Could not get transaction from private network: {str(e)}")


        # STEP 2: the public network's view.
        # ==================================
        try:
            public_tx_info = self.public_rpc.get_raw_transaction(txid)
            if(inputs_json is None and outputs_json is None):
                inputs_json = json.dumps(public_tx_info.get("vin", []))
                outputs_json = json.dumps(public_tx_info.get("vout", []))
            if "blockhash" in public_tx_info:
                found_blocks.append(public_tx_info["blockhash"])
        except Exception as e:
            failures.append(e)
            print(f"Note: Could not get transaction from public network: {str(e)}")


        # STEP 3: no node could show the tx — nothing to store.
        # Unknown to both, or a node that could not be asked.
        # =====================================================
        if inputs_json is None:
            not_known = [f for f in failures if isinstance(f, RpcError) and f.code == RPC_NO_SUCH_TX]
            if len(not_known) == len(failures):
                raise UnknownTransaction(txid)
            raise next(f for f in failures if f not in not_known)


        # STEP 4: store the tx (even when it's in no block yet)
        # and each block sighting.
        # =====================================================
        with get_db_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO Blockchain_Transactions (TXID, Inputs, Outputs, Color)
                VALUES (?, ?, ?, ?)
            ''', (txid, inputs_json, outputs_json, color))

            for block_hash in found_blocks:
                conn.execute('''
                    INSERT OR IGNORE INTO Blockchain_TxInBlocks (TXID, BlockHash)
                    VALUES (?, ?)
                ''', (txid, block_hash))
            conn.commit()

        return {
            'success': True,
            'transaction': {
                'txid': txid,
                'color': color,
                'blocks': found_blocks
            }
        }






    ############################################################
    # remove_transaction_tracking
    ############################################################
    #
    # Stops tracking one transaction: its block sightings and
    # the transaction row itself.
    #
    # Used by:
    #   - routes.py — the untrack endpoint
    ############################################################

    def remove_transaction_tracking(self, txid: str) -> Dict:
        with get_db_connection() as conn:
            conn.execute('DELETE FROM Blockchain_TxInBlocks WHERE TXID = ?', (txid,))
            conn.execute('DELETE FROM Blockchain_Transactions WHERE TXID = ?', (txid,))
            conn.commit()

        return {
            'success': True,
            'message': 'Transaction tracking removed successfully'
        }
