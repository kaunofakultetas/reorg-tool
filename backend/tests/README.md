# Backend regression tests

Three layers, from cheapest to heaviest:

| Layer | Files | Needs network? | When to run |
|---|---|---|---|
| Config invariants | `test_configs.py` | no | always |
| Offline regression | `test_main.py`, `test_database.py`, `test_fullnode_rpc.py`, `test_block_sync.py`, `test_peer_switch.py`, `test_reorg_manager.py`, `test_api_routes.py` | no | always |
| Live smoke | `integration/test_live_smoke.py` | yes (running backend) | opt-in via `RUN_LIVE=1` |

The offline layers are the safety net: they must pass with no network,
no fullnode and no production database. The anchors in `helpers.py` are
real blocks of the live KNF Coin chain — their headers, coinbase scripts
and the rows the backend stored for them — so the scrypt proof-of-work
hash, the log2 chain work, the coinbase reader and the stored header
timestamp are all pinned to what production actually holds: any change
that would store a block differently fails loudly. The date and time
production stored as text before the move to timestamps are anchors too
(`OLD_TEXT_TIMES`), for the one migration that turns them back into
timestamps.

No known defect is open: the ones the first review found are fixed, and
their tests live in their home files.

## Running

The whole offline suite in the PRODUCTION image, with no network
(builds it under the tag `reorg-backend-check` first):

    ./runTests.sh                         # from backend/; extra arguments go to unittest discover

Against the WORKING TREE, in a throwaway container (from the repo root):

    sudo docker run --rm --network none -v ./backend:/b:ro -w /b reorg-backend python -m unittest discover -s tests -v

Inside the running container — this tests the working tree ONLY while
the `./backend:/app` dev mount is enabled in docker-compose.yml;
otherwise it tests the source baked into the image. The safety nets in
`helpers.py` keep every test off the production database and the real
nodes:

    sudo docker exec -w /app -e PYTHONDONTWRITEBYTECODE=1 reorg-backend python -m unittest discover -s tests -v

Including the live smoke layer (the backend must be up):

    sudo docker exec -w /app -e PYTHONDONTWRITEBYTECODE=1 -e RUN_LIVE=1 reorg-backend python -m unittest discover -s tests -v

## Conventions

- Offline by default: a test that talks to the network belongs under
  `integration/` and must skip itself unless `RUN_LIVE=1` is set. The
  live layer only reads — it never flips the attack switch, sends or
  tracks a transaction.
- Nodes are `helpers.FakeNode`s behind `helpers.FakeNetwork`, which
  patches `requests.post` — the backend's only door to them — and answers
  the way a KNF Coin node does (a refusal is the node's error object
  under HTTP 500). The database is a `helpers.TempDatabase`: a
  throwaway file with the production schema that every module's
  `get_db_connection` is pointed at. Outside them, `helpers.py` makes a
  database open or an RPC call FAIL, so a forgotten fixture can never
  reach production, even inside the live container.
- Routes are tested through the app as `main.py` builds it
  (`helpers.run_main`, the server start patched out), with the route
  module's `reorg_manager` swapped for `helpers.make_manager()` — one
  wired to the fake nodes. Never let a route test reach the real
  manager: connect and disconnect would flip the class's attack.
- Shared fixtures and anchors live in `helpers.py`; if a deliberate
  behaviour change breaks an anchor, re-record it there in one place and
  say so in the commit message.
- Style: test files carry the house file/class banners, but test
  methods use a one-line comment and single blank lines instead of full
  method banners — a test's name is its documentation.
- A defect found by review but not yet fixed gets its regression test
  UP FRONT, in `test_<area>_defects.py`, decorated
  `@unittest.expectedFailure`: the test states the wanted behaviour and
  fails today. Once the fix lands, unittest reports it as an "unexpected
  success" — which fails the run — and that is the cue to drop the
  decorator and move the test into its home file.
