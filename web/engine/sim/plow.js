// The DW sand engine: moved from dune-weaver-sim (src/sim/plow.ts) into sand-weaver on 2026-10-02.
// This is now the source; edit it here (sim/README.md).
/**
 * Plow model: a mass-conserving sand step, run on the CPU.
 *
 * The carve shader (shaders.js) cuts the ball's spherical underside into the
 * heightfield and stacks a thin ridge beside it from material it estimates
 * from a probe; sand is not conserved, and fresh slopes slump only in an
 * occasional full-field pass. Against a photo of a real table (beaver v17 on a
 * DW Pro, 2026-10-01) that produced wide flat valleys and thin sharp ridges
 * where the table drew narrow slits between broad rounded ridges, flat fur
 * where the table organised strokes a quarter ball apart into ridges a ball
 * apart, and beaded lanes where the table drew smooth ones.
 *
 * Here every step of the ball moves sand explicitly:
 *  - the ball plows everything above its underside (and above the tray floor)
 *    into a carried load;
 *  - the load drops into hollows the ball is about to cross, under the front of
 *    the ball, never into the groove beside it (backfill exists only while the
 *    ball carries sand, and dense side-to-side passes leave the floor bare);
 *  - each step a share of the load is shed as ridges just outside the groove,
 *    beside and behind the ball, on the side where it is cutting fresh sand;
 *  - when the ball reverses, a share of the load is dumped as a pile ahead of
 *    its old heading (the bright end piles at turns on the table);
 *  - sand around the ball slumps to the angle of repose, in place, every step,
 *    so a fresh ridge flows back into the groove behind the ball.
 * Total sand is conserved exactly (the load left at the end is dumped ahead).
 *
 * Heights are in world units (table radius = 1) on the simulator's grid:
 * h[row * size + col], world x = (col + .5) / size * 2 - 1, y likewise by row.
 */
/**
 * @typedef {object} PlowParams
 * @property {number} ballR Ball radius, world units.
 * @property {number} depth How deep the ball rides below the nominal surface (world units).
 * @property {number} floor Tray floor below the nominal surface (world units); sand never goes below it.
 * @property {number} ridgeW Width of the band outside the groove where shed sand lands (world units).
 * @property {number} shed Share of the carried load shed as ridges per ball radius of travel, whatever its size.
 * @property {number} carry What the bow wave can push before it spills: the sand plowed from fresh
 *   sand over this much travel (world units). Load beyond it spills as ridges
 *   (half the excess per step), so a short pass carries nearly all it plows to
 *   its turn and dumps it there, and a long stroke reaches a steady ridge.
 * @property {number} fill Share of the carried load available to fill hollows per ball radius of travel.
 * @property {number} dump Share of the load dumped as a pile at a reversal.
 * @property {number} [even] How evenly shed sand splits between the two sides: 0 = all of it where the
 *   ball is cutting fresh sand, 1 = half each side. Sand that also lands on the
 *   side already cut stands between close passes, as the rings of a spiral do.
 * @property {number} [ridgePeak] Where across the band the shed ridge peaks, 0 (at the groove's lip) to 1
 *   (at the band's outer edge). Granular physics peaks it mid-band.
 * @property {number} [wake] Share of the load, per ball radius of travel, that flows back into the
 *   groove just behind the ball: sand pushed aside closing in behind it, which
 *   leaves a single pass a slit narrower than the ball rather than its full
 *   spherical groove.
 * @property {number} [wakeEdge] Where across the groove the wake lands: 0 (default) evenly; above 0 toward the walls, weight
 *   (lateral / half-width)^wakeEdge; below 0 toward the middle, (1 - lateral / half-width)^-wakeEdge.
 *   Evenly spread, the wake filled the hollow between passes a quarter ball apart, and the ridges
 *   the physics and the table leave between them (a fill's rows, a spiral's rings) did not form.
 * @property {number} repose Max sustainable slope (rise over run).
 * @property {number} relaxSweeps Relaxation sweeps over the window round the ball, per step.
 * @property {number} [substeps] Steps per quarter ball radius of travel (default 1). Every step's carve, ridges, wake and slump
 *   leave a seam where the ball stood, so at one step a quarter ball apart the groove's floor and
 *   walls ripple at that period by 10-40 µm, which slope shading turns into a zipper along every
 *   groove and a hatch across its walls. Substeps shorten the step and compound each per-step share
 *   (k substeps shed, fill, spill and slump what one step did); the ridges' and wake's spread along
 *   the path and the turn estimate stay tied to the quarter-radius step. A substep no longer than a
 *   grid cell removes the ripple; the cost grows with the count.
 * @property {number} [pileR] The pile dumped at a reversal as a round mound this many ball radii across (0 or unset: the
 *   crescent round the ball's front), centred `pileAhead` radii ahead of the ball (default 1.7).
 * @property {number} [pileAhead]
 * @property {number} [heap] 1: the pile pours as a heap instead of a mound laid on top. Its crest is an arc `pileAhead` ball
 *   radii from the ball's centre, round its front, `pileArc` degrees either side of the old heading
 *   (0: a point straight ahead), widened by `pileR` ball radii; its faces stand at the angle of repose,
 *   and it is raised until it holds the pile's volume. The sand fills everything below that surface:
 *   an older groove under the pile is buried to the heap's face and ends at its toe. A mound added on
 *   top (heap 0) leaves the groove under it as a dip, shallower but still there, that fades out across
 *   the mound's width, and its paraboloid face, below the repose slope, never slumps into the steep toe
 *   a heap has (granular physics, the `turn` and `bury` patches: a crescent hugging the ball's front
 *   with repose faces). Arcs from neighbouring turns merge into one wall, where cones stacked into
 *   beads. The cells under the ball stay as they are (it holds the groove open while it is there).
 * @property {number} [pileArc]
 */
