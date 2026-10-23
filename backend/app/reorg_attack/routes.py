############################################################
#  [*] Reorg attack HTTP API
#
#  The REST surface of the 51% attack tool, consumed by the
#  ReorgAttack page (useReorgAttack.jsx). The live set:
#
#    GET    /api/reorgattack/connect            — attach private node
#    GET    /api/reorgattack/disconnect         — detach private node
#    GET    /api/reorgattack/blockchain/data    — the attack view
#    GET    /api/reorgattack/status             — connection status
#    POST   /api/reorgattack/transactions/send  — broadcast raw tx
#    POST   /api/reorgattack/transactions       — track a txid
#    DELETE /api/reorgattack/transactions/<txid> — untrack
#
#  The remaining endpoints (peers, fetchtxinfo, blocks/<net>,
#  dates/available, GET transactions, database/stats, sync/*)
#  have no callers today. Where a route needs a block's
#  network, it is told by the coinbase (NETWORK_OF_BLOCK in
#  reorg.py) — the table keeps no network column.
#
#  Block times travel as the block header's timestamp —
#  whole seconds since the Unix epoch, UTC by definition —
#  never as a date or a clock time: which day and hour a
#  block falls on depends on the viewer's timezone, and only
#  the browser knows it. So the caller picks every day
#  boundary: the view and blocks/<net> take since and until
#  as timestamps (the page sends the start of the viewer's
#  own day), and dates/available counts days in the IANA
#  zone named by tz (UTC when left out).
#
#  Every route answers the { success, message, … } envelope,
#  failures included: an exception never reaches Flask's HTML
#  error page. A POST body that is not a JSON object counts
#  as missing its field (400).
#
#  reorg_manager is declared None up top and instantiated at
#  the BOTTOM of the file — building it opens RPC clients, and
#  the module wants every route registered first.
#
#  Used by:
#    - main.py — blueprint registration
############################################################


import os

from flask import Blueprint, jsonify, request
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from .reorg import ReorgAttackManager, ReorgDatabase, UnknownTransaction, NETWORK_OF_BLOCK
from app.database.db import get_db_connection



bp_reorg_attack = Blueprint('reorg_attack', __name__)

# The two fullnode RPC connections. Host, port and
# credentials come from the environment so the stack's docker
# service names are never baked into the image; the defaults
# match the compose service names on the isolated network.
# (The retired 'dummy' side was dropped — nothing read it and
# its container is gone from the stack.)
REORG_ATTACK_CONFIG = {
    'publicside': {
        'rpchost': os.getenv('PUBLIC_RPC_HOST', 'reorg-knfcoind-public'),
        'rpcport': int(os.getenv('PUBLIC_RPC_PORT', '19332')),
        'rpcuser': os.getenv('PUBLIC_RPC_USER', 'admin'),
        'rpcpassword': os.getenv('PUBLIC_RPC_PASSWORD', 'admin'),
    },
    'privateside': {
        'rpchost': os.getenv('PRIVATE_RPC_HOST', 'reorg-knfcoind-private'),
        'rpcport': int(os.getenv('PRIVATE_RPC_PORT', '19332')),
        'rpcuser': os.getenv('PRIVATE_RPC_USER', 'admin'),
        'rpcpassword': os.getenv('PRIVATE_RPC_PASSWORD', 'admin'),
    },
}


# Forward declaration — the real instance is built at the end
# of the file (see the header)
reorg_manager = None








############################################################
# reorg_attack_connect
############################################################
#
# GET /api/reorgattack/connect
#
# Re-attaches the private node to the public network — the
# "heal" side of the attack switch.
#
# Used by:
#   - useReorgAttack.jsx — the connection mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/connect', methods=['GET'])
def reorg_attack_connect():
    try:
        result = reorg_manager.fullnode_connections.connect()
        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to connect to the public network: {str(e)}'
        }), 500








############################################################
# reorg_attack_disconnect
############################################################
#
# GET /api/reorgattack/disconnect
#
# Detaches the private node from the public network — the
# "split" side of the attack switch: from here the students
# mine their own chain. A peer that was already gone counts
# as split; a node that could not be reached does not.
#
# Used by:
#   - useReorgAttack.jsx — the connection mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/disconnect', methods=['GET'])
def reorg_attack_disconnect():
    try:
        result = reorg_manager.fullnode_connections.disconnect()
        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to disconnect from the public network: {str(e)}'
        }), 500








