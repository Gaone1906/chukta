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
 * The wavefront curve actually used now: quadratic out, 1 - (1-t)^2.
 *
 * Still an ease-out, because it has to be — the area a circle covers grows with the *square*
 * of its radius, so a radius moving at constant speed would appear to accelerate violently
 * near the end. Easing the radius out is what makes the *coverage* feel even.
 *
 * But a gentler one. Quarter-way through the expand this is 44% travelled rather than 51%,
 * and half-way 75% rather than 83%, so there is still real movement in the second half of the
 * phase instead of a curve that has spent itself in the first sixth.
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

/** Radius of trailing ring `index` at eased progress `p`. */
export function ringRadius(p: number, rMax: number, index: number): number {
  'worklet';
  return Math.max(0, p * rMax - index * rMax * RING_LAG);
}

/**
 * How visible ring `index` is at raw progress `p`.
 *
 * The rings are the ONLY part of the wavefront there is to see — the veil is deliberately the
 * colour the screens already sit on, which is what hides the seam. So they hold their
 * brightness across the first two thirds of the journey and only fade at the end, rather than
 * the previous linear `(1 - p)` which had the leading ring down to 42% opacity by the time it
 * was half way across and invisible long before it arrived.
 */
export function ringOpacity(p: number, index: number): number {
  'worklet';
  const base = RING_OPACITY[index] ?? 0.28;
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;

  // A short fade in, so a ring appears from the fingertip rather than being switched on.
  const arriving = clamped < 0.08 ? clamped / 0.08 : 1;

  // Nothing fades until two thirds of the way across; then it goes out over the remainder.
  const leaving = clamped < 0.66 ? 1 : 1 - (clamped - 0.66) / 0.34;

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
