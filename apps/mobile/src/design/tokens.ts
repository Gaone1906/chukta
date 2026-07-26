/**
 * Design tokens for Chukta.
 *
 * Values come from docs/design-doc.md, cross-checked against the actual prototype exports in
 * design-reference/screens/ — where the two disagreed, the prototypes won, because those are
 * what the screens were signed off looking like.
 *
 * Dark mode only. That is a permanent decision, not a placeholder: there is no light variant
 * and nothing here should grow a `colorScheme` branch.
 */

export const color = {
  /** App background. The prototypes use #050203 for the page *behind* the phone frame. */
  bgBase: '#0A0405',
  bgDeep: '#050203',

  /** Ambient radial glow stops, painted behind every glass panel. */
  glowInner: '#2A1216',
  glowMid: '#150A0C',
  glowOuter: '#0A0405',

  /** Primary accent: borders, pending balances, secondary buttons. */
  oxblood: '#7A2833',
  /** Primary CTA fill, active states, settled badges. */
  goldLeaf: '#B8963C',
  /** Brighter gold for strokes and iconography that needs to read at small sizes. */
  goldBright: '#D9B65A',
  /** High-emphasis numbers on dark glass. */
  textHighlight: '#D9B25C',

  cream: '#F4EDE4',
  creamWarm: '#F6E9CB',
  creamRose: '#F6DADE',

  /*
   * The text ramp, every step of which now meets WCAG AA (4.5:1).
   *
   * The old comment here said "anything below `textMuted` fails AA on glass", which was both a
   * known-broken state left in place and **wrong about where the line was**. Measured against
   * the worst background in the app — `glassFill` over the warm centre of the ambient glow,
   * roughly #2C1519 — the real figures were:
   *
   *     textMuted  0.45 → 4.24   (fails, and the comment claimed it passed)
   *     textFaint  0.32 → 2.85
   *     textGhost  0.22 → 2.04
   *
   * Ratios below are against that same worst case, so every other surface is better. The named
   * colours were measured too and all pass untouched — `textHighlight`, which every amount in
   * the app is drawn in, is 7.70.
   *
   * The bottom three are close together now, and that is the honest shape: they used to be
   * spread across a range where the differences were only visible because the text was too dim
   * to read. `textGhost` is also the placeholder colour, so placeholders are more prominent
   * than they were — fields keep their own uppercase label above them, which is what should
   * distinguish an empty field anyway, rather than the hint being too faint to see.
   */
  textPrimary: 'rgba(255,255,255,0.90)',   // 12.68:1
  textSecondary: 'rgba(255,255,255,0.62)', //  6.79:1
  textMuted: 'rgba(255,255,255,0.56)',     //  5.79:1
  textFaint: 'rgba(255,255,255,0.50)',     //  4.89:1
  textGhost: 'rgba(255,255,255,0.47)',     //  4.52:1

  glassFill: 'rgba(255,255,255,0.05)',
  glassFillRaised: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.12)',
  glassBorderActive: 'rgba(184,150,60,0.55)',
  glassHighlight: 'rgba(255,255,255,0.18)',

  /** Opaque stand-ins used when blur is disabled. Tuned to sit where the blurred glass sits. */
  glassFallback: 'rgba(38,20,24,0.92)',
  glassFallbackRaised: 'rgba(52,28,33,0.94)',

  /*
   * The ripple's veil, and the gold of its trailing rings.
   *
   * The veil is deliberately ALMOST `bgBase` and not exactly it. Being the ground colour is
   * what hides the seam when it dissolves onto the incoming screen — but it also made the
   * sweep invisible, and an invisible sweep is indistinguishable from a stutter. A couple of
   * points of lift reads as a surface passing over the screen and still shows no edge as it
   * goes.
   */
  veil: '#100709',
  rippleRing: 'rgba(201,166,74,0.6)',

  oweFill: 'rgba(122,40,51,0.45)',
  oweBorder: 'rgba(122,40,51,0.85)',
  owedFill: 'rgba(184,150,60,0.20)',
  owedBorder: 'rgba(184,150,60,0.70)',
} as const;

export const radius = {
  chip: 13,
  card: 22,
  cardCompact: 20,
  panel: 28,
  sheet: 30,
  pill: 999,
  frame: 44,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
} as const;

/** Blur is expensive on Android; see GlassSurface for how these degrade. */
export const blur = {
  subtle: 18,
  card: 22,
  panel: 24,
} as const;

