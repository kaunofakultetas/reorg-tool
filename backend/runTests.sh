#!/bin/sh
# -----------------------------------------------------------
#  [*] Backend — regression test runner
#
#  Builds the backend's PRODUCTION image from this folder
#  under a tag of its own (the same Python, the same pinned
#  packages and the same source that ship — the running
#  backend's image is left alone) and runs the offline
#  unittest suite inside a throwaway container. The container
#  gets no network, so a test that reaches for a fullnode
#  fails instead of passing by luck, and it never sees the
#  production database. Extra arguments go to unittest's
#  discovery — a file pattern, a test-name filter, verbose
#  output.
#
#  The live smoke layer needs the running backend and stays
#  opt-in; tests/README.md has that command, and the quicker
#  run inside the running container while developing.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build -t reorg-backend-check .
sudo docker run --rm --name reorg-backend-tests --network none \
  reorg-backend-check python -m unittest discover -s tests "$@"
