// Sand and lighting profiles for the embedded DW simulator.
//
// 'sim-default' is the simulator's own look (700 mm table, 10 mm ball, 3.2 mm
// groove, ridge berm, one raking light): every check made before 2026-09-30
// was rendered with it, and it stays the default so those renders reproduce.
//
// 'dwpro' is calibrated against a photo of the DW Pro after it drew beaver v11
// (output/beaver-log-20260928/README.md, "On the table"):
//   - geometry: the 10 mm magnet ball (DW Pro BOM) under ~2.5 mm of sand, "about
//     25% of the height of the magnetic ball" (assembly guide), riding on the
//     tray floor. The photo's ball, 49 px against nose rings drawn at 0.25-ball
//     pitch 12.5 px apart, puts the drawable radius within ~3% of 345 mm, so
//     the 700 mm table stands;
//   - floor: 1 mm EVA foam lines the tray, and with the ball on it every groove
//     shows the dark floor through thin sand. That, not shading, is most of the
//     contrast in the photo;
//   - berm: the ridge beside a groove holds the sand the ball moves. 2.5 mm at
//     gain 2.6 keeps roughly the volume of a fresh groove; the simulator's
//     default 0.5 mm ridge keeps about 5%;
//   - light: the table's LED ring, 15 mm above the sand, each light shadowed.
// Known gaps, all from volume not being conserved in closed areas: a small
// dense fill (an eye) heaps a sand mound in the middle on the table but reads
// dark in the simulator, and a dense zigzag in a small box (the teeth) became a
// raised block with a slot. Backfill adds sand on every repeated pass, so a
// dense spiral renders paler than the bare floor it leaves on the table. Long
// smooth curves show faint chord pinches.
export const TABLE_PROFILES = Object.freeze({
  'sim-default': {physical: {table: 700, ball: 10, depth: 3.2}, sand: {}, render: {}, lights: [.5, 2.5, 4.5]},
  dwpro: {
    physical: {table: 700, ball: 10, depth: 2.5},
    sand: {bermWidthMm: 2.5, bermGain: 2.6},
    render: {floor: 1, coverMm: .6, floorColor: [.1, .11, .2], sandColor: [.8, .82, .95], lightMode: 1, ringRadius: 1.02, ringHeightMm: 15, shadowMm: 14},
    // The ring is the view on the table; one raking light is kept for reading relief.
    lights: ['ring', 2.5],
  },
  // dwpro with two fixes from beaver v17 on the table (IMG_4109, 2026-10-01). The
  // teeth, filled side to side at 0.25 ball, drew smooth dark troughs; dwpro
  // rendered crisp stripes, because each pass backfilled the groove beside it
  // with sand the ball no longer had. A ball running back beside the groove it
  // cut a moment ago has dumped its bow wave at the turn (v13's teeth drew
  // bright frames of end piles), so within half a ball of its own path from the
  // last bowWaveMm of travel it now backfills nothing. And the 0.16 mm slivers
  // two passes a quarter ball apart leave on the floor are swept off
  // (scrapeMm). The nose's spiral at the same pitch keeps its rings (its last
  // ring is a lap back), and the hair renders as under dwpro. A rule on the
  // distance since the last reversal instead darkened the hair, whose strokes
  // reverse every 25-100 mm. Still unmodelled: the end piles themselves (the
  // bright caps at the hair's tips in the photo). Probes: node
  // scripts/sand-probe.mjs <dir> --profile=dwpro-v2.
  'dwpro-v2': {
    physical: {table: 700, ball: 10, depth: 2.5},
    sand: {bermWidthMm: 2.5, bermGain: 2.6, bowWaveMm: 40, scrapeMm: .25},
    render: {floor: 1, coverMm: .6, floorColor: [.1, .075, .075], sandColor: [1.3, 1.17, 1.19], lightMode: 1, ringRadius: 1.02, ringHeightMm: 15, shadowMm: 14},   // colours matched to the IMG_4109 photo (fur grooves and ridges)
    lights: ['ring', 2.5],
  },
  // The DW Pro with the plow model (sim/plow.js, `model: 1`): sand
  // conserved, carried as a bow wave, spilled into ridges mostly on the side
  // being cut, dumped at reversals, flowing back in behind the ball, slumped
  // to repose. The sand settings are a fit to 3D granular physics on five
  // calibration patches (benchmarks/sim-calibration/mpm, scripts/sand-patches.mjs:
  // 0.38 mm RMS; the carve model, 0.95). Not fitted to the photo, they score
  // 0.505 on it (scripts/sim-fit.mjs; dwpro-v2 0.311; the best fit to the photo
  // alone 0.516). The render is a fit of the ring render's relief to the photo
  // (0.506), its sand brightened to the photo's median by eye. coverMm 1.4 is
  // that fit's stand-in for the photo's dark slits, not a measured property of
  // the sand. Still off: a quarter-ball spiral's rings (the nose, the eyes) read
  // fainter than on the table, and the look has about half the photo's local
  // contrast. History and scores: benchmarks/sim-calibration/LOG.md.
  // plowSubsteps 4 (from 2026-10-02, after the fit) steps the ball a cell at a
  // time instead of a quarter ball: one step per quarter ball left a 1.25 mm
  // zipper along every groove and a hatch across its walls. Same fit on the
  // five patches (0.381 mm), 0.495 on the photo; renders before it reproduce
  // with --sand='{"plowSubsteps":1}'.
  'dwpro-v3': {
    physical: {table: 700, ball: 10, depth: 2.5},
    sand: {model: 1, plowSize: 2048, plowSubsteps: 4, floorMm: 2.5, bermWidthMm: 5.5, plowCarryMm: 25, plowDump: .2, plowShed: .275, plowRelaxSweeps: 1, reposeSlope: .475, plowEven: .125, plowWake: .15},
    render: {floor: 1, coverMm: 1.4, floorColor: [.12, .09, .09], sandColor: [1.15, 1.035, 1.05], lightMode: 1, ringRadius: 1.02, ringHeightMm: 5, shadowMm: 18, aoStrength: 48, relief: 1.4},
    lights: ['ring', 2.5],
  },
  // dwpro-v3 with sand that accumulates (2026-10-02). Against the physics,
  // dwpro-v3 spread the sand it moved beside each stroke, where the physics
  // carries it to the end of the stroke: caps at hair tips, a rampart round a
  // side-to-side fill (Tuan: "what I don't see in the sim is sand accumulation
  // and it's crucial"). The pile left at a reversal is now a round mound ahead
  // of the ball (plowPileR, plowPileAhead), and mounds from neighbouring turns
  // merge as in the physics. Refitted to the seven physics patches with the
  // piled sand (over 1 mm high) held at least to the physics': 0.368 mm RMS
  // (dwpro-v3 0.444), piled sand 1.04x the physics' (0.79x). Slopes settle at
  // 27 degrees (25). The render is refitted to the photo with tiled scoring and
  // a darker ambient fill (sim-fit --local=4 --band=both), then toned to the
  // photo's brightness range. Still off: the table's ridges are rounded humps
  // with no flat tops, while the sim (and the physics) leave flat sand between
  // lines. Scores: benchmarks/sim-calibration/LOG.md.
  // plan-check runs the table's adaptive clear before the drawing (clear:
  // 'adaptive'): its rings are the background of every table photo.
  'dwpro-v4': {
    physical: {table: 700, ball: 10, depth: 2.5},
    clear: 'adaptive',
    sand: {model: 1, plowSize: 2048, plowSubsteps: 4, floorMm: 2.5, bermWidthMm: 5.5, plowCarryMm: 25, plowDump: .45, plowShed: .275, plowRelaxSweeps: 1, reposeSlope: .5, plowEven: 0, plowWake: .15, plowPileR: 1.8, plowPileAhead: 1.7},
    render: {floor: 1, coverMm: 2, floorColor: [.119, .089, .089], sandColor: [2.369, 2.132, 2.163], lightMode: 1, ringRadius: 1.02, ringHeightMm: 15, shadowMm: 18, aoStrength: 80, relief: 2.6, ambient: .04},
    lights: ['ring', 2.5],
  },
  // dwpro-v4 with ridges between close passes (2026-10-02). The calibration
  // sheet drawn on the table (output/calibration-sheet-20261002, photo
  // IMG_4113) shows what the physics shows: wherever passes run a quarter ball
  // apart they leave ridges between them (a fill's rows, a spiral's rings, the
  // ridge between a line's two passes); dwpro-v4 cleared them into one trough.
  // Two causes: a fit to plain RMSE, which punishes a narrow ridge a millimetre
  // off twice and so chose a 5.5 mm ridge band (wide flat-topped berms); and a
  // wake spread evenly across the groove, filling the hollow between passes.
  // Refitted to the seven physics patches on a tiled RMSE (each 5 mm tile at
  // its best shift within 1 mm) with the ridges held to the physics' and the
  // piled sand at least the physics': berm band 2 mm, the wake weighted to
  // the groove's middle (plowWakeEdge -1), slopes at 29 degrees. Tiled RMSE
  // 0.322 mm (dwpro-v4 0.313), ridges 0.87-1.15x the physics' (dwpro-v4
  // 0.31-0.69x), piled sand 1.05x. Plain RMSE rises to 0.43 mm (0.37): the
  // ridges are where the physics has them, give or take a millimetre. The
  // render: the tiled fit with an ambient fill of 0.04, then a softer tone (sand
  // colour x0.55) and a 0.8 mm floor cover, which match the v17 photo's local
  // contrast (21.8 / 33.6 against 21.4 / 33.7) where the fitted 2 mm cover and
  // bright sand clipped every ridge flat and banded every trough dark; the
  // tiled score is the same (0.544 against 0.547).
  'dwpro-v5': {
    physical: {table: 700, ball: 10, depth: 2.5},
    clear: 'adaptive',
    sand: {model: 1, plowSize: 2048, plowSubsteps: 4, floorMm: 2.5, bermWidthMm: 2, plowCarryMm: 25, plowDump: .45, plowShed: .45, plowRelaxSweeps: 1, reposeSlope: .55, plowEven: 0, plowWake: .1, plowWakeEdge: -1, plowPileR: 2, plowPileAhead: 1.9},
    render: {floor: 1, coverMm: .8, floorColor: [.113, .085, .085], sandColor: [1.323, 1.19, 1.207], lightMode: 1, ringRadius: 1.02, ringHeightMm: 20, shadowMm: 22, aoStrength: 80, relief: 4.4, ambient: .04},
    lights: ['ring', 2.5],
  },
  // dwpro-v5 with turn piles that pour as heaps (2026-10-02). Tuan, on the v17
  // photo against dwpro-v5: "why are the accumulated sand a blurry white blob?
  // it's supposed to override everything like the real photo." The mound was
  // laid on top of the sand: an older slit under it stayed a dip that faded out
  // across the mound, and its paraboloid face (slope ~0.1) never slumped into a
  // toe. Two new physics patches (turn, bury) show the turn pile as a crest
  // pressed against the ball's front with faces at repose, burying the near half
  // of an older slit. plowHeap pours the pile up to such a surface (a crest arc
  // round the turn's apex) and fills what lies under it. Refitted on all nine
  // patches (tiled RMSE + ridges + piled sand): 0.286 mm against 0.312, every
  // patch closer. Render unchanged.
  'dwpro-v6': {
    physical: {table: 700, ball: 10, depth: 2.5},
    clear: 'adaptive',
    sand: {model: 1, plowSize: 2048, plowSubsteps: 4, floorMm: 2.5, bermWidthMm: 2.25, plowCarryMm: 25, plowDump: .5, plowShed: .4, plowRelaxSweeps: 1, reposeSlope: .5, plowEven: 0, plowWake: .1, plowWakeEdge: -1, plowHeap: 1, plowPileArc: 45, plowPileR: .2, plowPileAhead: 1.2},
    render: {floor: 1, coverMm: .8, floorColor: [.113, .085, .085], sandColor: [1.323, 1.19, 1.207], lightMode: 1, ringRadius: 1.02, ringHeightMm: 20, shadowMm: 22, aoStrength: 80, relief: 4.4, ambient: .04},
    lights: ['ring', 2.5],
  },
});

export function tableProfile(name = 'sim-default') {
  const profile = TABLE_PROFILES[name];
  if (!profile) throw new Error(`Unknown table profile ${name}; use ${Object.keys(TABLE_PROFILES).join(' or ')}.`);
  return profile;
}
