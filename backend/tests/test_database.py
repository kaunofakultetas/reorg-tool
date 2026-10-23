############################################################
#  [*] Database helper and schema regression tests
#
#  What every SQL statement of the backend rides on: one
#  fresh connection per call with rows readable by column
#  name, the file chosen ONCE, at import, from DB_PATH — the
#  volume mount's /data/database.db without it — and the three
#  reorg tables with the constraints the sync and the tracker
#  lean on: a block stored once per hash with its header
#  timestamp, nothing stored without its fields, a sighting
#  recorded once per block. The schema is created IF NOT
#  EXISTS, so a boot on a database full of an earlier class's
#  blocks changes nothing — except for a database from before
#  timestamps, whose text dates and times the one migration
#  turns back into the timestamps they were made from, after
#  copying the old database aside. Offline, on throwaway
#  files.
############################################################


import os
import sys
import sqlite3
import unittest
import subprocess

from app.database import db_init
from tests import helpers


# What a fresh interpreter prints as get_db_connection's file —
# right after the import, or after DB_PATH changed later on
DEFAULT_PATH_PROBE = 'from app.database.db import get_db_connection; print(get_db_connection.__defaults__[0])'
CHANGED_LATER_PROBE = ("import os; from app.database.db import get_db_connection; "
                       "os.environ['DB_PATH'] = '/tmp/veliau.db'; print(get_db_connection.__defaults__[0])")


def default_path_under(env, probe=DEFAULT_PATH_PROBE):
    clean = {key: value for key, value in os.environ.items() if key != 'DB_PATH'}
    clean.update(env)
    answer = subprocess.run([sys.executable, '-c', probe], env=clean,
                            cwd=os.path.dirname(helpers.MAIN_PATH), capture_output=True, text=True, check=True)
    return answer.stdout.strip()


def columns(db, table):
    # Each column's name with whether it refuses NULL
    return {row[1]: bool(row[3]) for row in db.rows(f'PRAGMA table_info("{table}")')}


def block_indexes(db):
    # The names of the indexes on the block table
    return {row[0] for row in db.rows("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Blockchain_Blocks'")}


# The block table as databases from before the move to
# timestamps have it: the date and time as text, indexed by
# date
OLD_BLOCKS_TABLE = '''
    CREATE TABLE "Blockchain_Blocks" (
        "Height" INTEGER NOT NULL, "Hash" TEXT NOT NULL UNIQUE, "PrevHash" TEXT NOT NULL,
        "CoinbaseMessage" TEXT NOT NULL, "Date" TEXT NOT NULL, "Time" TEXT NOT NULL,
        "ScryptHash" TEXT NOT NULL, "ChainWork" REAL NOT NULL, PRIMARY KEY("Hash")
    )
'''
OLD_DATE_INDEX = 'CREATE INDEX idx_blocks_date ON Blockchain_Blocks(Date)'








############################################################
# ConnectionTests
############################################################

class ConnectionTests(unittest.TestCase):

    def setUp(self):
        self.db = self.enterContext(helpers.TempDatabase())

    def test_rows_are_readable_by_column_name(self):
        self.db.store_block(6403, 'aa' * 32, 'bb' * 32, helpers.PUBLIC_MINER, helpers.REAL_BLOCKS[6403]['time'])
        with self.db.connect() as conn:
            row = conn.execute('SELECT Height, CoinbaseMessage FROM Blockchain_Blocks').fetchone()
        self.assertEqual((row['Height'], row['CoinbaseMessage']), (6403, helpers.PUBLIC_MINER))

    def test_every_call_opens_a_connection_of_its_own(self):
        # Closing one never pulls the floor from under another
        first, second = self.db.connect(), self.db.connect()
        self.assertIsNot(first, second)
        first.close()
        self.assertEqual(second.execute('SELECT COUNT(*) FROM Blockchain_Blocks').fetchone()[0], 0)
        second.close()

    def test_the_file_comes_from_db_path(self):
        self.assertEqual(default_path_under({'DB_PATH': '/tmp/kita.db'}), '/tmp/kita.db')

    def test_without_db_path_the_file_is_on_the_data_volume(self):
        self.assertEqual(default_path_under({}), '/data/database.db')

    def test_the_file_is_chosen_once_at_import(self):
        # Changing DB_PATH later moves nothing — the process keeps the
        # file it started with
        self.assertEqual(default_path_under({'DB_PATH': '/tmp/pradzioje.db'}, CHANGED_LATER_PROBE), '/tmp/pradzioje.db')








############################################################
# SchemaTests
############################################################

