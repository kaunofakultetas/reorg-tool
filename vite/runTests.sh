#!/bin/sh
# -----------------------------------------------------------
#  [*] Frontend — regression test runner
#
#  Builds the builder stage of the PRODUCTION Dockerfile (the
#  same node image and npm install that produce dist/ — so the
#  build itself must pass first) and runs the vitest suite
#  inside a throwaway container — what gets tested is exactly
#  what ships, and the host needs no node. Extra arguments go
#  to vitest (a file, -t "name", --coverage …).
#
#  While developing, running vitest inside the reorg-vite dev
#  container is quicker — app/tests/README.md has the command.
#  That container installs the test dependencies when it
#  starts, so restart it once after they change in
#  package.json.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build --target builder -t reorg-vite-check .
sudo docker run --rm --name reorg-vite-tests --memory=6g --memory-swap=6g --cpus=6 \
  reorg-vite-check npx vitest run --maxWorkers=4 "$@"
