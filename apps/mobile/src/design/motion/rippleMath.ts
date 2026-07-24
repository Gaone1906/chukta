/**
 * Pure maths for the ripple transition, extracted so it can be unit-tested without a device
 * and reused by both the worklet and any future implementation.
 *
 * Values are from design-reference/assets/hisaab-ripple.js and must not be "tuned" casually —
 * the ripple is the app's signature interaction and every screen change uses it.
 */

/** Fast-out easing: 1 - (1-t)^2.6. */
export function rippleEase(t: number): number {
  'worklet';
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - clamped, 2.6);
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
 * Ring opacity fades linearly in raw progress, not eased progress — so the rings thin out
 * steadily as the wavefront accelerates away, which is what makes it read as water rather
 * than as an expanding circle.
 */
export function ringOpacity(p: number, index: number): number {
  'worklet';
  const base = index === 0 ? 0.85 : index === 1 ? 0.5 : 0.28;
  return Math.max(0, 1 - p) * base;
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
