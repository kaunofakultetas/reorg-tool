############################################################
#  [*] Database initialization
#
#  The SQLite schema: the reorg attack tables
#  (Blockchain_Blocks mirrored from the fullnodes, the
#  tracked Blockchain_Transactions and the Blockchain_
#  TxInBlocks sightings that tie a tx to the blocks it landed
#  in) created IF NOT EXISTS on every boot, so a fresh volume
#  gets the full schema and an existing one keeps its rows.
#
#  A block's time is stored as the block header's own
#  timestamp — seconds since the Unix epoch, UTC by
#  definition — and never as a calendar date or a clock time:
#  which day and hour a block falls on depends on the
#  viewer's timezone, and only the viewer's browser knows
#  that. Databases from before kept the date and time as
#  text, written in the backend's local timezone; the one
#  migration here turns those into timestamps, once, after
#  copying the old database next to itself.
#
#  Used by:
#    - main.py — init_db() in the __main__ block, STEP 1
############################################################


import os
import sqlite3
from datetime import datetime

from .db import get_db_connection


# The block table, by name — the migration builds its new
# table under another name before swapping it in
BLOCKS_TABLE = '''
    CREATE TABLE IF NOT EXISTS "{name}" (
        "Height"	INTEGER NOT NULL,
        "Hash"	TEXT NOT NULL UNIQUE,
        "PrevHash"	TEXT NOT NULL,
        "CoinbaseMessage"	TEXT NOT NULL,
        "Timestamp"	INTEGER NOT NULL,
        "ScryptHash"	TEXT NOT NULL,
        "ChainWork"	REAL NOT NULL,
        PRIMARY KEY("Hash")
    )
'''

# What the database file is copied to before the migration
# rewrites its block table
PRE_MIGRATION_SUFFIX = '.before-timestamps'








############################################################
# init_db
############################################################
#
# The single entry point — the schema is all the reorg tool
# needs, so there is no seed-data step.
#
# Used by:
#   - main.py — once at startup
############################################################

def init_db():
    init_db_tables()








############################################################
# init_db_tables
############################################################
#
# Every table, grouped by feature. All CREATEs are IF NOT
# EXISTS — safe to run on every boot. A block table still in
# the old date-and-time shape is migrated before its indexes
# are made, as the timestamp index needs the new column. The
# three indexes on Blockchain_Blocks back the height, time
# and coinbase lookups the sync and view queries lean on.
#
# Used by:
#   - init_db (above)
############################################################

def init_db_tables():
    with get_db_connection() as conn:


        ######################## Reorg attack tables ########################
        conn.execute(BLOCKS_TABLE.format(name='Blockchain_Blocks'))
        if has_text_block_times(conn):
            migrate_block_times(conn)
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_blocks_height ON Blockchain_Blocks(Height)
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON Blockchain_Blocks(Timestamp)
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_blocks_coinbase ON Blockchain_Blocks(CoinbaseMessage)
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS "Blockchain_Transactions" (
                "TXID"	    TEXT NOT NULL UNIQUE,
                "Inputs"	TEXT NOT NULL,
                "Outputs"	TEXT NOT NULL,
                "Color"     TEXT NOT NULL,
                PRIMARY KEY("TXID")
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS "Blockchain_TxInBlocks" (
                "TXID"	TEXT NOT NULL,
                "BlockHash"	TEXT NOT NULL,
                UNIQUE("TXID","BlockHash")
            )
        ''')
        #####################################################################








############################################################
# has_text_block_times
############################################################
#
# Whether the block table is still in the old shape: a Date
# and a Time text column where the Timestamp belongs.
#
# Used by:
#   - init_db_tables (above)
############################################################

def has_text_block_times(conn) -> bool:
    columns = {row[1] for row in conn.execute('PRAGMA table_info("Blockchain_Blocks")')}
    return 'Date' in columns and 'Timestamp' not in columns








############################################################
# text_time_to_timestamp
############################################################
#
# One old row's date and time back into the timestamp they
# were made from. The old sync wrote them with the backend's
# local clock, so they are read back in the local timezone
# of the same machine — exact on the UTC hosts the stack
# runs on, and exact in any other zone except for the one
# repeated hour when summer time ends.
#
# Used by:
#   - migrate_block_times (below)
############################################################

def text_time_to_timestamp(date: str, time: str) -> int:
    return int(datetime.strptime(f'{date} {time}', '%Y-%m-%d %H:%M:%S').timestamp())








############################################################
# backup_database
############################################################
#
# Copies the open database, consistently, to a file next to
# it named with PRE_MIGRATION_SUFFIX, unless such a copy is
# already there. Hands back the copy's path, or None for a
# database that lives in memory and has no file to copy.
#
# Used by:
#   - migrate_block_times (below)
############################################################

def backup_database(conn):
    path = conn.execute('PRAGMA database_list').fetchone()[2]
    if not path:
        return None

    target = path + PRE_MIGRATION_SUFFIX
    if not os.path.exists(target):
        copy = sqlite3.connect(target)
        try:
            conn.backup(copy)
        finally:
            copy.close()
    return target








############################################################
# migrate_block_times
############################################################
#
# Moves an old block table to timestamps: after a copy of the
# whole database (backup_database), a new table is filled
# with every row, its date and time turned into the
# timestamp they came from, then swapped in for the old one —
# all in one transaction, so a failure anywhere leaves the
# old table exactly as it was. The old table's indexes go
# with it; init_db_tables makes the new ones.
#
# Used by:
#   - init_db_tables (above)
############################################################

def migrate_block_times(conn):
    backup = backup_database(conn)

    conn.commit()
    conn.isolation_level = None
    try:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute(BLOCKS_TABLE.format(name='Blockchain_Blocks_migrated'))
        rows = conn.execute('''
            SELECT Height, Hash, PrevHash, CoinbaseMessage, Date, Time, ScryptHash, ChainWork
            FROM Blockchain_Blocks
        ''').fetchall()
        conn.executemany('''
            INSERT INTO Blockchain_Blocks_migrated (Height, Hash, PrevHash, CoinbaseMessage, Timestamp, ScryptHash, ChainWork)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', [(row[0], row[1], row[2], row[3], text_time_to_timestamp(row[4], row[5]), row[6], row[7]) for row in rows])
        conn.execute('DROP TABLE Blockchain_Blocks')
        conn.execute('ALTER TABLE Blockchain_Blocks_migrated RENAME TO Blockchain_Blocks')
        conn.execute('COMMIT')
    except Exception:
        if conn.in_transaction:
            conn.execute('ROLLBACK')
        raise
    finally:
        conn.isolation_level = ''

    print(f"[*] Moved {len(rows)} stored blocks from text dates and times to timestamps"
          f" (the database before: {backup or 'in memory, not copied'})")
