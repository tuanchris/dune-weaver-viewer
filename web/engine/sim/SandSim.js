// The DW sand engine: moved from dune-weaver-sim (src/sim/SandSim.ts) into sand-weaver on 2026-10-02.
// This is now the source; edit it here (sim/README.md).
/**
 * WebGL2 sand-table simulator.
 *
 * The sand bed is a floating-point heightfield held in a ping-pong pair of
 * R32F textures. World space and clip space are the same thing here — the
 * table is the unit disc — which lets a carve pass draw a small quad covering
 * only the segments it touches instead of shading the whole field every step.
 */
import { CARVE_FRAG, MAX_SEGMENTS, QUAD_VERT, RELAX_FRAG, RENDER_FRAG, RESET_FRAG, withDefine, } from './shaders.js';
import { plowSegment, plowFinish, newPlowState } from './plow.js';
/**
 * Physical dimensions are in millimetres. Nothing in the firmware or host repos
 * records a real table radius or ball diameter — everything there is normalised
 * or in motor space — so these are the user's to supply. Internally they are
 * divided by the table radius to give the normalised world units the shaders
 * work in, which means only the *ratio* of ball to table actually affects the
 * result.
 *
 * @typedef {object} SandParams
 * @property {number} tableDiameterMm Table diameter, mm.
 * @property {number} ballDiameterMm Ball diameter, mm.
 * @property {number} depthMm How deep the ball rides below the nominal sand surface, mm.
 * @property {number} bermWidthMm Width of the ridge thrown up alongside the groove, mm.
 * @property {number} bermGain Share of displaced material that ends up in the ridge.
 * @property {number} fill How much of an older, deeper groove the ball backfills as it crosses it,
 *   per pass. 0 means grooves are permanent and nothing can ever be erased.
 * @property {number} bowWaveMm Backfill needs loose sand to drop, and a ball running back beside the
 *   groove it cut a moment ago has none: it dumped its bow wave at the turn
 *   (beaver v13's teeth drew bright frames of end piles) and the sand between
 *   the two passes is already gone. Where the ball runs within half a ball of
 *   its own path from the last `bowWaveMm` of travel (not counting the last
 *   three quarters of a ball, its own wake), it backfills nothing, so dense side-to-side
 *   passes leave the bare floor, as the teeth of beaver v17 did on the table.
 *   A spiral's previous ring, a lap back, and an earlier row of strokes are
 *   refilled as before. 0 = off: backfill is the same everywhere.
 * @property {number} scrapeMm Sand thinner than this, mm, over the depth the ball rides at is swept away
 *   wherever the ball itself runs that deep beside it: the slivers between
 *   passes a quarter ball apart cannot stand on the tray floor. 0 = off.
 * @property {number} reposeSlope Max neighbour-to-neighbour slope the sand can hold.
 * @property {number} relaxEverySegments Path segments between angle-of-repose passes, and relaxation iterations
 *   per pass. Each iteration moves sand about one heightfield texel, so a few
 *   iterations every few dozen segments let a fresh ridge slump back into the
 *   groove behind the ball, as on the table: beaver v17 drew narrow slits
 *   between broad rounded ridges where the default (one iteration every 512
 *   segments) keeps steep walls, wide flat grooves and thin sharp ridges.
 * @property {number} relaxIterations
 * @property {number} model 0 = carve (the GPU carve shader, the default). 1 = plow (plow.js): sand
 *   conserved, carried by the ball, shed as ridges, dumped at reversals and
 *   slumped to `reposeSlope` round the ball every step. The plow settings
 *   below apply only to it; ridge width is `bermWidthMm`, the tray floor is
 *   `floorMm` below the surface (0 = no floor).
 * @property {number} plowShed Share of the carried load shed as ridges per ball radius of travel, whatever its size.
 * @property {number} plowCarryMm What the bow wave holds before it spills as ridges: the sand plowed over this much travel, mm.
 * @property {number} plowFill Share of the carried load that may fill hollows ahead, per ball radius of travel.
 * @property {number} plowDump Share of the carried load dumped as a pile at a reversal.
 * @property {number} plowEven How evenly shed sand splits between the sides: 0 = all where the ball cuts fresh sand, 1 = half each.
 * @property {number} plowRidgePeak Where across its band the shed ridge peaks: 0 = at the groove's lip, 1 = at the band's outer edge.
 * @property {number} plowWake Share of the load per ball radius that flows back into the groove just behind the ball.
 * @property {number} plowWakeEdge Where across the groove the wake lands (plow.js `wakeEdge`): 0 evenly, above 0 toward the walls, below 0 toward the middle.
 * @property {number} plowRelaxSweeps Relaxation sweeps round the ball per step.
 * @property {number} plowSubsteps Steps per quarter ball radius (plow.js `substeps`): 1 steps a quarter ball at a time and leaves
 *   a ripple at that period along every groove; 4 brings a 10 mm ball's step under a cell at 2048.
 * @property {number} plowPileR The pile left at a reversal (plow.js `pileR`, `pileAhead`): 0 = a crescent round the ball's
 *   front; above 0, a round mound that many ball radii across, centred `plowPileAhead` radii ahead.
 *   Mounds merge into the caps at stroke tips and the rampart round a fill, as the physics shows.
 * @property {number} plowPileAhead
 * @property {number} plowHeap 1: the pile pours as a heap (plow.js `heap`) that fills and buries what lies under it: faces at
 *   the angle of repose from a crest on an arc `plowPileAhead` ball radii round the ball's front,
 *   `plowPileArc` degrees either side of its heading, `plowPileR` radii wide. 0: the mound or
 *   crescent above, laid on top of the sand.
 * @property {number} plowPileArc
 * @property {number} plowSize Plow grid resolution (cells across the table); its heights are upsampled to the render grid.
 * @property {number} floorMm Tray floor below the nominal surface, mm (0 = deep sand). The ball rides at `depthMm`.
 * @property {number} grain Surface grain amplitude.
 */
