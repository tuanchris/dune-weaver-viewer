// The DW sand engine: moved from dune-weaver-sim (src/lib/thr.ts) into sand-weaver on 2026-10-02.
// This is now the source; edit it here (sim/README.md).
/**
 * .thr (theta-rho) pattern parsing.
 *
 * Semantics mirror the Dune Weaver firmware and host software so the sim
 * traces the same path the real table would:
 *   - firmware: FluidNC/src/Kinematics/ThrTranslator.cpp
 *   - host:     modules/core/pattern_manager.py (parse_theta_rho_file)
 *
 * theta is in radians and is *cumulative / unwrapped* (a 5-revolution spiral
 * ends near 31.4, not wrapped into [0, 2pi)). rho is normalized 0..1 as a
 * fraction of the table radius.
 */
const TWO_PI = Math.PI * 2;
/**
 * @typedef {object} ThetaRho
 * @property {number} theta
 * @property {number} rho
 */
/**
 * @typedef {object} ParsedPattern
 * @property {ThetaRho[]} coords
 * @property {number} thetaOffset Whole-revolution offset subtracted from every theta.
 * @property {number} skipped Lines that were present but unparseable.
 */
/**
 * Python's `%` returns a non-negative result for a positive modulus;
 * JavaScript's does not. The firmware and host both rely on the Python
 * behaviour when computing the theta offset, so replicate it exactly —
 * using the native `%` here would mis-rotate every pattern with negative
 * theta (which is most of them).
 */
function pyMod(a, b) {
    return ((a % b) + b) % b;
}
export function parseThr(text) {
    const raw = [];
    let skipped = 0;
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) {
            skipped++;
            continue;
        }
        const theta = Number.parseFloat(parts[0]);
        const rho = Number.parseFloat(parts[1]);
        if (!Number.isFinite(theta) || !Number.isFinite(rho)) {
            skipped++;
            continue;
        }
        // The firmware clamps rho hard; the host does not. Clamp, so a stray
        // out-of-range value can't throw the ball outside the table in the sim.
        raw.push({ theta, rho: Math.min(1, Math.max(0, rho)) });
    }
    const thetaOffset = computeThetaOffset(raw);
    const coords = raw.map(({ theta, rho }) => ({
        theta: theta - thetaOffset,
        rho,
    }));
    return { coords, thetaOffset, skipped };
}
/**
 * Strip leading whole revolutions so the first real coordinate lands in
 * [0, 2pi). A leading `0 0` pair (or two) is a "move to center" preamble that
 * must not be treated as the theta reference — otherwise a pattern that
 * starts at center gets its rotation zeroed out.
 */
function computeThetaOffset(coords) {
    if (coords.length === 0)
        return 0;
    let refIndex = 0;
    while (refIndex < coords.length - 1 &&
        coords[refIndex].theta === 0 &&
        coords[refIndex].rho === 0) {
        refIndex++;
    }
    const ref = coords[refIndex].theta;
    return ref - pyMod(ref, TWO_PI);
}
/**
 * A ball path position in table space, where the table has radius 1.
 *
 * @typedef {object} PathPoint
 * @property {number} x
 * @property {number} y
 */
/**
 * @typedef {object} ResampleOptions
 * @property {number} [maxSagitta] Max allowed deviation between the true polar arc and the straight chord
 *   used to approximate it, in table radii. Smaller = smoother arcs, more
 *   segments.
 * @property {number} [maxStep] Max chord length, in table radii. Bounds work per segment.
 */
/**
 * Expand file coordinates into a dense polyline in table space.
 *
 * Motion between two file coordinates is linear in (theta, rho) — NOT linear
 * in x/y. In Cartesian that traces an Archimedean spiral arc, so a long move
 * interpolated as a straight line would visibly cut the corner. We subdivide
 * in polar space and only then project.
 */
export function resamplePath(coords, opts = {}) {
    const maxSagitta = opts.maxSagitta ?? 0.0015;
    const maxStep = opts.maxStep ?? 0.02;
    if (coords.length === 0)
        return new Float32Array(0);
    const out = [];
    const push = (theta, rho) => {
        out.push(rho * Math.cos(theta), rho * Math.sin(theta));
    };
    push(coords[0].theta, coords[0].rho);
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        const dTheta = b.theta - a.theta;
        const dRho = b.rho - a.rho;
        const rMax = Math.max(a.rho, b.rho);
        // Sagitta of a circular arc of angle t at radius r is ~ r*t^2/8.
        // Solve for the angular step that keeps it under tolerance.
        const stepsForArc = rMax > 1e-6 && Math.abs(dTheta) > 1e-9
            ? Math.abs(dTheta) / Math.sqrt((8 * maxSagitta) / rMax)
            : 0;
        // Also bound raw chord length so fast radial moves stay dense.
        const chord = Math.hypot(rMax * dTheta, dRho);
        const stepsForLength = chord / maxStep;
        const steps = Math.max(1, Math.ceil(Math.max(stepsForArc, stepsForLength)));
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            push(a.theta + dTheta * t, a.rho + dRho * t);
        }
    }
    return new Float32Array(out);
}