############################################################
# reorg_attack_get_peer_info
############################################################
#
# GET /api/reorgattack/privateside/getpeers
#
# The private node's peer addresses, as a bare list.
#
# Used by:
#   - nothing calls this at the moment — the page reads the
#     connection state from /status instead
############################################################

@bp_reorg_attack.route('/api/reorgattack/privateside/getpeers', methods=['GET'])
def reorg_attack_get_peer_info():
    try:
        peer_info = reorg_manager.fullnode_connections.get_peer_info()
        peer_addresses = [peer["addr"] for peer in peer_info]
        return jsonify(peer_addresses), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get peer info: {str(e)}'
        }), 500








############################################################
# reorg_fetch_tx_info
############################################################
#
# GET /api/reorgattack/fetchtxinfo/<txid>
#
# One transaction as each side sees it: the block it sits in
# (empty while it waits in the mempool) with its inputs and
# outputs. A side that cannot show the transaction — it does
# not know it, or does not answer — keeps the empty skeleton.
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/fetchtxinfo/<string:txid>', methods=['GET'])
def reorg_fetch_tx_info(txid):

    to_send = {
        "publicside": {
            "blockhash": "",
            "inputs": [],
            "outputs": []
        },
        "privateside": {
            "blockhash": "",
            "inputs": [],
            "outputs": []
        }
    }

    for side, rpc in (("publicside", reorg_manager.public_rpc), ("privateside", reorg_manager.private_rpc)):
        try:
            tx_info = rpc.get_raw_transaction(txid)
            to_send[side]["blockhash"] = tx_info.get("blockhash", "")
            to_send[side]["inputs"] = tx_info.get("vin", [])
            to_send[side]["outputs"] = tx_info.get("vout", [])
        except Exception:
            pass


    return jsonify(to_send), 200








############################################################
# reorg_send_raw_transaction
############################################################
#
# POST /api/reorgattack/transactions/send
#
# Broadcasts a raw HEX transaction ({raw_transaction, color?})
# into the PRIVATE node; the manager auto-tracks it under the
# color (default 'blue'). A body that is no JSON object — any
# other content type, no body, broken JSON — is missing its
# raw_transaction like any other (400).
#
# Used by:
#   - useReorgAttack.jsx — the rawTransaction mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions/send', methods=['POST'])
def reorg_send_raw_transaction():
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict) or 'raw_transaction' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing raw_transaction in request body'
            }), 400

        raw_tx = data['raw_transaction']
        color = data.get('color', 'blue')
        result = reorg_manager.send_raw_transaction(raw_tx, color)

        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to send transaction: {str(e)}'
        }), 500








############################################################
# timestamp_arg
############################################################
#
# One query argument read as a timestamp — whole seconds
# since the Unix epoch — or None when the request leaves it
# out. Anything else raises ValueError naming the argument,
# which the routes answer with a 400.
#
# Used by:
#   - get_blockchain_data, get_network_blocks (below)
############################################################

def timestamp_arg(name):
    value = request.args.get(name)
    if value is None or value == '':
        return None
    try:
        return int(value)
    except ValueError:
        raise ValueError(f'{name} must be a Unix timestamp in whole seconds')








############################################################
# get_blockchain_data
############################################################
#
# GET /api/reorgattack/blockchain/data
#
# The attack view payload: syncs both nodes and returns the
# blocks, both tips and the tracked transactions — see
# ReorgAttackManager.get_blockchain_data. ?since= is a
# timestamp in whole seconds, the start of the viewer's day
# as the browser works it out; left out, the newest blocks
# are served. A since that is no whole number is refused
# (400).
#
# Used by:
#   - useReorgAttack.jsx — the page's poll query
############################################################

@bp_reorg_attack.route('/api/reorgattack/blockchain/data', methods=['GET'])
def get_blockchain_data():
    try:
        since = timestamp_arg('since')
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400

    try:
        result = reorg_manager.get_blockchain_data(since=since)
        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get blockchain data: {str(e)}'
        }), 500








