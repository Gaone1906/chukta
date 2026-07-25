/**
 * Pure maths for the ripple transition, extracted so it can be unit-tested without a device
 * and reused by both the worklet and any future implementation.
 *
 * Values originate in design-reference/assets/hisaab-ripple.js. The *shape* of the wavefront
 * has since been retuned — see `rippleEase` below for why the prototype's curve could not be
 * kept — but the trailing-rings idea, the lag between them and the settle-back are all still
 * the design's.
 */

/**
 * The prototype's curve: 1 - (1-t)^2.6. Kept because the ring maths is expressed in terms of
 * it and it is what the design reference documents, but **no longer used for the wavefront.**
 *
 * It is a very hard ease-out. At a quarter of the expand it is already 51% travelled, and at
 * half it is 83%. Rendered over a 450ms expand that means the visible wave crosses most of the
 * screen in about 110ms and then crawls — which reads as a flinch followed by a stall, not as
 * a sweep. That is the honest explanation for "it happens too fast and looks janky".
 */
export function rippleEase(t: number): number {
  'worklet';
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - clamped, 2.6);
}

/**
 * Quadratic out, 1 - (1-t)^2. **Used by `RippleReveal`'s veil, and by nothing else.**
 *
 * The comment that used to sit here called this "the wavefront curve actually used now", which
 * was false: `RippleNav` drove everything from a `Easing.bezier` it declared itself. Believing
 * that comment is how the curve got mis-tuned twice — someone reads the reasoning here, adjusts
 * this function, and the transition on screen does not move. A comment naming the wrong curve
 * is worse than no comment, so: check the call site, not this docstring.
 *
 * It is an ease-out because a FILLED disc covers area ∝ r², so a radius moving at constant
 * speed appears to accelerate violently near the end. Easing the radius out is what makes the
 * *coverage* read as even.
 *
 * That reasoning applies to a filled veil and NOT to a thin ring — see `ringRadius`.
 */
export function waveEase(t: number): number {
  'worklet';
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const inverse = 1 - clamped;
  return 1 - inverse * inverse;
}

/** Distance from the origin to the furthest corner — how far the wavefront must travel. */
export function maxRadius(width: number, height: number, x: number, y: number): number {
  'worklet';
  const h = (a: number, b: number) => Math.sqrt(a * a + b * b);
  return Math.max(h(x, y), h(width - x, y), h(x, height - y), h(width - x, height - y));
}

export const RING_COUNT = 3;
/** Each ring trails the wavefront by 9% of the maximum radius. */
export const RING_LAG = 0.09;
export const RING_OPACITY = [0.85, 0.5, 0.28] as const;
export const RING_BLUR = [0.4, 1.2, 2.4] as const;

/**
 * Radius of trailing ring `index` at progress `p`.
 *
 * **`p` should be near-LINEAR here, not eased** — the opposite of what the veil wants, which is
 * why the two stopped sharing a progress value. A ring is a travelling wavefront: what the eye
 * tracks is the line itself, and a line moving at constant radial speed is what reads as a
 * sweep. Easing it out makes it decelerate into a stall — the exact "jankily stopping before
 * reaching the edge" this was reported as. Only the filled veil needs the r² correction.
 */
export function ringRadius(p: number, rMax: number, index: number): number {
  'worklet';
  return Math.max(0, p * rMax - index * rMax * RING_LAG);
}

/**
 * How visible ring `index` is at its OWN travel `p` — not the leading edge's.
 *
 * Passing the leader's progress for all three was a real bug: every ring ran the leader's fade
 * schedule, so they dimmed on a clock that had nothing to do with where they actually were, and
 * all three hit zero simultaneously while sitting at three different radii. Ring 3 was invisible
 * from 58% of the way out. Each ring now fades against its own position, which is what makes
 * three distinct rings visible instead of one bright one and two rumours.
 *
 * The hold runs to 0.75 rather than 0.66 because of where the geometry puts them: `maxRadius`
 * measures to the furthest CORNER, so across the last half of the journey only about an eighth
 * of a ring's circumference is still on screen. Fading early spends the fade somewhere nobody
 * can see. The dissolve takes them out at the end regardless — see the global fade in RippleNav.
 */
export function ringOpacity(p: number, index: number): number {
  'worklet';
  const base = RING_OPACITY[index] ?? 0.28;
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;

  // A short fade in, so a ring appears from the fingertip rather than being switched on.
  const arriving = clamped < 0.08 ? clamped / 0.08 : 1;

  // Nothing fades until three quarters of the way across; then it goes out over the remainder.
  const leaving = clamped < 0.75 ? 1 : 1 - (clamped - 0.75) / 0.25;

  return base * arriving * (leaving < 0 ? 0 : leaving);
}

/** The outgoing screen settles back: blur to 3.2px, saturation to .75, scale to .982. */
export function outgoingBlur(p: number): number {
  'worklet';
  return 3.2 * p;
}

export function outgoingScale(p: number): number {
  'worklet';
  return 1 - 0.018 * p;
}

/**
 * How far past full coverage the veil drifts as it dissolves.
 *
 * The settle-back this replaces used to be applied to the navigator itself, which meant every
 * glass surface on screen was recomposited on every frame of the transition. This buys the
 * same "the surface parted and the screen is behind it" depth cue from a single solid layer
 * that is already animating.
 */
export function veilDrift(dissolve: number): number {
  'worklet';
  const clamped = dissolve < 0 ? 0 : dissolve > 1 ? 1 : dissolve;
  return 1 + 0.07 * clamped;
}
