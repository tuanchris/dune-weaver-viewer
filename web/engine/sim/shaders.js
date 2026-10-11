// The DW sand engine: moved from dune-weaver-sim (src/sim/shaders.ts) into sand-weaver on 2026-10-02.
// This is now the source; edit it here (sim/README.md).
/**
 * GLSL for the sand heightfield simulation.
 *
 * World space is the table: a unit disc centred on the origin, so x,y in
 * [-1,1] and rho maps directly to radius. Heights are in the same units, so a
 * ball radius of 0.03 and a groove depth of 0.018 are directly comparable.
 */
export const MAX_SEGMENTS = 8;
/** Compile-time variant of a fragment shader: `#define NAME` after its `#version` line. */
export function withDefine(src, name) {
    const nl = src.indexOf('\n');
    return src.slice(0, nl + 1) + `#define ${name} 1\n` + src.slice(nl + 1);
}
/** Draws a quad covering an arbitrary world-space AABB. */
export const QUAD_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner; // unit quad, 0..1

uniform vec4 uBounds; // xy = min, zw = max (world space)

out vec2 vWorld;
out vec2 vUv;

void main() {
  vWorld = mix(uBounds.xy, uBounds.zw, aCorner);
  vUv = vWorld * 0.5 + 0.5;
  gl_Position = vec4(vWorld, 0.0, 1.0);
}
`;
/**
 * Carve pass — the actual sand physics.
 *
 * A chunk of consecutive path segments is rasterised at once. For each pixel
 * we take the distance to the nearest segment, treated as a capsule, which
 * means a fast-moving ball still cuts one continuous groove rather than a
 * dotted line of stamps.
 *
 * Inside the ball footprint the surface is pushed down to the ball's spherical
 * underside (a min, so re-tracing an existing groove removes nothing extra).
 * Just outside it, material is deposited as a berm, and the amount deposited
 * is proportional to how much was actually displaced nearby — sampled from the
 * height texture. That coupling is what makes erasure behave: plowing through
 * virgin sand throws up a big ridge, plowing down an existing groove barely
 * disturbs it.
 */
export const CARVE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vWorld;
in vec2 vUv;

uniform sampler2D uHeight;
uniform vec4 uSegs[${MAX_SEGMENTS}]; // xy = a, zw = b
uniform int   uSegCount;
uniform float uBallR;     // ball radius, table radii
uniform float uDepth;     // how deep the ball sits below nominal surface
uniform float uBermW;     // width of the displaced-material ridge
uniform float uBermGain;  // fraction of displaced material that piles at the edge
uniform float uFill;      // how strongly the ball's bow wave backfills old grooves
uniform float uScrape;    // sand thinner than this over the ball's floor depth is swept off (0 = off)

// The chunk's own first and last path points, with the directions it enters and
// leaves by. Used to recognise the capsule's rounded end caps, which are an
// artefact of processing the path in batches rather than real geometry.
uniform vec2 uCapStart;
uniform vec2 uCapStartDir;
uniform vec2 uCapEnd;
uniform vec2 uCapEndDir;

out float fragH;

/** Squared distance from p to segment ab, plus the nearest point. */
void segNearest(vec2 p, vec2 a, vec2 b, out vec2 nearest, out float dist) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float denom = max(dot(ba, ba), 1e-12);
  float t = clamp(dot(pa, ba) / denom, 0.0, 1.0);
  nearest = a + ba * t;
  dist = length(p - nearest);
}

/** Underside of the ball at horizontal distance d from its centre line. */
float ballFloor(float d) {
  float r2 = max(uBallR * uBallR - d * d, 0.0);
  return (uBallR - uDepth) - sqrt(r2);
}

void main() {
  float h = texture(uHeight, vUv).r;

  float bestDist = 1e9;
  vec2 bestPoint = vec2(0.0);

  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uSegCount) break;
    vec2 n;
    float d;
    segNearest(vWorld, uSegs[i].xy, uSegs[i].zw, n, d);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = n;
    }
  }

  float newH = h;

  // Is this pixel beyond one of the capsule's rounded end caps — that is,
  // behind where the chunk starts or ahead of where it ends?
  //
  // A zero direction means the adjacent segment was degenerate: two identical
  // consecutive coordinates, which dense image-derived patterns are full of.
  // That must disable the plane, not define one. Testing the dot product alone
  // makes dot(anything, vec2(0.0)) == 0.0 answer the question, and with a
  // non-strict comparison that reads as "past the cap" for every pixel on the
  // table — silently dropping the entire chunk and leaving a groove that stops
  // dead in open sand.
  bool pastCap =
    (dot(uCapStartDir, uCapStartDir) > 0.0 &&
     dot(vWorld - uCapStart, uCapStartDir) < 0.0) ||
    (dot(uCapEndDir, uCapEndDir) > 0.0 &&
     dot(vWorld - uCapEnd, uCapEndDir) >= 0.0);

  if (bestDist < uBallR) {
    float target = ballFloor(bestDist);
    if (h > target) {
      // Virgin or shallower sand: the ball plows it down.
      //
      // Deliberately NOT restricted to the chunk's own slab. The capsule's cap
      // disc is not a batching artefact the way the cap *plane* is — the ball
      // really is centred on that point at that instant, so the disc lies
      // inside the true swept region and carving it is always correct. Confining
      // the carve leaves the outside of every turn claimed by no chunk at all.
      newH = target;
    } else if (!pastCap) {
      // The sand here is already lower than the ball rides — an older, deeper
      // groove. A pure min() would leave it untouched forever, so a clear
      // pattern could never actually clear anything. In reality the ball
      // pushes a bow wave of loose sand ahead of it, and that material drops
      // into any depression it crosses, so the old groove partially backfills.
      newH = mix(h, target, uFill);
    }
    // A sliver of sand left between two close passes, thinner than a few grains,
    // cannot stand on the tray floor where the ball runs beside it: it is swept
    // into the ball's path and on with it. Only where the ball here runs within
    // uScrape of its floor depth, so a groove's walls are untouched.
    if (uScrape > 0.0 && target + uDepth < uScrape && newH + uDepth < uScrape) newH = min(newH, -uDepth);
  } else if (bestDist < uBallR + uBermW && !pastCap) {
    // Berm deposition is additive, so unlike the carve it is NOT idempotent and
    // every pixel must be claimed by exactly one chunk. Without the cap test a
    // pixel near a chunk boundary lies within berm range of both the outgoing
    // chunk's last segment and the incoming chunk's first, and gets a double
    // dose; the rounded cap also sprays a berm arc straight across the groove
    // the previous chunk just cut. Either way it plants a raised blip at every
    // boundary — a visibly periodic stipple along what should be a smooth
    // groove.
    //
    // The two chunks share the boundary plane, so suppressing past-cap pixels
    // partitions them rather than leaving a gap: what this chunk declines to
    // deposit, its neighbour already did.
    vec2 dir = normalize(vWorld - bestPoint);
    vec2 probe = bestPoint + dir * (uBallR * 0.6);
    float hProbe = texture(uHeight, probe * 0.5 + 0.5).r;
    float removed = max(hProbe - ballFloor(uBallR * 0.6), 0.0);

    // Ridge is tallest right at the groove edge and tapers outward.
    float t = (bestDist - uBallR) / uBermW;
    float profile = (1.0 - t) * (1.0 - t);

    newH = h + removed * uBermGain * profile;
  }

  fragH = newH;
}
`;
/**
 * Angle-of-repose relaxation.
 *
 * Sand can't hold an arbitrarily steep face. Where the slope between adjacent
 * cells exceeds the repose limit, material flows downhill. Written in gather
 * form (each cell computes its own net change from its neighbours) so it is
 * symmetric and conserves volume, rather than growing or losing sand over many
 * iterations.
 */