class SchemaTests(unittest.TestCase):

    def setUp(self):
        self.db = self.enterContext(helpers.TempDatabase())

    def insert(self, sql, params):
        with self.db.connect() as conn:
            conn.execute(sql, params)

    def test_the_three_reorg_tables_with_every_column_required(self):
        self.assertEqual(columns(self.db, 'Blockchain_Blocks'), {
            'Height': True, 'Hash': True, 'PrevHash': True, 'CoinbaseMessage': True,
            'Timestamp': True, 'ScryptHash': True, 'ChainWork': True,
        })
        self.assertEqual(columns(self.db, 'Blockchain_Transactions'),
                         {'TXID': True, 'Inputs': True, 'Outputs': True, 'Color': True})
        self.assertEqual(columns(self.db, 'Blockchain_TxInBlocks'), {'TXID': True, 'BlockHash': True})

    def test_blocks_are_indexed_for_the_height_time_and_coinbase_lookups(self):
        self.assertTrue({'idx_blocks_height', 'idx_blocks_timestamp', 'idx_blocks_coinbase'} <= block_indexes(self.db))

    def test_a_block_is_stored_once_per_hash(self):
        self.db.store_block(6403, 'aa' * 32, 'bb' * 32, helpers.PUBLIC_MINER, helpers.REAL_BLOCKS[6403]['time'])
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.store_block(6403, 'aa' * 32, 'bb' * 32, helpers.ATTACKER, helpers.REAL_BLOCKS[6403]['time'])

    def test_a_tracked_transaction_needs_its_inputs_outputs_and_colour(self):
        for missing in ('Inputs', 'Outputs', 'Color'):
            with self.subTest(missing=missing):
                values = {'TXID': 'cc' * 32, 'Inputs': '[]', 'Outputs': '[]', 'Color': 'green', missing: None}
                with self.assertRaises(sqlite3.IntegrityError):
                    self.insert('INSERT INTO Blockchain_Transactions (TXID, Inputs, Outputs, Color) VALUES (?, ?, ?, ?)',
                                (values['TXID'], values['Inputs'], values['Outputs'], values['Color']))

    def test_a_transaction_is_tracked_once(self):
        self.insert('INSERT INTO Blockchain_Transactions VALUES (?, ?, ?, ?)', ('cc' * 32, '[]', '[]', 'green'))
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('INSERT INTO Blockchain_Transactions VALUES (?, ?, ?, ?)', ('cc' * 32, '[]', '[]', 'red'))

    def test_a_sighting_is_recorded_once_per_block(self):
        self.insert('INSERT INTO Blockchain_TxInBlocks VALUES (?, ?)', ('cc' * 32, 'aa' * 32))
        self.insert('INSERT INTO Blockchain_TxInBlocks VALUES (?, ?)', ('cc' * 32, 'bb' * 32))
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('INSERT INTO Blockchain_TxInBlocks VALUES (?, ?)', ('cc' * 32, 'aa' * 32))

    def test_a_boot_on_a_full_database_changes_nothing(self):
        self.db.store_block(6403, 'aa' * 32, 'bb' * 32, helpers.PUBLIC_MINER, helpers.REAL_BLOCKS[6403]['time'])
        self.insert('INSERT INTO Blockchain_Transactions VALUES (?, ?, ?, ?)', ('cc' * 32, '[]', '[]', 'green'))
        self.insert('INSERT INTO Blockchain_TxInBlocks VALUES (?, ?)', ('cc' * 32, 'aa' * 32))

        db_init.init_db()
        db_init.init_db()

        self.assertEqual(self.db.rows('SELECT Height, CoinbaseMessage FROM Blockchain_Blocks'), [(6403, helpers.PUBLIC_MINER)])
        self.assertEqual(self.db.rows('SELECT TXID, Color FROM Blockchain_Transactions'), [('cc' * 32, 'green')])
        self.assertEqual(self.db.rows('SELECT COUNT(*) FROM Blockchain_TxInBlocks'), [(1,)])








############################################################
# MigrationTests
############################################################
#
# A database from before timestamps, booted by the new code:
# the three real blocks as production stored them — their
# date and time as text, in the backend's UTC clock — come
# back with the timestamps they were made from, the old
# database is kept beside the new, and nothing about it is
# done twice or done halfway.
############################################################