/**
 * @typedef {object} PlowState
 * @property {number} loadL Carried load, left and right of the path (height x cells).
 * @property {number} loadR
 * @property {number} cutL Where the ball has been cutting lately, left and right (a running average of what it plowed).
 * @property {number} cutR
 * @property {number[]} hx Heading at recent steps, for reversal detection.
 * @property {number[]} hy
 * @property {number[]} hs
 * @property {number[]} px Ball positions at those headings.
 * @property {number[]} py
 * @property {number} s Arc length travelled.
 * @property {number} since Arc length since the last step (steps fall every quarter ball radius along the whole path).
 * @property {boolean} turning Whether the ball is still in a reversal (no second dump until it straightens).
 */
export function newPlowState() {
    return { loadL: 0, loadR: 0, cutL: 0, cutR: 0, hx: [], hy: [], hs: [], px: [], py: [], s: 0, since: 0, turning: false };
}
/**
 * Advance the ball from (ax, ay) to (bx, by). Steps fall every quarter ball radius of arc length
 * (over `substeps`) along the whole path, the remainder carried from segment to segment, so the result does not
 * depend on how the path is cut into segments: with steps fitted to each segment instead, dense
 * vertices took short steps, and the ridges, spill and slump (which act per step) changed with them.
 */
export function plowSegment(h, size, p, st, ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-12)
        return;
    const dx = (bx - ax) / len, dy = (by - ay) / len, ds = 0.25 * p.ballR / substeps(p);
    let t = ds - st.since;
    for (; t <= len; t += ds)
        step(h, size, p, st, ax + dx * t, ay + dy * t, dx, dy, ds);
    st.since = len - (t - ds);
}
/** Finish the last part step to the end of the path, then drop whatever the ball still carries ahead of it. */
export function plowFinish(h, size, p, st, x, y) {
    let n = st.hx.length;
    if (!n)
        return;
    if (st.since > 1e-9) {
        step(h, size, p, st, x, y, st.hx[n - 1], st.hy[n - 1], st.since);
        st.since = 0;
        n = st.hx.length;
    }
    if (pile(h, size, p, x, y, st.loadL + st.loadR, st.hx[n - 1], st.hy[n - 1]))
        st.loadL = st.loadR = 0;
}
const cell = (size) => 2 / size;
// Scratch reused across steps (with substeps a step runs about every grid cell, so allocation shows).
let busyScratch = new Uint8Array(0);
let idxScratch = new Int32Array(0), wtScratch = new Float64Array(0);
/** Scratch for `n` weighted cells. */
function weights(n) {
    if (idxScratch.length < n) {
        idxScratch = new Int32Array(n);
        wtScratch = new Float64Array(n);
    }
}
const substeps = (p) => Math.max(1, Math.round(p.substeps ?? 1));
function step(h, size, p, st, cx, cy, dx, dy, ds) {
    const c = cell(size), R = p.ballR, k = substeps(p), ds0 = 0.25 * R;
    // A share `rate` per ball radius of travel, taken over this step. With substeps it compounds, so
    // the k substeps of a quarter-radius step take exactly what that step took; without, linear.
    const share = (rate) => k > 1 ? 1 - (1 - Math.min(1, rate * ds0 / R)) ** (ds / ds0) : Math.min(1, rate * ds / R);
    // How far along the path the ridges and wake spread (the step itself without substeps).
    const span = k > 1 ? ds0 : ds;
    const under = (r) => Math.max(-p.floor, R - p.depth - Math.sqrt(Math.max(R * R - r * r, 0)));
    // Grid window round the ball.
    const col0 = Math.max(0, Math.floor(((cx - R) + 1) / c)), col1 = Math.min(size - 1, Math.ceil(((cx + R) + 1) / c));
    const row0 = Math.max(0, Math.floor(((cy - R) + 1) / c)), row1 = Math.min(size - 1, Math.ceil(((cy + R) + 1) / c));
    // Reversal: heading now against heading half a ball back (a side-to-side fill turns back through
    // two right angles a quarter ball apart, so a shorter window misses it).
    st.s += ds;
    // Turning radius from the heading change over the last quarter-radius step (k substeps back), for
    // the inner ridge band below. Per substep, a path vertex's whole turn would fall in one short step
    // and read as a turn k times tighter.
    const nh = st.hx.length, back0 = Math.max(0, nh - k);
    const turn = nh ? Math.atan2(st.hx[back0] * dy - st.hy[back0] * dx, st.hx[back0] * dx + st.hy[back0] * dy) : 0;
    st.hx.push(dx);
    st.hy.push(dy);
    st.hs.push(st.s);
    st.px.push(cx);
    st.py.push(cy);
    while (st.hs.length > 2 && st.hs[1] <= st.s - R) {
        st.hx.shift();
        st.hy.shift();
        st.hs.shift();
        st.px.shift();
        st.py.shift();
    }
    const back = st.hx[0] * dx + st.hy[0] * dy;
    if (back < -0.17 && !st.turning) {
        // Dump ahead of the old heading (the one most against the new), where the ball was then.
        let k = 0;
        for (let j = 1; j < st.hx.length; j++)
            if (st.hx[j] * dx + st.hy[j] * dy < st.hx[k] * dx + st.hy[k] * dy)
                k = j;
        const ox = st.hx[k], oy = st.hy[k], load = (st.loadL + st.loadR) * p.dump;
        // A heap stands round the turn's apex, the furthest the ball reached along the old heading; the
        // mound (fitted earlier) is placed from where the ball was on that heading, up to a radius back.
        let ax = st.px[k], ay = st.py[k];
        if ((p.heap ?? 0) > 0)
            for (let j = 0; j < st.px.length; j++)
                if (st.px[j] * ox + st.py[j] * oy > ax * ox + ay * oy) {
                    ax = st.px[j];
                    ay = st.py[j];
                }
        if (pile(h, size, p, ax, ay, load, ox, oy)) {
            st.loadL *= 1 - p.dump;
            st.loadR *= 1 - p.dump;
        }
        st.turning = true;
    }
    else if (back > 0.5)
        st.turning = false;
    // 1. Plow: everything above the ball's underside joins the load, by side;
    //    hollows under the front half take sand from the load.
    const fillBudget = (st.loadL + st.loadR) * share(p.fill);
    let filled = 0, cutL = 0, cutR = 0;
    for (let row = row0; row <= row1; row++) {
        const y = (row + 0.5) * c - 1;
        for (let col = col0; col <= col1; col++) {
            const x = (col + 0.5) * c - 1, rx = x - cx, ry = y - cy, r = Math.hypot(rx, ry);
            if (r >= R)
                continue;
            const i = row * size + col, target = under(r);
            if (h[i] > target) {
                const v = h[i] - target;
                h[i] = target;
                if (dx * ry - dy * rx > 0) {
                    st.loadL += v;
                    cutL += v;
                }
                else {
                    st.loadR += v;
                    cutR += v;
                }
            }
            else if (rx * dx + ry * dy > 0.4 * R && filled < fillBudget) { // only hollows the ball is about to cross, not the groove beside it
                const v = Math.min(target - h[i], fillBudget - filled);
                h[i] += v;
                filled += v;
            }
        }
    }
    if (filled > 0) {
        const tot = st.loadL + st.loadR, fl = st.loadL / tot;
        st.loadL -= filled * fl;
        st.loadR -= filled * (1 - fl);
    }
    // 2. Shed: a share of the load lands just outside the groove, beside and behind the ball, on
    //    the side where it is cutting fresh sand now. Which side the load was picked up on does not
    //    say where it goes: after a reversal left and right swap, and the sand then landed in the
    //    groove just cleared.
    const decay = share(1);
    st.cutL += (cutL - st.cutL) * decay;
    st.cutR += (cutR - st.cutR) * decay;
    const surf = Math.sqrt(Math.max(R * R - (R - p.depth) ** 2, 0)) * 0.95;
    // Sand plowed per unit of travel through fresh sand (height x cells per world unit).
    let fresh = 0;
    for (let r = -surf; r < surf; r += c)
        fresh += -Math.max(-p.floor, R - p.depth - Math.sqrt(Math.max(R * R - r * r, 0))) / c;
    const load = st.loadL + st.loadR, cap = fresh * p.carry;
    const shedTotal = Math.min(load, load * share(p.shed) + Math.max(0, load - cap) * (k > 1 ? 1 - 0.5 ** (ds / ds0) : 0.5));
    let toLeft = (st.cutL + st.cutR > 0 ? st.cutL / (st.cutL + st.cutR) : 0.5) * (1 - (p.even ?? 0)) + 0.5 * (p.even ?? 0);
    // On a tight turn the inner band would reach past the turn's centre, and every step's share would
    // pile up there (a heap in the middle of a spiral): the inner band stops at the turning radius,
    // and when the turn is tighter than the groove itself that side's share goes to the outside.
    const rho = Math.abs(turn) > 1e-9 ? span / Math.abs(turn) : Infinity, inner = turn > 0 ? 1 : -1;
    if (rho <= surf)
        toLeft = inner > 0 ? 0 : 1;
    st.loadL = st.loadR = load / 2;
    for (const side of [1, -1]) {
        const amount = shedTotal * (side > 0 ? toLeft : 1 - toLeft);
        if (!(amount > 0))
            continue;
        // A band beside the stretch just travelled, [surf, surf + W] out from the path, weighted along
        // the path by a Hann window centred on the step, three steps (at least three cells) either side:
        // the windows of consecutive steps sum to the same weight everywhere along a straight run, and
        // still overlap smoothly on the outside of a turn, where they spread further apart. Landing
        // round the ball as it stands instead put a bead every step (beaded lanes, radial beads round a
        // spiral); square strips striped the teeth wherever a strip caught one cell more or less; a
        // triangle two steps wide still hatched the outside of curves.
        const W = side === inner ? Math.max(c, Math.min(p.ridgeW, rho - surf)) : p.ridgeW, half = 3 * Math.max(span, c), mid = -span / 2;
        // Scan only the band's own bounding box (its four corners in the ball's frame).
        let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
        for (const lat of [surf * side, (surf + W) * side])
            for (const al of [mid - half, mid + half]) {
                const x = cx + al * dx - lat * dy, y = cy + al * dy + lat * dx;
                bx0 = Math.min(bx0, x);
                bx1 = Math.max(bx1, x);
                by0 = Math.min(by0, y);
                by1 = Math.max(by1, y);
            }
        const c0 = Math.max(0, Math.floor((bx0 + 1) / c) - 1), c1 = Math.min(size - 1, Math.ceil((bx1 + 1) / c) + 1);
        const r0 = Math.max(0, Math.floor((by0 + 1) / c) - 1), r1 = Math.min(size - 1, Math.ceil((by1 + 1) / c) + 1);
        let wsum = 0, m = 0;
        weights((r1 - r0 + 1) * (c1 - c0 + 1));
        const idx = idxScratch, wts = wtScratch;
        for (let row = r0; row <= r1; row++) {
            const y = (row + 0.5) * c - 1;
            for (let col = c0; col <= c1; col++) {
                const x = (col + 0.5) * c - 1, rx = x - cx, ry = y - cy;
                const lateral = (dx * ry - dy * rx) * side, along = Math.abs(rx * dx + ry * dy - mid);
                if (lateral < surf || lateral > surf + W || along >= half)
                    continue;
                const t = (lateral - surf) / W, w = ridgeProfile(t, p.ridgePeak ?? 0) * Math.cos(Math.PI / 2 * along / half) ** 2;
                idx[m] = row * size + col;
                wts[m++] = w;
                wsum += w;
            }
        }
        if (wsum <= 0)
            continue;
        for (let j = 0; j < m; j++)
            h[idx[j]] += amount * wts[j] / wsum;
        st.loadL -= amount / 2;
        st.loadR -= amount / 2;
    }
    // 2b. Wake: sand closing in behind the ball, across the groove it has just cut, on the same
    //     triangle along the path as the ridges (centred just behind the ball's footprint).
    if ((p.wake ?? 0) > 0) {
        const load = st.loadL + st.loadR, amount = load * share(p.wake ?? 0);
        if (amount > 0) {
            const half = 3 * Math.max(span, c), mid = -R - span / 2, reach = R + half + span, edge = p.wakeEdge ?? 0;
            const c0 = Math.max(0, Math.floor((cx - reach + 1) / c)), c1 = Math.min(size - 1, Math.ceil((cx + reach + 1) / c));
            const r0 = Math.max(0, Math.floor((cy - reach + 1) / c)), r1 = Math.min(size - 1, Math.ceil((cy + reach + 1) / c));
            let wsum = 0, m = 0;
            weights((r1 - r0 + 1) * (c1 - c0 + 1));
            const idx = idxScratch, wts = wtScratch;
            for (let row = r0; row <= r1; row++) {
                const y = (row + 0.5) * c - 1;
                for (let col = c0; col <= c1; col++) {
                    const x = (col + 0.5) * c - 1, rx = x - cx, ry = y - cy;
                    const lateral = Math.abs(dx * ry - dy * rx), along = Math.abs(rx * dx + ry * dy - mid);
                    if (lateral >= surf || along >= half || rx * rx + ry * ry < R * R)
                        continue;
                    const t = lateral / surf, w = Math.cos(Math.PI / 2 * along / half) ** 2 * (edge > 0 ? t ** edge : edge < 0 ? (1 - t) ** -edge : 1);
                    idx[m] = row * size + col;
                    wts[m++] = w;
                    wsum += w;
                }
            }
            if (wsum > 0) {
                for (let j = 0; j < m; j++)
                    h[idx[j]] += amount * wts[j] / wsum;
                st.loadL -= amount / 2;
                st.loadR -= amount / 2;
            }
        }
    }
    // 3. Slump: relax the window round the ball to the angle of repose, leaving the
    //    cells the ball occupies alone (it holds the groove open while it is there).
    relax(h, size, p, cx, cy, 1.6 * R + p.ridgeW, k > 1 ? ds / ds0 : 1);
}
/** Weight across the ridge band (t = 0 at the groove's lip, 1 at its outer edge), peaking at `peak`. */
function ridgeProfile(t, peak) {
    if (!(peak > 0))
        return (1 - t) * (1 - t);
    return t < peak ? t / peak : (1 - t) / (1 - peak);
}
/**
 * The load dumped at a reversal, ahead of the ball as it stood on its old heading (ox, oy).
 *
 * With `pileR`, a round mound `pileR` ball radii across, centred `pileAhead` radii ahead: the
 * bow wave the ball was pushing, left where it turned. Mounds from neighbouring turns merge, as
 * in the physics, into the caps at the tips of hair strokes and the rampart that frames a
 * side-to-side fill. Without it, a crescent wrapped round the front of the ball from just inside
 * its rim outward, thickest straight ahead: the turns of a fill stood as separate ribs.
 */