/**
 * @typedef {object} RenderParams
 * @property {number} relief
 * @property {number} lightAzimuth
 * @property {number} lightElevation
 * @property {[number, number, number]} sandColor
 * @property {number} aoStrength
 * @property {number} lightMode 0 = one raking key light (`lightAzimuth`, `lightElevation`). 1 = the
 *   table's own LED ring: lights around the rim at `ringRadius` table radii and
 *   `ringHeightMm` above the sand, each shadowed by marching the heightfield
 *   `shadowMm` toward it.
 * @property {number} ringRadius
 * @property {number} ringHeightMm
 * @property {number} shadowMm
 * @property {number} ambient Ambient fill in ring mode: light bounced into shadow, relative to the key.
 *   0.28 is the raking light's; a table in a dark room has less, and its slits
 *   read darker. The raking light ignores it.
 * @property {number} floor 1 = the sand is a thin layer over a dark tray floor at the groove depth
 *   (`depthMm`, the ball riding on the floor). Sand thinner than `coverMm`
 *   shows the floor through, tinted `floorColor`.
 * @property {number} coverMm
 * @property {[number, number, number]} floorColor
 */
/**
 * Tuned by eye against photographs of a real table rather than derived: a
 * narrow, sharply defined ridge with a lot of material thrown up, and low
 * backfill so a pattern drawn over another only partly erases it.
 */
export const DEFAULT_SAND = {
    tableDiameterMm: 700,
    ballDiameterMm: 10,
    depthMm: 3.2,
    bermWidthMm: 0.5,
    bermGain: 1.06,
    fill: 0.21,
    bowWaveMm: 0,
    scrapeMm: 0,
    reposeSlope: 0.7,
    relaxEverySegments: 512,
    relaxIterations: 1,
    model: 0,
    plowShed: 0,
    plowCarryMm: 30,
    plowFill: 0,
    plowDump: 1,
    plowEven: 0,
    plowRidgePeak: 0,
    plowWake: 0,
    plowWakeEdge: 0,
    plowRelaxSweeps: 2,
    plowSubsteps: 1,
    plowPileR: 0,
    plowPileAhead: 1.7,
    plowHeap: 0,
    plowPileArc: 0,
    plowSize: 1024,
    floorMm: 0,
    grain: 0.0012,
};
export const DEFAULT_RENDER = {
    relief: 2.6,
    lightAzimuth: 2.5,
    lightElevation: 0.34,
    sandColor: [0.88, 0.79, 0.63],
    aoStrength: 16,
    lightMode: 0,
    ringRadius: 1.02,
    ringHeightMm: 15,
    shadowMm: 14,
    ambient: 0.28,
    floor: 0,
    coverMm: 0.6,
    floorColor: [0.1, 0.1, 0.14],
};
function compile(gl, type, src) {
    const sh = gl.createShader(type);
    if (!sh)
        throw new Error('createShader failed');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`Shader compile failed: ${log}`);
    }
    return sh;
}
function link(gl, vertSrc, fragSrc) {
    const prog = gl.createProgram();
    if (!prog)
        throw new Error('createProgram failed');
    const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error(`Program link failed: ${log}`);
    }
    return prog;
}
/**
 * How many path segments to carve between angle-of-repose passes. Keyed to
 * segments, not carve passes, so the result is independent of how the work was
 * batched — playing a pattern through and skipping to the end must agree.
 */