export const RELAX_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uHeight;
uniform vec2  uTexel;
uniform float uMaxDrop; // max sustainable height difference between neighbours
uniform float uRate;

out float fragH;

void main() {
  float h = texture(uHeight, vUv).r;

  float delta = 0.0;
  vec2 offs[4] = vec2[4](
    vec2( uTexel.x, 0.0), vec2(-uTexel.x, 0.0),
    vec2(0.0,  uTexel.y), vec2(0.0, -uTexel.y)
  );

  for (int i = 0; i < 4; i++) {
    float hn = texture(uHeight, vUv + offs[i]).r;
    // Inflow from a neighbour that is too high, minus outflow to one too low.
    delta += max(hn - h - uMaxDrop, 0.0) - max(h - hn - uMaxDrop, 0.0);
  }

  fragH = h + uRate * 0.25 * delta;
}
`;
/** Fills the heightfield with flat, very slightly noisy sand. */
export const RESET_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
uniform float uGrain;
uniform float uSize; // heightfield resolution, in texels

out float fragH;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  // One independent sample per texel at any resolution. Hard-coding the rate
  // instead makes the bed noisier than the grid at low resolution and smoother
  // than it at high resolution, so raising detail would visibly change the
  // texture of untouched sand rather than just resolving it better.
  fragH = (hash(vUv * uSize) - 0.5) * uGrain;
}
`;
/**
 * Photoreal sand shading.
 *
 * The look comes almost entirely from a low grazing key light: at a shallow
 * elevation a groove wall a fraction of a millimetre deep casts a long, soft
 * shadow, which is exactly why real sand tables photograph so well. Ambient
 * occlusion (height relative to a wider neighbourhood) darkens the troughs,
 * and a fine grain perturbs the normal so flat areas aren't plastic.
 */
