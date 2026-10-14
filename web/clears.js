// The tables, their clears, and the sand a clear leaves: kept by the Sand page on its
// way through, and baked into clears/ by bake-clears.mjs for BAKED_PROFILE, so the
// page needn't simulate a clear at all. Shared by both so they set the engine up alike.
import {DEFAULT_SAND, DEFAULT_RENDER} from './engine/sim/SandSim.js';
import {parseThr, resamplePath} from './engine/sim/thr.js';
import {MAX_SEGMENTS} from './engine/sim/shaders.js';
import {TABLE_PROFILES} from './engine/table-profiles.js';

export const RES = 2048, BAKED_PROFILE = 'dwpro-v6';

// Sand-bed diameter (mm, from the BOMs) and clear pattern suffix per table. The
// clears follow dune-weaver's get_clear_pattern_file: Gold has no entry there and
// gets the OG's. The profiles are calibrated on the DWP; the others reuse them
// with the same 10 mm ball (their BOMs list 8-12 mm).
export const TABLES = {DWP: {table: 700, clear: '_pro'}, DWMP: {table: 250, clear: '_mini'}, DWG: {table: 395, clear: ''}};

// .thr files are in the table's frame; the engine works in sand-weaver's
// simulator frame, a horizontal reflection of it (sand-weaver thr-orientation.js).
const toSim = coords => coords.map(({theta, rho}) => ({theta: Math.PI - theta, rho}));
export const fetchCoords = async url => toSim(parseThr(await (await fetch(url)).text()).coords);

// Same setup as sand-weaver's render-thr.mjs + dw-preview.js. The plow grid keeps
// the profile's cell size in mm: its slumping works per cell, and a 2048 grid on
// the 250 mm DWMP runs ~5x slower than playback needs.
export function configure(sim, table, profileName) {
  const profile = TABLE_PROFILES[profileName], {ball, depth} = profile.physical, mm = TABLES[table].table;
  const sand = profile.sand.model === 1 ? {...profile.sand, floorMm: profile.sand.floorMm ?? depth, plowSize: Math.round((profile.sand.plowSize ?? 1024) * mm / profile.physical.table)} : profile.sand;
  Object.assign(sim.sand, DEFAULT_SAND, sand, {tableDiameterMm: mm, ballDiameterMm: ball, depthMm: depth});
  Object.assign(sim.render, DEFAULT_RENDER, profile.render);
}

// The table's clear (sand-weaver clear-patterns.js): from the rim in (clear_from_out,
// ending at the centre) when the drawing starts near the centre, else from the centre
// out. Always resampled alike, so the sand it leaves can be kept and baked.
export const clearUrl = (table, fromRim) => new URL(`engine/dw-clear/clear_from_${fromRim ? 'out' : 'in'}${TABLES[table].clear}.thr`, import.meta.url);
export const clearPath = (sim, coords) => resamplePath(coords, {maxSagitta: .0015 * (1024 / sim.resolution)});
// The engine advances in whole chunks, so the sand is kept at the last chunk inside the clear.
export const keptAt = clearSegs => clearSegs - clearSegs % MAX_SEGMENTS;

// Plow profiles keep their sand on the CPU, the others on the GPU.
export const takeSnap = sim => ({cursor: sim.cursor, relaxedIntervals: sim.relaxedIntervals, plowH: sim.plowH?.slice(), plowState: structuredClone(sim.plowState), height: sim.plowH ? null : sim.captureHeight()});
export function restoreSnap(sim, {cursor, relaxedIntervals, plowH, plowState, height}) {
  if (height) sim.seedHeight(height);
  Object.assign(sim, {cursor, relaxedIntervals, pending: 0});
  if (plowH) { Object.assign(sim, {plowH: plowH.slice(), plowState: structuredClone(plowState)}); sim.plowUpload(); }
}

// A baked clear's file name carries a hash of everything its sand depends on: the
// engine, the clear and the sand settings. A file baked by another engine or setting
// is never asked for, and the page simulates the clear instead.
const fnv = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); };
const text = url => fetch(url).then(r => r.text());
let engine;
export async function bakedName(sim, table, fromRim) {
  engine ??= Promise.all(['SandSim.js', 'plow.js', 'shaders.js', 'thr.js'].map(f => text(new URL(`engine/sim/${f}`, import.meta.url)))).then(t => t.join(''));
  const key = fnv(await engine + await text(clearUrl(table, fromRim)) + JSON.stringify(sim.sand) + sim.resolution);
  return `${table}-from-${fromRim ? 'rim' : 'centre'}-${key}.bin`;
}
export const bakedUrl = name => new URL(`clears/${name}`, import.meta.url);

// A baked clear: a uint32 header length, the JSON header padded to an even length,
// then the plow heights as little-endian uint16 between the header's lo and hi
// (0.0001 mm steps on the DWP, where float32 would double the files for nothing).
export function encode({cursor, relaxedIntervals, plowH, plowState}) {
  let lo = Infinity, hi = -Infinity;
  for (const v of plowH) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const json = JSON.stringify({cursor, relaxedIntervals, lo, hi, plowState});
  if (json.includes('null')) throw new Error('The plow state has numbers JSON cannot keep.');
  const head = new TextEncoder().encode(json.length % 2 ? json + ' ' : json), out = new Uint8Array(4 + head.length + 2 * plowH.length);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  const q = new Uint16Array(out.buffer, 4 + head.length);
  for (let i = 0; i < plowH.length; i++) q[i] = Math.round((plowH[i] - lo) / (hi - lo || 1) * 65535);
  return out;
}
export function decode(buffer) {
  const n = new DataView(buffer).getUint32(0, true), {lo, hi, ...snap} = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, n)));
  const q = new Uint16Array(buffer, 4 + n), plowH = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) plowH[i] = lo + q[i] / 65535 * (hi - lo);
  return {...snap, plowH, height: null};
}
