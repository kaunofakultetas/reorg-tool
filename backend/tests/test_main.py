############################################################
#  [*] Entrypoint regression tests
#
#  main.py wires the backend only when it is RUN: importing
#  it yields a bare Flask app with no route of its own — by
#  design, the blueprint import is deferred into the __main__
#  block — and running it creates the schema, trusts one
#  proxy hop for the client's address (Caddy stands in
#  front), registers every reorg-attack route and starts the
#  server on 0.0.0.0:8000, in debug mode only when APP_DEBUG
#  is "true" in any case. Offline: main runs through runpy
#  with the server start patched out and the schema going
#  into a throwaway file.
############################################################


import os
import sys
import json
import unittest
import subprocess

from flask import request
from werkzeug.middleware.proxy_fix import ProxyFix

from tests import helpers


# Every route of the reorg-attack blueprint, with its methods
REORG_ROUTES = {
    ('/api/reorgattack/connect', 'GET'),
    ('/api/reorgattack/disconnect', 'GET'),
    ('/api/reorgattack/privateside/getpeers', 'GET'),
    ('/api/reorgattack/fetchtxinfo/<string:txid>', 'GET'),
    ('/api/reorgattack/transactions/send', 'POST'),
    ('/api/reorgattack/blockchain/data', 'GET'),
    ('/api/reorgattack/blocks/<string:network>', 'GET'),
    ('/api/reorgattack/dates/available', 'GET'),
    ('/api/reorgattack/transactions', 'GET'),
    ('/api/reorgattack/transactions', 'POST'),
    ('/api/reorgattack/transactions/<string:txid>', 'DELETE'),
    ('/api/reorgattack/status', 'GET'),
    ('/api/reorgattack/database/stats', 'GET'),
    ('/api/reorgattack/system/sync/status', 'GET'),
    ('/api/reorgattack/system/sync/force', 'POST'),
}

# Flask's own route for the static folder, there in every app
STATIC_RULE = '/static/<path:filename>'








############################################################
# BareImportTests
############################################################

class BareImportTests(unittest.TestCase):

    def test_importing_main_registers_no_route_of_the_tool(self):
        # A fresh interpreter, so the module this suite runs is not
        # the one inspected
        probe = subprocess.run(
            [sys.executable, '-c', 'import json, main; print(json.dumps(sorted(r.rule for r in main.app.url_map.iter_rules())))'],
            cwd=os.path.dirname(helpers.MAIN_PATH), capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(probe.stdout.strip().splitlines()[-1]), [STATIC_RULE])








############################################################
# RunTests
############################################################
#
# main.py run as the container runs it, through
# helpers.run_main.
############################################################

class RunTests(unittest.TestCase):

    def setUp(self):
        self.db = self.enterContext(helpers.TempDatabase())

    def test_running_main_creates_the_schema(self):
        helpers.run_main()
        tables = {row[0] for row in self.db.rows("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertEqual(tables, {'Blockchain_Blocks', 'Blockchain_Transactions', 'Blockchain_TxInBlocks'})

    def test_running_main_registers_every_reorg_route(self):
        app, _ = helpers.run_main()
        routes = {(rule.rule, method) for rule in app.url_map.iter_rules() if rule.rule != STATIC_RULE
                  for method in rule.methods - {'HEAD', 'OPTIONS'}}
        self.assertEqual(routes, REORG_ROUTES)

    def test_running_main_serves_on_every_interface_at_port_8000(self):
        _, served = helpers.run_main()
        served.assert_called_once()
        self.assertEqual((served.call_args.kwargs['host'], served.call_args.kwargs['port']), ('0.0.0.0', 8000))

    def test_running_main_trusts_one_proxy_hop(self):
        app, _ = helpers.run_main()
        self.assertIsInstance(app.wsgi_app, ProxyFix)
        self.assertEqual((app.wsgi_app.x_for, app.wsgi_app.x_proto, app.wsgi_app.x_host, app.wsgi_app.x_prefix),
                         (1, 1, 1, 1))

    def test_the_client_address_is_the_one_the_proxy_forwards(self):
        # Caddy passes the student's address on in X-Forwarded-For
        app, _ = helpers.run_main()
        app.add_url_rule('/whoami', 'whoami', lambda: request.remote_addr)
        response = app.test_client().get('/whoami', headers={'X-Forwarded-For': '10.20.30.40'},
                                         environ_base={'REMOTE_ADDR': '172.20.0.2'})
        self.assertEqual(response.get_data(as_text=True), '10.20.30.40')

    def test_debug_is_off_unless_app_debug_says_true(self):
        for value, debug in ((None, False), ('true', True), ('True', True), ('TRUE', True),
                             ('false', False), ('1', False), ('yes', False)):
            with self.subTest(APP_DEBUG=value):
                _, served = helpers.run_main(app_debug=value)
                self.assertIs(served.call_args.kwargs['debug'], debug)


if __name__ == '__main__':
    unittest.main()
