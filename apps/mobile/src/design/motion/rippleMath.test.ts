import { describe, expect, it } from 'vitest';

import { motion } from '../tokens';
import {
  RING_COUNT,
  maxRadius,
  outgoingBlur,
  outgoingScale,
  ringOpacity,
  ringRadius,
  rippleEase,
  veilDrift,
  waveEase,
} from './rippleMath';

describe('rippleEase', () => {
  it('is pinned at both ends and clamps outside [0,1]', () => {
    expect(rippleEase(0)).toBe(0);
    expect(rippleEase(1)).toBe(1);
    expect(rippleEase(-5)).toBe(0);
    expect(rippleEase(5)).toBe(1);
  });

  it('is fast-out: past the halfway point well before halfway through', () => {
    expect(rippleEase(0.25)).toBeGreaterThan(0.5);
    expect(rippleEase(0.5)).toBeGreaterThan(0.8);
  });

  it('increases monotonically', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const value = rippleEase(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('maxRadius', () => {
  it('reaches the furthest corner from the origin', () => {
    // Origin at a corner: the far diagonal.
    expect(maxRadius(300, 400, 0, 0)).toBeCloseTo(500);
    // Origin at the centre: half the diagonal.
    expect(maxRadius(300, 400, 150, 200)).toBeCloseTo(250);
  });

  it('always covers every corner, wherever the tap landed', () => {
    const w = 390;
    const h = 844;
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2], [12, 800]]) {
      const r = maxRadius(w, h, x!, y!);
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
        expect(r).toBeGreaterThanOrEqual(Math.hypot(cx! - x!, cy! - y!) - 1e-9);
      }
    }
  });
});

describe('trailing rings', () => {
  it('each ring lags 9% of max radius behind the one ahead of it', () => {
    const rMax = 1000;
    const p = 1;
    expect(ringRadius(p, rMax, 0)).toBe(1000);
    expect(ringRadius(p, rMax, 1)).toBe(910);
    expect(ringRadius(p, rMax, 2)).toBe(820);
  });

  it('never produces a negative radius early in the animation', () => {
    for (let i = 0; i < RING_COUNT; i++) {
      expect(ringRadius(0, 800, i)).toBeGreaterThanOrEqual(0);
      expect(ringRadius(0.01, 800, i)).toBeGreaterThanOrEqual(0);
    }
  });

  /*
   * These rings are the ONLY visible part of the wavefront — the veil is near enough the
   * colour the screens sit on to be imperceptible. The old curve was `(1 - p) * base`, which
   * had the leading ring down to 42% opacity by the halfway mark and effectively gone well
   * before it arrived. That is most of why the transition read as a stutter rather than a
   * sweep, so the shape below is load-bearing rather than decorative.
   */
  it('holds full brightness across the first three quarters of the journey', () => {
    expect(ringOpacity(0.3, 0)).toBeCloseTo(0.85);
    expect(ringOpacity(0.5, 0)).toBeCloseTo(0.85);
    expect(ringOpacity(0.75, 0)).toBeCloseTo(0.85);
  });

  it('fades over the last quarter and is fully gone on arrival', () => {
    expect(ringOpacity(0.88, 0)).toBeLessThan(0.85);
    expect(ringOpacity(0.88, 0)).toBeGreaterThan(0);
    for (let i = 0; i < RING_COUNT; i++) {
      expect(ringOpacity(1, i)).toBeCloseTo(0);
    }
  });

  /*
   * The bug this function had for two rounds of tuning: RippleNav passed the LEADING edge's
   * progress for all three rings, so they shared the leader's fade schedule regardless of where
   * they actually were. Each ring is now given its own lagged position, and the argument that
   * this is the right call is simply that a ring 18% further back is 18% less far along — its
   * fade should be too. Asserting the shape here is what keeps the call site honest.
   */
  it('is a function of one ring OWN travel, so a lagged ring is not dimmed early', () => {
    // Two rings at the same real position are equally far through their own fade, whatever
    // their index — the index only sets base brightness, never the schedule.
    const leaderAtThreeQuarters = ringOpacity(0.75, 0) / 0.85;
    const thirdRingAtThreeQuarters = ringOpacity(0.75, 2) / 0.28;
    expect(leaderAtThreeQuarters).toBeCloseTo(thirdRingAtThreeQuarters);
  });

  it('appears from the fingertip rather than switching on', () => {
    expect(ringOpacity(0, 0)).toBe(0);
    expect(ringOpacity(0.04, 0)).toBeCloseTo(0.425);
    expect(ringOpacity(0.08, 0)).toBeCloseTo(0.85);
  });

  it('orders rings front-to-back', () => {
    expect(ringOpacity(0.3, 0)).toBeGreaterThan(ringOpacity(0.3, 1));
    expect(ringOpacity(0.3, 1)).toBeGreaterThan(ringOpacity(0.3, 2));
  });
});