/** Returns whether the volume landed (it doesn't when the pile falls off the grid). */
function pile(h, size, p, x, y, volume, ox = 0, oy = 0) {
    if (!(volume > 0))
        return false;
    const hasDir = ox !== 0 || oy !== 0;
    if (hasDir && (p.heap ?? 0) > 0)
        return heap(h, size, p, x, y, ox, oy, volume);
    const mound = hasDir && (p.pileR ?? 0) > 0;
    const c = cell(size), r0 = 0.7 * p.ballR, r1 = r0 + Math.max(p.ridgeW, 0.6 * p.ballR);
    // The mound's centre and radius; the crescent scans round the ball.
    const rm = mound ? (p.pileR ?? 0) * p.ballR : r1, ahead0 = mound ? (p.pileAhead ?? 1.7) * p.ballR : 0;
    const mx = x + ox * ahead0, my = y + oy * ahead0;
    const c0 = Math.max(0, Math.floor((mx - rm + 1) / c)), c1 = Math.min(size - 1, Math.ceil((mx + rm + 1) / c));
    const q0 = Math.max(0, Math.floor((my - rm + 1) / c)), q1 = Math.min(size - 1, Math.ceil((my + rm + 1) / c));
    const weight = (col, row) => {
        if (mound) {
            const d2 = (((col + 0.5) * c - 1 - mx) ** 2 + ((row + 0.5) * c - 1 - my) ** 2) / (rm * rm);
            return d2 < 1 ? 1 - d2 : 0;
        }
        const rx = (col + 0.5) * c - 1 - x, ry = (row + 0.5) * c - 1 - y, r = Math.hypot(rx, ry);
        if (r > r1)
            return 0;
        if (!hasDir)
            return 1 - r / r1;
        if (r < r0)
            return 0;
        const ahead = (rx * ox + ry * oy) / r;
        if (ahead <= 0)
            return 0;
        const t = (r - r0) / (r1 - r0);
        return ahead * (1 - t) * (1 - t);
    };
    let wsum = 0;
    for (let row = q0; row <= q1; row++)
        for (let col = c0; col <= c1; col++)
            wsum += weight(col, row);
    if (wsum <= 0)
        return false;
    for (let row = q0; row <= q1; row++)
        for (let col = c0; col <= c1; col++) {
            const w = weight(col, row);
            if (w > 0)
                h[row * size + col] += volume * w / wsum;
        }
    return true;
}
let heapA = new Float64Array(0), heapI = new Int32Array(0);
/**
 * Pour `volume` as a heap round the front of the ball at (bx, by), heading (ox, oy): the surface
 * top - repose * (distance from the crest - pileR) wherever it stands above the sand, `top` set so
 * the sand added is exactly `volume` (see PlowParams.heap). Cells under the ball are left alone. The
 * heap reaches at most 4 ball radii past its crest.
 */
