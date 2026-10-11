#!/bin/sh
# Refresh the vendored sand engine in web/engine from sand-weaver, where it is
# developed (it started in dune-weaver-sim). Set SAND_WEAVER to another checkout.
set -e
cd "$(dirname "$0")"
src=${SAND_WEAVER:-../../sand-weaver}
rm -rf engine && mkdir -p engine/sim engine/dw-clear
cp "$src"/sim/SandSim.js "$src"/sim/shaders.js "$src"/sim/plow.js "$src"/sim/thr.js engine/sim/
cp "$src"/experiments/region-program/table-profiles.js engine/
cp "$src"/vendor/dw-clear/clear_from_in_pro.thr "$src"/vendor/dw-clear/clear_from_out_pro.thr engine/dw-clear/