export const RENDER_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vWorld;

uniform sampler2D uHeight;
uniform vec2  uTexel;
uniform float uRelief;    // normal exaggeration
uniform float uLightAz;   // radians
uniform float uLightEl;   // radians
uniform vec3  uSandColor;
uniform float uGrain;
uniform float uAoStrength;
uniform float uAoRadius;  // uv units, NOT texels — see below
#ifdef RING
// Ring mode (compiled with RING): the table's own LED strip, a ring of lights
// at radius uRingRadius and height uRingHeight above the sand (world units),
// lit from RING_TAPS points. Each tap is shadowed by marching the heightfield
// toward it for uShadowDist, so a groove's floor sits in the shade of its walls
// at the strip's low angle, which is what makes grooves read dark on the table.
uniform float uRingRadius;
uniform float uRingHeight;
uniform float uShadowDist;
// Ambient fill under the ring: light bounced into shadow. The table is viewed
// in a dark room, where the raking default's fill keeps slits too bright.
uniform float uAmbient;
#endif
#ifdef FLOOR
// Floor mode (compiled with FLOOR): the sand is a thin layer over a dark tray
// floor, uFloorDepth deep (world units) — the ball rides on the floor, so this
// is the groove depth. Sand thinner than uCover lets the floor show through,
// which on a real table is what makes a groove read as a dark line.
uniform float uFloorDepth;
uniform float uCover;
uniform vec3  uFloorColor;
#endif

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x),
    f.y
  );
}

float heightAt(vec2 uv) { return texture(uHeight, uv).r; }

void main() {
  // The table is displayed rotated 180° from heightfield space, to match the
  // orientation the physical table is viewed in.
  vec2 uv = 1.0 - vUv;
  vec2 world = -vWorld;

  float r = length(world);

  float h  = heightAt(uv);
  float hL = heightAt(uv - vec2(uTexel.x, 0.0));
  float hR = heightAt(uv + vec2(uTexel.x, 0.0));
  float hD = heightAt(uv - vec2(0.0, uTexel.y));
  float hU = heightAt(uv + vec2(0.0, uTexel.y));

  // World-space gradient, exaggerated so sub-millimetre relief reads on screen.
  vec2 grad = vec2(hR - hL, hU - hD) / (2.0 * uTexel.x) * uRelief;

  // Rotating the surface rotates its normal with it. Without this the geometry
  // would turn but the shading would not, lighting every groove from the wrong
  // side and reading as embossed rather than engraved.
  grad = -grad;

  // Fine grain, as a normal perturbation rather than a colour speckle —
  // it catches the light like real grains instead of looking like film noise.
  vec2 gp = uv * 900.0;
  vec2 grain = vec2(
    noise(gp) - noise(gp + vec2(1.7, 0.0)),
    noise(gp + vec2(0.0, 3.1)) - noise(gp + vec2(0.0, 4.8))
  );
  grad += grain * uGrain * 6.0;

  vec3 n = normalize(vec3(-grad, 1.0));

  vec3 L = normalize(vec3(
    cos(uLightAz) * cos(uLightEl),
    sin(uLightAz) * cos(uLightEl),
    sin(uLightEl)
  ));

  // Ambient occlusion: how low this point sits relative to a wide neighbourhood.
  //
  // The sampling radius is in uv (i.e. table) units rather than texels, so the
  // neighbourhood is the same patch of sand at every heightfield resolution.
  // Expressed in texels it would shrink as resolution rose, and raising detail
  // would quietly flatten every groove's shading.
  float wide = 0.0;
  const int TAPS = 8;
  for (int i = 0; i < TAPS; i++) {
    float a = float(i) / float(TAPS) * 6.2831853;
    wide += heightAt(uv + vec2(cos(a), sin(a)) * uAoRadius);
  }
  wide /= float(TAPS);
  // Floor the occlusion well above zero — sand is a strong diffuse bouncer, so
  // even a deep groove never goes black the way a hard-surface AO would.
  float ao = clamp(1.0 - max(wide - h, 0.0) * uAoStrength, 0.52, 1.0);

  // Wrapped diffuse — sand scatters, so terminators are soft, not hard.
  float ndl = dot(n, L);
  float wrap = 0.35;
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 24.0) * 0.05;