function heap(h, size, p, bx, by, ox, oy, volume) {
    const c = cell(size), R = p.ballR, s = p.repose, ra = (p.pileAhead ?? 1.7) * R, core = (p.pileR ?? 0) * R;
    const phi = Math.min(Math.PI, Math.max(0, (p.pileArc ?? 0) * Math.PI / 180)), ex = ra * Math.cos(phi), ey = ra * Math.sin(phi);
    const reach = ra + core + 4 * R, busy2 = (0.9 * R) ** 2;
    const c0 = Math.max(0, Math.floor((bx - reach + 1) / c)), c1 = Math.min(size - 1, Math.ceil((bx + reach + 1) / c));
    const r0 = Math.max(0, Math.floor((by - reach + 1) / c)), r1 = Math.min(size - 1, Math.ceil((by + reach + 1) / c));
    const n = (r1 - r0 + 1) * (c1 - c0 + 1);
    if (heapA.length < n) {
        heapA = new Float64Array(n);
        heapI = new Int32Array(n);
    }
    // a = the level the heap's surface must reach before it adds sand to a cell.
    let m = 0;
    for (let row = r0; row <= r1; row++) {
        const y = (row + 0.5) * c - 1 - by;
        for (let col = c0; col <= c1; col++) {
            const x = (col + 0.5) * c - 1 - bx, r2 = x * x + y * y;
            if (r2 < busy2)
                continue;
            // Distance to the crest: radial within the arc's span, else to its nearer end.
            const ahead = x * ox + y * oy, lat = Math.abs(ox * y - oy * x), r = Math.sqrt(r2);
            const d = Math.atan2(lat, ahead) <= phi ? Math.abs(r - ra) : Math.hypot(ahead - ex, lat - ey);
            if (d > core + 4 * R)
                continue;
            const i = row * size + col;
            heapI[m] = i;
            heapA[m++] = h[i] + s * Math.max(0, d - core);
        }
    }
    if (!m)
        return false;
    // Fill from the lowest: with the k lowest levels under `top`, k * top - their sum = volume.
    const sorted = heapA.slice(0, m).sort();
    let sum = 0, top = sorted[0];
    for (let k = 0; k < m; k++) {
        sum += sorted[k];
        top = (volume + sum) / (k + 1);
        if (k + 1 === m || top <= sorted[k + 1])
            break;
    }
    for (let j = 0; j < m; j++) {
        const v = top - heapA[j];
        if (v > 0)
            h[heapI[j]] += v;
    }
    return true;
}
/**
 * Slump to the angle of repose. Each cell exchanges with its eight neighbours,
 * diagonals held to the same slope over their longer run: with the four axis
 * neighbours alone a pile settles into a diamond, steeper along the diagonals.
 */