export const shadow = {
  glass: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  row: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  fab: {
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
} as const;

/**
 * Two families, split on purpose. Rozha One is for the wordmark and screen titles ONLY;
 * every number — every balance, every amount — is Hind. Decorative faces misread digits, and
 * a misread amount in a finance app is a real failure, not an aesthetic quibble.
 */
export const font = {
  display: 'RozhaOne_400Regular',
  light: 'Hind_300Light',
  regular: 'Hind_400Regular',
  medium: 'Hind_500Medium',
  semibold: 'Hind_600SemiBold',
} as const;

export const type = {
  display: { fontFamily: font.display, fontSize: 34, lineHeight: 42 },
  title: { fontFamily: font.display, fontSize: 27, lineHeight: 34 },
  amount: { fontFamily: font.semibold, fontSize: 15 },
  amountLarge: { fontFamily: font.semibold, fontSize: 34 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  bodyLight: { fontFamily: font.light, fontSize: 15.5, lineHeight: 22 },
  label: { fontFamily: font.medium, fontSize: 16 },
  rowTitle: { fontFamily: font.medium, fontSize: 16.5 },
  rowMeta: { fontFamily: font.light, fontSize: 13 },
  caption: { fontFamily: font.light, fontSize: 12.5, lineHeight: 19 },
  /** Small-caps-ish eyebrow used for section headers and balance captions. */
  eyebrow: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase' as const,
  },
} as const;

/** Timings taken from the prototype keyframes so motion matches the design exactly. */
export const motion = {
  /*
   * The ripple, split into its three beats rather than one number.
   *
   * The old single `duration: 900` hid the real problem: half of it went to the expand, and
   * the curve applied inside it had spent 83% of the travel by the halfway mark — so the only
   * visible motion was over in about a tenth of a second and the rest was an opaque veil
   * holding and fading. Naming the beats is what makes that reviewable.
   *
   * `hold` is the window the incoming screen has to mount before it can be seen. The trailing
   * rings are still travelling through it on purpose.
   *
   * ---------------------------------------------------------------- why these numbers moved
   *
   * `expand` became `cover`, and shed 120ms to `hold`. The rename is the point: nothing here
   * "expands" for 440ms — the veil finishes covering the screen at `cover`, and what carries
   * the remaining time is the rings crossing it. Calling the beat after its own job is what
   * stops the next person retuning the wrong one, which has now happened twice.
   *
   * `hold` doubling to 360 also gives the native back-slide (`animationDuration: 300` in
   * `(app)/_layout.tsx`) room to finish underneath the opaque veil with 60ms to spare, so the
   * push never peeks out from beneath the dissolve.
   */
  ripple: {
    cover: 320,
    hold: 360,
    dissolve: 220,
    /**
     * The whole transition, for anything that needs one number. Written out rather than
     * derived with a getter: this object is small enough to be captured into a Reanimated
     * worklet, and a getter would not survive the trip into the UI runtime intact.
     * `rippleMath.test.ts` asserts it equals the sum, so it cannot drift.
     */
    duration: 900,
    easeExponent: 2.6,
  },
  seal: { spinner: 1050, stamp: 760, halo: 900, holdBeforeStamp: 1500 },
  segmented: { duration: 340 },
  press: { duration: 160 },
  fade: { duration: 240 },
  toast: { duration: 320, visibleFor: 2200 },
} as const;

export const layout = {
  /** The prototypes are all drawn at iPhone 14 Pro size; used for motion math and the sink. */
  designWidth: 390,
  designHeight: 844,

  /**
   * Minimum interactive size. Apple asks for 44pt, Material for 48dp; 44 satisfies the stricter
   * reading of the first and is what the design was drawn against.
   *
   * **This is about BOUNDS, not `hitSlop`.** `hitSlop` genuinely enlarges the tappable region —
   * it is not a lie — but it is invisible to Android's Accessibility Scanner and to Xcode's
   * Accessibility Inspector, both of which measure the view's own frame. More importantly it is
   * invisible to a person with a tremor looking for something to aim at: a 24pt icon with 20pt
   * of slop around it still *looks* like a 24pt target.
   *
   * Where a control needs to stay visually small, the pattern is a `touchTarget`-sized
   * Pressable centring a smaller decorated View — bounds and appearance decoupled, rather than
   * the button growing.
   */
  touchTarget: 44,
} as const;

/**
 * The soft edge where scrolling content meets the status bar or the pinned footer.
 * Consumed only by `components/EdgeVignette.tsx`, which explains the technique in full.
 *
 * `intensity` is per LAYER and is deliberately low: the layers overlap and a
 * `UIVisualEffectView` samples its siblings, so the blur compounds. Raising this instead of
 * `layers` is the wrong knob — it flattens the ramp back into one evenly-frosted rectangle,
 * which is the exact artefact this component exists to avoid.
 */
export const vignette = {
  /** How many masked blur layers. More is a smoother ramp and more compositing. */
  layers: 6,
  /** Per layer, not cumulative. See above. */
  intensity: 9,
  /** Extra height past the safe-area inset, so the fade completes below the island. */
  overhang: 26,
  /**
   * Clusters the layer stops toward the edge. 1 is linear and leaves a visible shoulder where
   * the last layer ends; above 1 pushes the falloff outward, which is where the eye is.
   */
  curve: 1.6,
  /** Fraction of each layer's reach that stays fully opaque before its ramp begins. */
  softness: 0.42,

  /*
   * The dim half. Apple's scroll edge effect blurs AND dims, and blur alone is not enough
   * here — the design is light text on a dark ambient wash, and blurring bright text without
   * darkening it just smears something that is still clearly legible.
   *
   * `bgBase` rather than pure black, so the vignette reads as the app's own ground colour
   * coming forward rather than as a grey haze laid over it.
   */
  tintStrong: 'rgba(10,4,5,0.62)',
  tintMid: 'rgba(10,4,5,0.22)',
  tintNone: 'rgba(10,4,5,0)',
} as const;