############################################################
# get_network_blocks
############################################################
#
# GET /api/reorgattack/blocks/<network>
#
# The stored blocks of one network — public or private, told
# apart by the coinbase — whose header timestamp lies from
# ?since= up to but not including ?until= (whole seconds; an
# end left out is open), in height order, each with its
# timestamp. Any other network, or a bound that is no whole
# number, is refused (400).
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/blocks/<string:network>', methods=['GET'])
def get_network_blocks(network):
    if network not in ('public', 'private'):
        return jsonify({
            'success': False,
            'message': f'Unknown network {network}: expected public or private'
        }), 400

    try:
        since, until = timestamp_arg('since'), timestamp_arg('until')
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400

    try:
        blocks = ReorgDatabase.get_blocks_by_network(network, since, until)

        formatted_blocks = []
        for block in blocks:
            formatted_blocks.append({
                'network': block[0],
                'height': block[1],
                'hash': block[2],
                'prevHash': block[3],
                'coinbaseMessage': block[4],
                'timestamp': block[5]
            })

        return jsonify({
            'success': True,
            'blocks': formatted_blocks,
            'metadata': {
                'network': network,
                'since': since,
                'until': until,
                'total_blocks': len(formatted_blocks)
            }
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get blocks for network {network}: {str(e)}'
        }), 500








############################################################
# get_available_dates
############################################################
#
# GET /api/reorgattack/dates/available
#
# Every day with stored blocks, newest first, each with its
# public and private block counts (the network told by the
# coinbase), plus whether today is among them. Days are
# calendar days in the timezone the caller names — ?tz=, an
# IANA zone name as the browser reports it, UTC when left
# out — as a block's day depends on where it is viewed; an
# unknown zone is refused (400).
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/dates/available', methods=['GET'])
def get_available_dates():
    zone_name = request.args.get('tz') or 'UTC'
    try:
        zone = ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return jsonify({
            'success': False,
            'message': f'Unknown timezone {zone_name}: expected an IANA zone name'
        }), 400

    try:
        with get_db_connection() as conn:
            rows = conn.execute(f'''
                SELECT Timestamp, {NETWORK_OF_BLOCK} AS Network
                FROM Blockchain_Blocks
            ''').fetchall()

            dates_data = {}
            for timestamp, network in rows:
                date = datetime.fromtimestamp(timestamp, zone).strftime("%Y-%m-%d")
                if date not in dates_data:
                    dates_data[date] = {
                        'date': date,
                        'public_blocks': 0,
                        'private_blocks': 0,
                        'total_blocks': 0
                    }
                dates_data[date][f'{network}_blocks'] += 1
                dates_data[date]['total_blocks'] += 1

            available_dates = sorted(dates_data.values(), key=lambda day: day['date'], reverse=True)
            today = datetime.now(zone).strftime("%Y-%m-%d")

            return jsonify({
                'success': True,
                'available_dates': available_dates,
                'total_dates': len(available_dates),
                'timezone': zone_name,
                'today': today,
                'has_todays_data': today in dates_data
            }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get available dates: {str(e)}'
        }), 500








############################################################
# get_all_transactions
############################################################
#
# GET /api/reorgattack/transactions
#
# The tracked-transaction list, standalone.
#
# Used by:
#   - nothing calls this at the moment — /blockchain/data
#     already carries the same list
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions', methods=['GET'])
def get_all_transactions():
    try:
        transactions = ReorgDatabase.get_all_tracked_transactions()
        return jsonify({
            'success': True,
            'transactions': transactions
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get transactions: {str(e)}'
        }), 500








############################################################
# add_transaction_tracking
############################################################
#
# POST /api/reorgattack/transactions
#
# Starts color-tracking a txid ({txid, color?}) across both
# chains. Answers 201 on success, 404 when neither node knows
# the txid — nothing is stored then — and 400 for a body that
# is no JSON object or lacks the txid.
#
# Used by:
#   - useReorgAttack.jsx — the trackTransaction mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions', methods=['POST'])
def add_transaction_tracking():
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict) or 'txid' not in data:
            return jsonify({
                'success': False,
                'message': 'Missing txid in request body'
            }), 400

        txid = data['txid']
        color = data.get('color', 'blue')

        result = reorg_manager.track_transaction(txid, color)

        status_code = 201 if result['success'] else 500
        return jsonify(result), status_code

    except UnknownTransaction as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 404

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to add transaction tracking: {str(e)}'
        }), 500








############################################################
# remove_transaction_tracking
############################################################
#
# DELETE /api/reorgattack/transactions/<txid>
#
# Stops tracking one transaction.
#
# Used by:
#   - useReorgAttack.jsx — the untrackTransaction mutation
############################################################

@bp_reorg_attack.route('/api/reorgattack/transactions/<string:txid>', methods=['DELETE'])
def remove_transaction_tracking(txid):
    try:
        result = reorg_manager.remove_transaction_tracking(txid)
        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to remove transaction tracking: {str(e)}'
        }), 500