describe('waveEase', () => {
  it('is pinned at both ends and clamps outside [0,1]', () => {
    expect(waveEase(0)).toBe(0);
    expect(waveEase(1)).toBe(1);
    expect(waveEase(-5)).toBe(0);
    expect(waveEase(5)).toBe(1);
  });

  it('still eases out, because coverage grows with the square of the radius', () => {
    expect(waveEase(0.5)).toBeGreaterThan(0.5);
  });

  /*
   * The whole point of replacing the prototype's curve. Its 1-(1-t)^2.6 was 51% travelled a
   * quarter of the way through and 83% at the halfway mark, so over a 440ms expand the visible
   * wave crossed most of the screen in about a tenth of a second and then crawled. This is the
   * difference between "a sweep" and "a flinch followed by a stall".
   */
  it('leaves real travel in the second half, unlike the prototype curve', () => {
    expect(waveEase(0.25)).toBeLessThan(rippleEase(0.25));
    expect(waveEase(0.5)).toBeLessThan(rippleEase(0.5));
    expect(waveEase(0.5)).toBeLessThan(0.8);
  });

  it('increases monotonically', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const value = waveEase(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('veilDrift', () => {
  it('does nothing until the dissolve starts', () => {
    expect(veilDrift(0)).toBe(1);
  });

  it('drifts outward as it fades, which is the depth cue the content scale used to give', () => {
    expect(veilDrift(1)).toBeCloseTo(1.07);
    expect(veilDrift(0.5)).toBeGreaterThan(1);
    expect(veilDrift(0.5)).toBeLessThan(veilDrift(1));
  });
});

describe('the motion token', () => {
  // `duration` is written out rather than derived, because a getter would not survive being
  // captured into a Reanimated worklet. This is what stops it drifting from its parts.
  it('total duration equals the three beats it is made of', () => {
    expect(motion.ripple.duration).toBe(
      motion.ripple.cover + motion.ripple.hold + motion.ripple.dissolve,
    );
  });

  /*
   * The back-slide in `(app)/_layout.tsx` is pinned at 300ms and plays underneath the opaque
   * veil. If the hold were ever retuned shorter than it, the incoming screen would still be
   * sliding when the veil began dissolving — which is the exact stutter that made
   * `animation: 'none'` the original choice. Coupling them here means that trade-off cannot be
   * broken silently by someone tuning the ripple alone.
   */
  it('holds long enough to hide the 300ms native back-slide', () => {
    expect(motion.ripple.hold).toBeGreaterThanOrEqual(300);
  });
});

describe('outgoing layer', () => {
  it('lands exactly on the prototype end state', () => {
    expect(outgoingBlur(0)).toBe(0);
    expect(outgoingBlur(1)).toBeCloseTo(3.2);
    expect(outgoingScale(0)).toBe(1);
    expect(outgoingScale(1)).toBeCloseTo(0.982);
  });
});
