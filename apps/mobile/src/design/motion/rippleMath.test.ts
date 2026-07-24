import { describe, expect, it } from 'vitest';

import {
  RING_COUNT,
  maxRadius,
  outgoingBlur,
  outgoingScale,
  ringOpacity,
  ringRadius,
  rippleEase,
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

  it('fades rings out linearly in raw progress, fully gone at the end', () => {
    expect(ringOpacity(0, 0)).toBeCloseTo(0.85);
    expect(ringOpacity(0.5, 0)).toBeCloseTo(0.425);
    for (let i = 0; i < RING_COUNT; i++) {
      expect(ringOpacity(1, i)).toBe(0);
    }
  });

  it('orders rings front-to-back', () => {
    expect(ringOpacity(0, 0)).toBeGreaterThan(ringOpacity(0, 1));
    expect(ringOpacity(0, 1)).toBeGreaterThan(ringOpacity(0, 2));
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
