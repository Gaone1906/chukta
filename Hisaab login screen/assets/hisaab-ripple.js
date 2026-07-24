/* hisaab-ripple.js — water-ripple screen transition (reusable).
 *
 *   <script src="hisaab-ripple.js"></script>
 *
 *   // reveal `incoming` over `outgoing`, ripple originating at the tap point
 *   HisaabRipple.play({
 *     incoming: nextScreenEl,     // absolutely positioned, same box as outgoing
 *     outgoing: currentScreenEl,  // gets a soft blur + micro-shrink while covered
 *     origin: { x, y },           // px, relative to the stage box (use the tap point)
 *     stage: frameEl,             // element the ripple is measured against
 *     duration: 900,              // ms
 *     reverse: false              // true when going "back" (same motion, reverse feel)
 *   }).then(() => { ... });
 *
 * The incoming layer is revealed by a growing circular clip-path; three trailing
 * gold-leaf rings ride the wavefront, and the outgoing layer blurs and eases back
 * so the old screen reads as dissolving under water rather than sliding away.
 * Honours prefers-reduced-motion (instant swap, no ripple).
 */
(function (global) {
  const EASE = t => 1 - Math.pow(1 - t, 2.6);

  function maxRadius(w, h, x, y) {
    return Math.max(
      Math.hypot(x, y), Math.hypot(w - x, y),
      Math.hypot(x, h - y), Math.hypot(w - x, h - y)
    );
  }

  function ringLayer(stage) {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:9;overflow:hidden";
    stage.appendChild(el);
    const rings = [0, 1, 2].map(i => {
      const r = document.createElement("div");
      r.style.cssText = "position:absolute;border-radius:50%;border:1px solid rgba(184,150,60,.55);transform:translate(-50%,-50%);filter:blur(" + (i ? i * 1.2 : 0.4) + "px)";
      el.appendChild(r);
      return r;
    });
    return { el, rings };
  }

  function frame(state, t) {
    const { origin, rMax, incoming, outgoing, rings } = state;
    const p = EASE(Math.min(1, t));
    const r = p * rMax;
    incoming.style.clipPath = `circle(${r}px at ${origin.x}px ${origin.y}px)`;
    incoming.style.webkitClipPath = incoming.style.clipPath;
    if (outgoing) {
      outgoing.style.filter = `blur(${(3.2 * p).toFixed(2)}px) saturate(${(1 - 0.25 * p).toFixed(2)})`;
      outgoing.style.transform = `scale(${(1 - 0.018 * p).toFixed(4)})`;
    }
    rings.forEach((ring, i) => {
      const rr = Math.max(0, r - i * rMax * 0.09);
      const fade = Math.max(0, 1 - p) * (i === 0 ? 0.85 : i === 1 ? 0.5 : 0.28);
      ring.style.width = ring.style.height = rr * 2 + "px";
      ring.style.left = origin.x + "px";
      ring.style.top = origin.y + "px";
      ring.style.opacity = fade.toFixed(3);
    });
  }

  const HisaabRipple = {
    play(opts) {
      const stage = opts.stage || (opts.incoming && opts.incoming.parentElement);
      const incoming = opts.incoming;
      const outgoing = opts.outgoing || null;
      const box = stage.getBoundingClientRect();
      const origin = opts.origin || { x: box.width / 2, y: box.height / 2 };
      const duration = opts.duration || 900;
      const reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

      incoming.style.position = incoming.style.position || "absolute";
      incoming.style.zIndex = incoming.style.zIndex || "8";
      incoming.style.willChange = "clip-path";

      if (reduced) {
        incoming.style.clipPath = "none";
        if (outgoing) outgoing.style.visibility = "hidden";
        return Promise.resolve();
      }

      const { el, rings } = ringLayer(stage);
      const state = { origin, rMax: maxRadius(box.width, box.height, origin.x, origin.y), incoming, outgoing, rings };
      frame(state, 0);

      return new Promise(resolve => {
        const t0 = performance.now();
        const step = now => {
          const t = (now - t0) / duration;
          frame(state, t);
          if (t < 1) requestAnimationFrame(step);
          else {
            incoming.style.clipPath = "none";
            incoming.style.willChange = "";
            if (outgoing) { outgoing.style.filter = ""; outgoing.style.transform = ""; }
            el.remove();
            resolve();
          }
        };
        requestAnimationFrame(step);
      });
    },

    /* convenience: read the tap point off an event, relative to `stage` */
    originFromEvent(e, stage) {
      const b = stage.getBoundingClientRect();
      const x = (e.clientX != null ? e.clientX : b.left + b.width / 2) - b.left;
      const y = (e.clientY != null ? e.clientY : b.top + b.height / 2) - b.top;
      return { x, y };
    }
  };

  global.HisaabRipple = HisaabRipple;
})(window);