const RELAX_EVERY_SEGMENTS = 512;
/**
 * Ambient-occlusion sampling radius, in uv units (1.0 = the table diameter).
 *
 * Fixed in table space rather than texels so the shading is identical at every
 * heightfield resolution — the value is the 7-texel radius the look was tuned
 * at, expressed against the 1024² field it was tuned on.
 */
const AO_RADIUS_UV = 7 / 1024;
/**
 * @typedef {object} Target
 * @property {WebGLTexture} tex
 * @property {WebGLFramebuffer} fbo
 */
/**
 * For every point of a flat x,y path: 0 where the path runs within `near` of
 * itself from between `gap` and `window` of travel earlier, 1 where it is
 * clear by `far`, smoothstepped between (all world units).
 */
export function selfOverlap(path, scale, window, gap, near, far) {
    const n = path.length / 2, out = new Float32Array(n), s = new Float64Array(n);
    for (let i = 1; i < n; i++)
        s[i] = s[i - 1] + Math.hypot(path[i * 2] - path[i * 2 - 2], path[i * 2 + 1] - path[i * 2 - 1]) * scale;
    let lo = 0, hi = 0;
    for (let i = 0; i < n; i++) {
        while (lo < i && s[lo] < s[i] - window)
            lo++;
        while (hi < i && s[hi + 1] <= s[i] - gap)
            hi++;
        let best = Infinity;
        const x = path[i * 2] * scale, y = path[i * 2 + 1] * scale;
        if (s[hi] <= s[i] - gap)
            for (let j = lo; j <= hi; j++)
                best = Math.min(best, Math.hypot(path[j * 2] * scale - x, path[j * 2 + 1] * scale - y));
        const t = Math.min(1, Math.max(0, (best - near) / (far - near)));
        out[i] = t * t * (3 - 2 * t);
    }
    return out;
}
export class SandSim {
    gl;
    size;
    front;
    back;
    /** Sand as it stood before the current pattern began. */
    base;
    vao;
    progCarve;
    progRelax;
    progReset;
    progRender;
    /**
     * `RENDER_FRAG` compiled with optional features (`RING`, `FLOOR`), built on
     * first use. The default render stays `progRender`, compiled from exactly
     * the code it always had, so turning features off is bit-identical.
     */
    renderVariants = new Map();
    segBuf = new Float32Array(MAX_SEGMENTS * 4);
    /** Share of backfill at each path point (see `bowWaveMm`). */
    fillShare = null;
    /** Plow model state (model = 1): its own heightfield at plowSize, and the ball's load. */
    plowH = null;
    plowState = newPlowState();
    runKey = '';
    /** Dense path in table space, as flat x,y pairs. */
    path = new Float32Array(0);
    /** Index of the next path *point* to consume. */
    cursor = 0;
    /**
     * How many whole relaxation intervals have been run.
     *
     * Scheduled against segments consumed rather than carve passes issued: a
     * frame during slow playback may carve only a couple of segments while
     * `runToEnd` carves 64 at a time, so counting passes would relax a played-out
     * pattern far more than a skipped one and give two different results for the
     * same pattern.
     */
    relaxedIntervals = 0;
    /**
     * Segment budget carried over between `advance` calls.
     *
     * Carving always happens in whole chunks aligned to fixed multiples of
     * MAX_SEGMENTS. The carve reads the height texture, so every segment in a
     * chunk sees the same starting state while a later chunk sees the earlier
     * one's result — meaning the chunk decomposition is part of the physics.
     * Holding a fractional budget here keeps that decomposition identical whether
     * a frame asks for two segments or `runToEnd` asks for thousands.
     */
    pending = 0;
    /** Texel rectangle written by the pass in flight, folded back in endPass. */
    passRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
    /**
     * Uniform locations, cached per program. `getUniformLocation` does a string
     * lookup into the linked program; at roughly a dozen uniforms per carve pass
     * and thousands of passes per pattern, resolving them every time costs more
     * than the drawing does.
     */
    uniformCache = new Map();
    sand = { ...DEFAULT_SAND };
    render = { ...DEFAULT_RENDER };
    constructor(canvas, size = 1024) {
        const gl = canvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true,
        });
        if (!gl)
            throw new Error('WebGL2 is not available in this browser.');
        // Rendering *into* a float texture is an extension even in WebGL2.
        if (!gl.getExtension('EXT_color_buffer_float')) {
            throw new Error('EXT_color_buffer_float is unavailable; cannot run the sand sim.');
        }
        gl.getExtension('OES_texture_float_linear');
        this.gl = gl;
        this.size = size;
        this.front = this.makeTarget();
        this.back = this.makeTarget();
        this.base = this.makeTarget();
        this.progCarve = link(gl, QUAD_VERT, CARVE_FRAG);
        this.progRelax = link(gl, QUAD_VERT, RELAX_FRAG);
        this.progReset = link(gl, QUAD_VERT, RESET_FRAG);
        this.progRender = link(gl, QUAD_VERT, RENDER_FRAG);
        const vao = gl.createVertexArray();
        if (!vao)
            throw new Error('createVertexArray failed');
        this.vao = vao;
        gl.bindVertexArray(vao);
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        this.reset();
        // Seed the base snapshot so a re-simulate before any pattern loads restores
        // flat sand rather than the undefined contents of a fresh texture.
        this.blit(this.front, this.base);
    }
    loc(prog, name) {
        let byName = this.uniformCache.get(prog);
        if (!byName) {
            byName = new Map();
            this.uniformCache.set(prog, byName);
        }
        if (!byName.has(name))
            byName.set(name, this.gl.getUniformLocation(prog, name));
        return byName.get(name) ?? null;
    }
    makeTarget() {
        const gl = this.gl;
        const tex = gl.createTexture();
        if (!tex)
            throw new Error('createTexture failed');
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, this.size, this.size);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        if (!fbo)
            throw new Error('createFramebuffer failed');
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`Heightfield framebuffer incomplete (0x${status.toString(16)})`);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo };
    }
    /**
     * World-space bounds → texel rectangle, rounded outward and clamped.
     *
     * The quad is then snapped to exactly this rectangle, so the pixels the draw
     * covers and the pixels copied back are the same set. They must not diverge:
     * copying a pixel the draw did not write hands the authoritative texture
     * whatever the scratch texture happened to hold from an earlier, unrelated
     * chunk.
     */
    boundsToRect(b) {
        const toPx = (v) => (v * 0.5 + 0.5) * this.size;
        const x0 = Math.max(0, Math.floor(toPx(b[0])));
        const y0 = Math.max(0, Math.floor(toPx(b[1])));
        const x1 = Math.min(this.size, Math.ceil(toPx(b[2])));
        const y1 = Math.min(this.size, Math.ceil(toPx(b[3])));
        return { x0, y0, x1, y1 };
    }
    /** Texel rectangle → the world-space quad that covers exactly those texels. */
    rectToBounds(r) {
        const toWorld = (px) => (px / this.size) * 2 - 1;
        return [toWorld(r.x0), toWorld(r.y0), toWorld(r.x1), toWorld(r.y1)];
    }
    // --- unit conversion -----------------------------------------------------
    // World units: the table is the unit disc, so 1.0 = the table radius.
    /** World units per millimetre. */
    get worldPerMm() {
        return 2 / Math.max(this.sand.tableDiameterMm, 1e-6);
    }
    get ballRadiusWorld() {
        return (this.sand.ballDiameterMm / 2) * this.worldPerMm;
    }
    /**
     * A ball cannot sit deeper than its own radius without its widest point
     * going under the sand, which the spherical-cap profile doesn't model, so
     * clamp rather than produce a surface that turns inside out.
     */
    get depthWorld() {
        return Math.min(this.sand.depthMm * this.worldPerMm, this.ballRadiusWorld);
    }
    /**
     * Scale applied to path coordinates.
     *
     * rho = 1 puts the ball at its outermost position, which is where it touches
     * the table wall — so the ball *centre* reaches only one ball radius short of
     * the wall, not the wall itself. Without this the outermost passes (and every
     * turn in a sideways clear, which all happen at rho > 0.99) would sit exactly
     * on the rim and be lost under the edge treatment.
     */
    /** Public view of the path scaling, for drawing diagnostics in table space. */
    get coordinateScale() {
        return this.pathScale;
    }
    get pathScale() {
        return 1 - this.ballRadiusWorld;
    }
    get bermWidthWorld() {
        return this.sand.bermWidthMm * this.worldPerMm;
    }
    blit(src, dst) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
        gl.blitFramebuffer(0, 0, this.size, this.size, 0, 0, this.size, this.size, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    /** Bind `back` as scratch draw target, reading from the authoritative `front`. */
    beginPass(prog, bounds) {
        const gl = this.gl;
        // Snap the quad to whole texels so the drawn set and the copied-back set
        // are identical.
        this.passRect = this.boundsToRect(bounds);
        const snapped = this.rectToBounds(this.passRect);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.back.fbo);
        gl.viewport(0, 0, this.size, this.size);
        gl.useProgram(prog);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.front.tex);
        gl.uniform1i(this.loc(prog, 'uHeight'), 0);
        gl.uniform4f(this.loc(prog, 'uBounds'), ...snapped);
    }
    /**
     * Draw the pass, then fold just the affected rectangle back into `front`.
     *
     * `front` stays authoritative at all times and `back` is pure scratch, so a
     * pass that touches a small area costs a small copy instead of a whole-field
     * one. Ping-ponging instead would mean seeding the destination with the
     * entire field before every pass — otherwise pixels outside the drawn quad
     * would still hold state from two swaps ago and silently resurrect old sand.
     */
    endPass() {
        const gl = this.gl;
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const { x0, y0, x1, y1 } = this.passRect;
        if (x1 <= x0 || y1 <= y0)
            return;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.back.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.front.fbo);
        gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    /** Flat sand. Clears any pattern progress. */
    reset() {
        const gl = this.gl;
        this.cursor = 0;
        this.relaxedIntervals = 0;
        this.plowH = null;
        this.pending = 0;
        this.beginPass(this.progReset, [-1, -1, 1, 1]);
        gl.uniform1f(this.loc(this.progReset, 'uGrain'), this.sand.grain);
        gl.uniform1f(this.loc(this.progReset, 'uSize'), this.size);
        this.endPass();
    }
    /**
     * Flatten the table and forget the loaded pattern.
     *
     * Distinct from the `clear_*.thr` patterns, which are real ball paths that
     * sweep the sand flat and leave their own tracks behind. This is the sand bed
     * being levelled by hand: no path, no tracks.
     *
     * `reset` alone would leave `base` holding the old sand, so the next Replay or
     * parameter drag — both of which rewind to `base` — would quietly bring back
     * what was just cleared.
     */
    clearSand() {
        this.reset();
        this.path = new Float32Array(0);
        this.blit(this.front, this.base);
    }
    /** Heightfield resolution this sim was built at. */
    get resolution() {
        return this.size;
    }
    /**
     * Load a pattern. By default the existing sand is kept, so a pattern drawn
     * over a previous one partially erases it — which is what the real table
     * does when you queue a playlist without a clear pattern between entries.
     */
    loadPath(path, { clearSand = false } = {}) {
        if (clearSand)
            this.reset();
        this.path = path;
        this.cursor = 0;
        this.relaxedIntervals = 0;
        this.plowH = null;
        this.pending = 0;
        // Remember the sand as it stood before this pattern ran, so the pattern can
        // be replayed or re-simulated without losing whatever was underneath it.
        this.blit(this.front, this.base);
    }
    /** Rewind to the sand as it was before the current pattern started. */
    replay() {
        this.blit(this.base, this.front);
        this.cursor = 0;
        this.relaxedIntervals = 0;
        this.plowH = null;
        this.pending = 0;
    }
    /**
     * Re-run the current pattern from its starting sand up to wherever playback
     * had reached. Used when a sand parameter changes: ball size and groove depth
     * feed the carve itself, so unlike the lighting controls they cannot be
     * applied by simply redrawing.
     */
    resimulate() {
        const target = this.cursor;
        this.replay();
        if (target > 0)
            this.advance(target);
    }
    get totalSegments() {
        return Math.max(0, this.path.length / 2 - 1);
    }
    get progress() {
        const total = this.totalSegments;
        return total === 0 ? 1 : Math.min(1, this.cursor / total);
    }
    get done() {
        return this.cursor >= this.totalSegments;
    }
    /** Current ball position in table space, or null before the first step. */
    get ballPosition() {
        if (this.path.length < 2)
            return null;
        const i = Math.min(this.cursor, this.path.length / 2 - 1) * 2;
        return [this.path[i] * this.pathScale, this.path[i + 1] * this.pathScale];
    }
    /**
     * Advance the simulation by up to `segments` path segments.
     * Returns the number actually consumed.
     */
    advance(segments) {
        const gl = this.gl;
        const total = this.totalSegments;
        if (this.cursor >= total)
            return 0;
        this.pending += segments;
        let consumed = 0;
        while (this.cursor < total) {
            // Whole chunks only, always aligned to the same multiples of
            // MAX_SEGMENTS, so the decomposition never depends on the caller.
            const count = Math.min(MAX_SEGMENTS, total - this.cursor);
            if (this.pending < count)
                break;
            const start = this.cursor;
            if (this.sand.model === 1) {
                this.plowChunk(start, count);
                this.cursor += count;
                this.pending -= count;
                consumed += count;
                continue;
            }
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            const scale = this.pathScale;
            for (let i = 0; i < count; i++) {
                const p = (start + i) * 2;
                const ax = this.path[p] * scale;
                const ay = this.path[p + 1] * scale;
                const bx = this.path[p + 2] * scale;
                const by = this.path[p + 3] * scale;
                this.segBuf[i * 4] = ax;
                this.segBuf[i * 4 + 1] = ay;
                this.segBuf[i * 4 + 2] = bx;
                this.segBuf[i * 4 + 3] = by;
                minX = Math.min(minX, ax, bx);
                minY = Math.min(minY, ay, by);
                maxX = Math.max(maxX, ax, bx);
                maxY = Math.max(maxY, ay, by);
            }
            // Where this chunk's capsule begins and ends, and the directions it
            // enters and leaves by, so the shader can tell its rounded end caps
            // apart from the real swept groove.
            const dir = (fromIdx, toIdx) => {
                const dx = (this.path[toIdx * 2] - this.path[fromIdx * 2]) * scale;
                const dy = (this.path[toIdx * 2 + 1] - this.path[fromIdx * 2 + 1]) * scale;
                const len = Math.hypot(dx, dy);
                return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
            };
            /**
             * Direction of the path arriving at point `k`, skipping degenerate
             * segments.
             *
             * Dense image-derived patterns repeat coordinates freely, and a repeated
             * pair gives a zero-length segment with no direction. Treating that as
             * "no plane" is not good enough: the chunk then deposits its berm past
             * the boundary and double-doses with its neighbour, leaving a blip at
             * exactly the duplicated points. Walking to the nearest segment that does
             * have a direction keeps a real plane at every boundary.
             *
             * The search is bounded so a long run of duplicates can't make this
             * quadratic; past that, it gives up and disables the plane.
             */
            const dirEntering = (k) => {
                const LIMIT = 64;
                for (let j = k; j > 0 && k - j < LIMIT; j--) {
                    const d = dir(j - 1, j);
                    if (d[0] !== 0 || d[1] !== 0)
                        return d;
                }
                for (let j = k; j < total && j - k < LIMIT; j++) {
                    const d = dir(j, j + 1);
                    if (d[0] !== 0 || d[1] !== 0)
                        return d;
                }
                return [0, 0];
            };
            // Both planes are defined by the direction *entering* their boundary
            // point, so a boundary shared by two chunks gets the same plane from each
            // and the partition is exact. Deriving the start plane from this chunk's
            // own first segment instead would give the two chunks different normals
            // wherever the path curves, leaving a wedge neither claims on the outside
            // of the turn and one both claim on the inside — a periodic spike at
            // every boundary.
            const last = start + count;
            const [sdx, sdy] = dirEntering(start);
            const [edx, edy] = dirEntering(last);
            // Only shade the region this chunk can affect, plus a texel of slack.
            const pad = this.ballRadiusWorld + this.bermWidthWorld + 4 / this.size;
            const bounds = [
                Math.max(-1, minX - pad),
                Math.max(-1, minY - pad),
                Math.min(1, maxX + pad),
                Math.min(1, maxY + pad),
            ];
            const prog = this.progCarve;
            this.beginPass(prog, bounds);
            gl.uniform4fv(this.loc(prog, 'uSegs'), this.segBuf);
            gl.uniform1i(this.loc(prog, 'uSegCount'), count);
            gl.uniform1f(this.loc(prog, 'uBallR'), this.ballRadiusWorld);
            gl.uniform1f(this.loc(prog, 'uDepth'), this.depthWorld);
            gl.uniform1f(this.loc(prog, 'uBermW'), this.bermWidthWorld);
            gl.uniform1f(this.loc(prog, 'uBermGain'), this.sand.bermGain);
            gl.uniform1f(this.loc(prog, 'uFill'), this.sand.fill * this.bowWaveScale(start));
            gl.uniform1f(this.loc(prog, 'uScrape'), this.sand.scrapeMm * this.worldPerMm);
            gl.uniform2f(this.loc(prog, 'uCapStart'), this.path[start * 2] * scale, this.path[start * 2 + 1] * scale);
            gl.uniform2f(this.loc(prog, 'uCapStartDir'), sdx, sdy);
            gl.uniform2f(this.loc(prog, 'uCapEnd'), this.path[last * 2] * scale, this.path[last * 2 + 1] * scale);
            gl.uniform2f(this.loc(prog, 'uCapEndDir'), edx, edy);
            this.endPass();
            this.cursor += count;
            this.pending -= count;
            consumed += count;
            // Let ridges slump periodically rather than after every chunk — the
            // visual difference is negligible and it is a full-field pass.
            const intervals = Math.floor(this.cursor / (this.sand.relaxEverySegments || RELAX_EVERY_SEGMENTS));
            if (intervals > this.relaxedIntervals) {
                this.relaxedIntervals = intervals;
                this.relax(this.sand.relaxIterations ?? 1);
            }
        }
        if (this.sand.model === 1 && consumed > 0) {
            if (this.cursor >= total && this.plowH) {
                const n = this.path.length / 2 - 1, scale = this.pathScale;
                plowFinish(this.plowH, this.plowSize, this.plowParams(), this.plowState, this.path[n * 2] * scale, this.path[n * 2 + 1] * scale);
            }
            this.plowUpload();
        }
        return consumed;
    }
    get plowSize() {
        return Math.min(this.size, Math.max(256, Math.round(this.sand.plowSize || 1024)));
    }
    plowParams() {
        const floor = this.sand.floorMm > 0 ? this.sand.floorMm * this.worldPerMm : 1e3;
        return {
            ballR: this.ballRadiusWorld, depth: this.depthWorld, floor,
            ridgeW: Math.max(this.bermWidthWorld, 2 * (2 / this.plowSize)),
            shed: this.sand.plowShed, carry: this.sand.plowCarryMm * this.worldPerMm, fill: this.sand.plowFill, dump: this.sand.plowDump, even: this.sand.plowEven ?? 0, ridgePeak: Math.min(.95, Math.max(0, this.sand.plowRidgePeak ?? 0)), wake: this.sand.plowWake ?? 0, wakeEdge: this.sand.plowWakeEdge ?? 0,
            repose: this.sand.reposeSlope, relaxSweeps: Math.max(0, Math.round(this.sand.plowRelaxSweeps)),
            substeps: Math.max(1, Math.round(this.sand.plowSubsteps ?? 1)),
            pileR: Math.max(0, this.sand.plowPileR ?? 0), pileAhead: this.sand.plowPileAhead ?? 1.7, heap: this.sand.plowHeap ?? 0, pileArc: this.sand.plowPileArc ?? 0,
        };
    }
    /** Run the plow model over path segments [start, start + count). */
    plowChunk(start, count) {
        const n = this.plowSize;
        if (!this.plowH) {
            // Start from the sand as it stands (box-filtered down to the plow grid).
            const full = this.captureHeight(), f = this.size / n, h = new Float32Array(n * n);
            for (let r = 0; r < n; r++)
                for (let c = 0; c < n; c++) {
                    let s = 0, k = 0;
                    for (let y = Math.floor(r * f); y < Math.floor((r + 1) * f); y++)
                        for (let x = Math.floor(c * f); x < Math.floor((c + 1) * f); x++) {
                            s += full[y * this.size + x];
                            k++;
                        }
                    h[r * n + c] = s / k;
                }
            this.plowH = h;
            this.plowState = newPlowState();
        }
        const p = this.plowParams(), scale = this.pathScale;
        for (let i = start; i < start + count; i++) {
            plowSegment(this.plowH, n, p, this.plowState, this.path[i * 2] * scale, this.path[i * 2 + 1] * scale, this.path[i * 2 + 2] * scale, this.path[i * 2 + 3] * scale);
        }
    }
    /** Upload the plow heightfield to the render grid (bilinear). */
    plowUpload() {
        if (!this.plowH)
            return;
        const n = this.plowSize, N = this.size, src = this.plowH;
        let out = src;
        if (n !== N) {
            out = new Float32Array(N * N);
            const f = n / N;
            for (let r = 0; r < N; r++) {
                const y = Math.min(n - 1.000001, Math.max(0, (r + 0.5) * f - 0.5)), y0 = Math.floor(y), fy = y - y0;
                for (let c = 0; c < N; c++) {
                    const x = Math.min(n - 1.000001, Math.max(0, (c + 0.5) * f - 0.5)), x0 = Math.floor(x), fx = x - x0, i = y0 * n + x0;
                    out[r * N + c] = (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + n] * (1 - fx) + src[i + n + 1] * fx) * fy;
                }
            }
        }
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.front.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.FLOAT, out);
    }
    /**
     * Share of `fill` the ball has at path point `k` (see `bowWaveMm`). Depends
     * only on the path and the physical settings, never on how the work is
     * batched.
     */
    bowWaveScale(k) {
        if (!(this.sand.bowWaveMm > 0))
            return 1;
        const scale = this.pathScale, r = this.ballRadiusWorld, key = `${scale}:${r}:${this.sand.bowWaveMm}`;
        if (!this.fillShare || this.runKey !== key || this.fillShare.length !== this.path.length / 2) {
            this.fillShare = selfOverlap(this.path, scale, this.sand.bowWaveMm * this.worldPerMm, 1.5 * r, 0.7 * r, 1.2 * r);
            this.runKey = key;
        }
        return this.fillShare[k];
    }
    /** Run the angle-of-repose pass. */
    relax(iterations = 1) {
        const gl = this.gl;
        const prog = this.progRelax;
        const texel = 1 / this.size;
        // Height difference two adjacent cells can sustain at the repose angle.
        const maxDrop = this.sand.reposeSlope * (2 / this.size);
        for (let i = 0; i < iterations; i++) {
            this.beginPass(prog, [-1, -1, 1, 1]);
            gl.uniform2f(this.loc(prog, 'uTexel'), texel, texel);
            gl.uniform1f(this.loc(prog, 'uMaxDrop'), maxDrop);
            gl.uniform1f(this.loc(prog, 'uRate'), 0.5);
            this.endPass();
        }
    }
    /** Run the whole pattern in one go, yielding nothing. */
    runToEnd() {
        while (!this.done)
            this.advance(4096);
        if (this.sand.model !== 1)
            this.relax(2); // the plow model slumps as it goes
    }
    /** Shade the heightfield to the canvas. */
    draw() {
        const gl = this.gl;
        const defines = [...(this.render.lightMode > 0.5 ? ['RING'] : []), ...(this.render.floor > 0.5 ? ['FLOOR'] : [])];
        let prog = this.progRender;
        if (defines.length) {
            const key = defines.join(',');
            if (!this.renderVariants.has(key))
                this.renderVariants.set(key, link(gl, QUAD_VERT, defines.reduce(withDefine, RENDER_FRAG)));
            prog = this.renderVariants.get(key);
        }
        const canvas = gl.canvas;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(prog);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.front.tex);
        const texel = 1 / this.size;
        gl.uniform1i(this.loc(prog, 'uHeight'), 0);
        gl.uniform4f(this.loc(prog, 'uBounds'), -1, -1, 1, 1);
        gl.uniform2f(this.loc(prog, 'uTexel'), texel, texel);
        gl.uniform1f(this.loc(prog, 'uRelief'), this.render.relief);
        gl.uniform1f(this.loc(prog, 'uLightAz'), this.render.lightAzimuth);
        gl.uniform1f(this.loc(prog, 'uLightEl'), this.render.lightElevation);
        gl.uniform3fv(this.loc(prog, 'uSandColor'), this.render.sandColor);
        gl.uniform1f(this.loc(prog, 'uGrain'), this.sand.grain);
        gl.uniform1f(this.loc(prog, 'uAoStrength'), this.render.aoStrength);
        gl.uniform1f(this.loc(prog, 'uAoRadius'), AO_RADIUS_UV);
        gl.uniform1f(this.loc(prog, 'uRingRadius'), this.render.ringRadius);
        gl.uniform1f(this.loc(prog, 'uRingHeight'), this.render.ringHeightMm * this.worldPerMm);
        gl.uniform1f(this.loc(prog, 'uShadowDist'), this.render.shadowMm * this.worldPerMm);
        gl.uniform1f(this.loc(prog, 'uAmbient'), this.render.ambient ?? 0.28);
        gl.uniform1f(this.loc(prog, 'uFloorDepth'), this.depthWorld);
        gl.uniform1f(this.loc(prog, 'uCover'), this.render.coverMm * this.worldPerMm);
        gl.uniform3fv(this.loc(prog, 'uFloorColor'), this.render.floorColor);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    /** Snapshot the sand bed, for seeding a later run. */
    captureHeight() {
        const gl = this.gl;
        const out = new Float32Array(this.size * this.size);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.front.fbo);
        gl.readPixels(0, 0, this.size, this.size, gl.RED, gl.FLOAT, out);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return out;
    }
    /** Restore a snapshot taken by `captureHeight`. */
    seedHeight(data) {
        const gl = this.gl;
        if (data.length !== this.size * this.size) {
            throw new Error(`Height snapshot is ${data.length} samples; expected ${this.size * this.size}.`);
        }
        gl.bindTexture(gl.TEXTURE_2D, this.front.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.size, this.size, gl.RED, gl.FLOAT, data);
        this.cursor = 0;
        this.relaxedIntervals = 0;
        this.plowH = null;
        this.pending = 0;
    }
    dispose() {
        const gl = this.gl;
        for (const t of [this.front, this.back, this.base]) {
            gl.deleteTexture(t.tex);
            gl.deleteFramebuffer(t.fbo);
        }
        gl.deleteVertexArray(this.vao);
        for (const p of [this.progCarve, this.progRelax, this.progReset, this.progRender, ...this.renderVariants.values()]) {
            gl.deleteProgram(p);
        }
    }
}