#ifdef RING
  {
    // The ring: taps around the rim, nearer ones brighter (a line source falls
    // off as 1/d), normalised so the table centre receives 1.
    const int RING_TAPS = 24;
    const int MARCH = 24;
    float sum = 0.0;
    float specSum = 0.0;
    for (int k = 0; k < RING_TAPS; k++) {
      float phi = (float(k) + 0.5) / float(RING_TAPS) * 6.2831853;
      vec2 q = uRingRadius * vec2(cos(phi), sin(phi));
      vec2 toQ = q - world;
      float dist = max(length(toQ), 1e-4);
      vec2 dirW = toQ / dist;
      vec3 Lk = normalize(vec3(dirW * dist, uRingHeight));
      float tanEl = uRingHeight / dist;
      // March toward the tap. Display space is heightfield space turned 180°,
      // and one uv unit is two world units.
      float horizon = -1e3;
      for (int j = 1; j <= MARCH; j++) {
        float s = uShadowDist * float(j) / float(MARCH);
        if (s >= dist) break;
        float hj = heightAt(uv - dirW * (s * 0.5));
        horizon = max(horizon, (hj - h) / s);
      }
      float lit = smoothstep(-0.04, 0.04, tanEl - horizon);
      float ndlk = dot(n, Lk);
      float dk = clamp((ndlk + wrap) / (1.0 + wrap), 0.0, 1.0);
      // Capped, so a tap does not show as a hot spot on the sand right beside it.
      float w = min(uRingRadius / dist, 3.0);
      sum += w * dk * lit;
      vec3 Hk = normalize(Lk + V);
      specSum += w * lit * pow(max(dot(n, Hk), 0.0), 24.0);
    }
    diff = sum / float(RING_TAPS);
    spec = specSum / float(RING_TAPS) * 0.05;
  }
#endif

  vec3 warmKey  = vec3(1.00, 0.94, 0.84);
  vec3 coolFill = vec3(0.46, 0.50, 0.60);

#ifdef RING
  float fill = uAmbient;
#else
  float fill = 0.28;
#endif
  vec3 col = uSandColor * (diff * warmKey * 1.05 + coolFill * fill) * ao;
  col += spec * warmKey;

  // Slight tonal variation so the sand bed isn't a flat wash.
  col *= 0.97 + 0.06 * noise(uv * 12.0);

#ifdef FLOOR
  float cover = smoothstep(0.0, uCover, h + uFloorDepth);
  col = mix(uFloorColor * (0.35 + diff) * ao, col, cover);
#endif

  // Table edge: sand stops, a soft inner shadow reads as the rim wall.
  //
  // Kept deliberately tight. The outermost passes run right up against the
  // wall — in a sideways clear every turn happens at rho > 0.99 — so a wide
  // fade here does not read as depth, it erases real detail.
  float edge = smoothstep(1.0, 0.994, r);
  float rimShade = smoothstep(0.975, 1.0, r);
  col *= 1.0 - rimShade * 0.35;

  vec3 surround = vec3(0.055, 0.052, 0.058);
  col = mix(surround, col, edge);

  // Gentle vignette.
  col *= 1.0 - 0.18 * smoothstep(0.25, 1.15, r);

  // Filmic-ish tone curve + gamma.
  col = col / (col + 0.72);
  col = pow(col, vec3(1.0 / 2.2));

  fragColor = vec4(col, 1.0);
}
`;