class MigrationTests(unittest.TestCase):

    def setUp(self):
        self.db = self.enterContext(helpers.TempDatabase())

    def old_database(self, rows):
        # The temp file's block table swapped for the old shape
        with self.db.connect() as conn:
            conn.execute('DROP TABLE Blockchain_Blocks')
            conn.execute(OLD_BLOCKS_TABLE)
            conn.execute(OLD_DATE_INDEX)
            conn.executemany('INSERT INTO Blockchain_Blocks VALUES (?, ?, ?, ?, ?, ?, ?, ?)', rows)

    def real_old_rows(self):
        return [(height, helpers.REAL_BLOCKS[height]['hash'], helpers.REAL_BLOCKS[height]['previousblockhash'],
                 message, *helpers.OLD_TEXT_TIMES[height], scrypt_hash, log2_work)
                for height, (_, message, scrypt_hash, log2_work) in helpers.REAL_ROWS.items()]

    def boot(self, zone='UTC'):
        with helpers.clock_zone(zone):
            db_init.init_db_tables()

    def test_the_real_rows_get_back_the_timestamps_they_were_made_from(self):
        self.old_database(self.real_old_rows())
        self.boot()
        self.assertEqual(sorted(self.db.rows('SELECT Height, Hash, PrevHash, CoinbaseMessage, Timestamp, ScryptHash, ChainWork FROM Blockchain_Blocks')),
                         sorted((height, helpers.REAL_BLOCKS[height]['hash'], helpers.REAL_BLOCKS[height]['previousblockhash'],
                                 message, timestamp, scrypt_hash, log2_work)
                                for height, (timestamp, message, scrypt_hash, log2_work) in helpers.REAL_ROWS.items()))

    def test_the_table_takes_the_new_shape_and_indexes(self):
        self.old_database(self.real_old_rows())
        self.boot()
        self.assertEqual(set(columns(self.db, 'Blockchain_Blocks')),
                         {'Height', 'Hash', 'PrevHash', 'CoinbaseMessage', 'Timestamp', 'ScryptHash', 'ChainWork'})
        self.assertTrue({'idx_blocks_height', 'idx_blocks_timestamp', 'idx_blocks_coinbase'} <= block_indexes(self.db))
        self.assertNotIn('idx_blocks_date', block_indexes(self.db))

    def test_rows_written_on_another_zones_clock_are_read_back_in_it(self):
        # A host on Lithuanian summer time wrote block 6403 as 05:21:08
        self.old_database([(6403, 'aa' * 32, 'bb' * 32, helpers.PUBLIC_MINER, '2026-10-19', '05:21:08', '00' * 32, 1.0)])
        self.boot('Europe/Vilnius')
        self.assertEqual(self.db.rows('SELECT Timestamp FROM Blockchain_Blocks'), [(helpers.REAL_BLOCKS[6403]['time'],)])

    def test_the_old_database_is_kept_beside_the_new(self):
        self.old_database(self.real_old_rows())
        self.boot()
        copy = sqlite3.connect(self.db.path + db_init.PRE_MIGRATION_SUFFIX)
        try:
            self.assertEqual(sorted(copy.execute('SELECT Height, Date, Time FROM Blockchain_Blocks').fetchall()),
                             sorted((height, *helpers.OLD_TEXT_TIMES[height]) for height in helpers.REAL_ROWS))
        finally:
            copy.close()

    def test_a_second_boot_migrates_nothing_and_keeps_the_first_copy(self):
        self.old_database(self.real_old_rows())
        self.boot()
        backup = self.db.path + db_init.PRE_MIGRATION_SUFFIX
        with open(backup, 'rb') as kept:
            first_copy = kept.read()
        self.db.store_block(6404, 'cc' * 32, helpers.REAL_BLOCKS[6403]['hash'], helpers.PUBLIC_MINER, helpers.REAL_BLOCKS[6403]['time'] + 60)

        self.boot()

        self.assertEqual(len(self.db.rows('SELECT Hash FROM Blockchain_Blocks')), 4)
        with open(backup, 'rb') as kept:
            self.assertEqual(kept.read(), first_copy)

    def test_a_row_that_cannot_be_read_leaves_the_old_table_whole(self):
        # One transaction: the swap happens for every row or not at all
        rows = self.real_old_rows() + [(1, 'dd' * 32, 'ee' * 32, helpers.PUBLIC_MINER, 'vakar', '00:00:00', '00' * 32, 1.0)]
        self.old_database(rows)
        with self.assertRaises(ValueError):
            self.boot()
        self.assertIn('Date', columns(self.db, 'Blockchain_Blocks'))
        self.assertEqual(len(self.db.rows('SELECT Hash FROM Blockchain_Blocks')), 4)

    def test_a_fresh_database_needs_no_migration_and_keeps_no_copy(self):
        self.boot()
        self.assertIn('Timestamp', columns(self.db, 'Blockchain_Blocks'))
        self.assertFalse(os.path.exists(self.db.path + db_init.PRE_MIGRATION_SUFFIX))


if __name__ == '__main__':
    unittest.main()
