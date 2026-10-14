#!/bin/sh
# Refresh the vendored sand engine in web/engine from sand-weaver, where it is
# developed (it started in dune-weaver-sim), and the tables' clear patterns from
# dune-weaver. Set SAND_WEAVER or DUNE_WEAVER to other checkouts.
set -e
cd "$(dirname "$0")"
src=${SAND_WEAVER:-../../sand-weaver}
dw=${DUNE_WEAVER:-../../dune-weaver}
rm -rf engine && mkdir -p engine/sim engine/dw-clear
cp "$src"/sim/SandSim.js "$src"/sim/shaders.js "$src"/sim/plow.js "$src"/sim/thr.js engine/sim/
cp "$src"/experiments/region-program/table-profiles.js engine/
for t in _pro _mini ''; do cp "$dw"/patterns/clear_from_in$t.thr "$dw"/patterns/clear_from_out$t.thr engine/dw-clear/; done
echo "Engine synced. Re-bake the clears for it: node web/bake-clears.mjs (see the file for setup)."