############################################################
# get_network_status
############################################################
#
# GET /api/reorgattack/status
#
# The private node's connection status enriched with the
# public tip and the stored-block summary — see
# ReorgAttackManager.get_network_status.
#
# Used by:
#   - useReorgAttack.jsx — the status query
############################################################

@bp_reorg_attack.route('/api/reorgattack/status', methods=['GET'])
def get_network_status():
    try:
        result = reorg_manager.get_network_status()
        status_code = 200 if result['success'] else 500
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get network status: {str(e)}'
        }), 500








############################################################
# get_database_stats
############################################################
#
# GET /api/reorgattack/database/stats
#
# What the database holds: per network (told by the coinbase)
# the stored blocks and their height range, then the tracked
# transactions and their block sightings.
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/database/stats', methods=['GET'])
def get_database_stats():
    try:
        public_stats = {
            'total_blocks': 0,
            'min_height': None,
            'max_height': None,
            'height_range': 0
        }
        private_stats = {
            'total_blocks': 0,
            'min_height': None,
            'max_height': None,
            'height_range': 0
        }

        with get_db_connection() as conn:

            sqlFetchData = conn.execute(f'''
                SELECT 
                    COUNT(*) as total_blocks,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height
                FROM Blockchain_Blocks 
                WHERE {NETWORK_OF_BLOCK} = 'public'
            ''')
            result = sqlFetchData.fetchone()
            if result and result[0] > 0:
                public_stats = {
                    'total_blocks': result[0],
                    'min_height': result[1],
                    'max_height': result[2],
                    'height_range': result[2] - result[1] + 1 if result[1] and result[2] else 0
                }

            sqlFetchData = conn.execute(f'''
                SELECT 
                    COUNT(*) as total_blocks,
                    MIN(Height) as min_height,
                    MAX(Height) as max_height
                FROM Blockchain_Blocks 
                WHERE {NETWORK_OF_BLOCK} = 'private'
            ''')
            result = sqlFetchData.fetchone()
            if result and result[0] > 0:
                private_stats = {
                    'total_blocks': result[0],
                    'min_height': result[1],
                    'max_height': result[2],
                    'height_range': result[2] - result[1] + 1 if result[1] and result[2] else 0
                }

            sqlFetchData = conn.execute('SELECT COUNT(*) FROM Blockchain_Transactions')
            total_transactions = sqlFetchData.fetchone()[0]

            sqlFetchData = conn.execute('SELECT COUNT(*) FROM Blockchain_TxInBlocks')
            total_tx_block_links = sqlFetchData.fetchone()[0]

            return jsonify({
                'success': True,
                'stats': {
                    'public_network': public_stats,
                    'private_network': private_stats,
                    'total_transactions_tracked': total_transactions,
                    'total_tx_block_links': total_tx_block_links,
                    'database_message': 'All historical experiment data is preserved',
                    'sync_mode': 'on-demand',
                    'sync_status': 'Data is synced when requested by user'
                }
            }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get database stats: {str(e)}'
        }), 500








############################################################
# get_sync_status
############################################################
#
# GET /api/reorgattack/system/sync/status
#
# A static description of the on-demand sync model — no
# state is consulted.
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/system/sync/status', methods=['GET'])
def get_sync_status():
    try:
        return jsonify({
            'success': True,
            'sync_status': {
                'sync_mode': 'on-demand',
                'description': 'Data is synced automatically when endpoints are called'
            }
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to get sync status: {str(e)}'
        }), 500








############################################################
# force_sync
############################################################
#
# POST /api/reorgattack/system/sync/force
#
# Runs the sync every chain view runs on its own — both nodes'
# newest blocks and the tracked transactions' sightings — and
# says whether each node's blocks came through: a node that
# did not answer makes it a failure (500) naming that node.
#
# Used by:
#   - nothing calls this at the moment
############################################################

@bp_reorg_attack.route('/api/reorgattack/system/sync/force', methods=['POST'])
def force_sync():
    try:
        synced = reorg_manager.sync_recent_data()

        failed = [side for side, ok in synced.items() if not ok]
        if failed:
            return jsonify({
                'success': False,
                'message': f"Failed to force sync: the {' and '.join(failed)} node's blocks could not be read",
                'synced': synced
            }), 500

        return jsonify({
            'success': True,
            'message': 'Recent data synced successfully',
            'synced': synced
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to force sync: {str(e)}'
        }), 500




# The real instance, after every route above is registered —
# building it opens the RPC clients (see the header)
reorg_manager = ReorgAttackManager(REORG_ATTACK_CONFIG)