function relax(h, size, p, cx, cy, reach, rate = 1) {
    if (!(p.relaxSweeps > 0))
        return;
    const c = cell(size), maxDrop = p.repose * c, maxDiag = maxDrop * Math.SQRT2, R2 = (p.ballR * 0.9) ** 2, floor = -p.floor;
    const c0 = Math.max(1, Math.floor((cx - reach + 1) / c)), c1 = Math.min(size - 2, Math.ceil((cx + reach + 1) / c));
    const r0 = Math.max(1, Math.floor((cy - reach + 1) / c)), r1 = Math.min(size - 2, Math.ceil((cy + reach + 1) / c));
    // Cells under the ball, with a one-cell free border so neighbour lookups need no bounds checks
    // (outside the window counts as free). The cell (row, col) is busy[base(row) + col].
    const w = c1 - c0 + 3, n = w * (r1 - r0 + 3);
    if (busyScratch.length < n)
        busyScratch = new Uint8Array(n);
    const busy = busyScratch;
    busy.fill(0, 0, n);
    for (let row = r0; row <= r1; row++) {
        const y = (row + 0.5) * c - 1 - cy, yy = y * y, base = (row - r0 + 1) * w - c0 + 1;
        for (let col = c0; col <= c1; col++) {
            const x = (col + 0.5) * c - 1 - cx;
            if (x * x + yy < R2)
                busy[base + col] = 1;
        }
    }
    for (let sweep = 0; sweep < p.relaxSweeps; sweep++) {
        // Alternate the sweep direction so the flow has no preferred axis. Each cell
        // exchanges with its right, upper and two upper diagonal neighbours, so every
        // pair is visited once.
        const fwd = sweep % 2 === 0;
        for (let rr = r0; rr <= r1; rr++) {
            const row = fwd ? rr : r1 - (rr - r0), base = (row - r0 + 1) * w - c0 + 1;
            for (let cc = c0; cc <= c1; cc++) {
                const col = fwd ? cc : c1 - (cc - c0), b = base + col;
                if (busy[b])
                    continue;
                const i = row * size + col;
                if (!busy[b + 1])
                    exchange(h, i, i + 1, maxDrop, rate, floor);
                if (!busy[b + w])
                    exchange(h, i, i + size, maxDrop, rate, floor);
                if (!busy[b + w + 1])
                    exchange(h, i, i + size + 1, maxDiag, rate, floor);
                if (!busy[b + w - 1])
                    exchange(h, i, i + size - 1, maxDiag, rate, floor);
            }
        }
    }
}
/** Move sand between cells i and j down to the slope `limit`, never digging below the floor. */
function exchange(h, i, j, limit, rate, floor) {
    const diff = h[i] - h[j];
    if (diff > limit) {
        const v = Math.min((diff - limit) / 2 * rate, h[i] - floor);
        if (v > 0) {
            h[i] -= v;
            h[j] += v;
        }
    }
    else if (-diff > limit) {
        const v = Math.min((-diff - limit) / 2 * rate, h[j] - floor);
        if (v > 0) {
            h[j] -= v;
            h[i] += v;
        }
    }
}
