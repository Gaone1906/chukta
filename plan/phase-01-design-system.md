# Phase 1 — Design system & motion

**Status:** ⬜ not started · **Estimate:** 1 week · **Depends on:** Phase 0

## Goal

Build the primitives every screen is made of, so that Phases 4–7 are assembly rather than
invention. At the end of this phase there should be a "kitchen sink" route rendering every
primitive in every state, side by side with the prototype, on both platforms.

## Why this comes first

The design is unusually material-heavy — glass, blur, gradient blobs, a signature transition.
If those primitives are built per-screen, they will drift. Building them once, first, is also
the only way to catch the Android blur performance problem early enough to react to it.

## Work

### 1. Tokens — `apps/mobile/src/design/tokens.ts`

Straight from `docs/design-doc.md` and verified against the prototypes:

| Token | Value |
|---|---|
| `bgBase` | `#0A0405` (prototypes use `#050203` for the page behind the phone frame) |
| `bgRadial` | `radial-gradient(120% 76% at 50% 18%, #2A1216, #150A0C 46%, #0A0405)` |
| `oxblood` | `#7A2833` |
| `goldLeaf` | `#B8963C` |
| `goldBright` | `#D9B65A` |
| `textHighlight` | `#D9B25C` |
| `cream` | `#F4EDE4` |
| `glassFill` | `rgba(255,255,255,0.05)` |
| `glassBorder` | `rgba(255,255,255,0.12)` |
| `glassBlur` | 22–24px, saturate 130–180% |
| `shadowGlass` | `0 8px 28–32px rgba(0,0,0,0.45)` |
| inner highlight | `inset 0 1px 0 rgba(255,255,255,0.18–0.22)` |

Dark mode only — no light variant, permanently.

### 2. Fonts — `apps/mobile/src/design/fonts.ts`

`@expo-google-fonts/rozha-one` (display: wordmark, screen titles **only**) and
`@expo-google-fonts/hind` at 300/400/500/600 (all body text, all labels, and critically
**every amount**). Both SIL OFL, safe to bundle. Load via `useFonts` with the splash screen
held until ready.

The display/body split is a usability decision, not decoration: decorative faces misread
numbers, and a misread amount in a finance app is a real failure.

### 3. `GlassSurface` — the load-bearing primitive

One component, three backends, chosen at runtime:

1. **iOS 26+** — `expo-glass-effect` (native Liquid Glass; already in the template)
2. **iOS < 26 and Android 12+** — `expo-blur`, with `experimentalBlurMethod="dimezisBlurView"`
   on Android
3. **Fallback / low-end** — semi-opaque fill, no blur

Props: `intensity`, `tint`, `radius`, `bordered`, `elevated`. **Must** expose a single
app-level switch that forces backend 3 everywhere.

> ⚠️ Android blur is the biggest fidelity risk in the project. Test on a real low-end device
> **this phase**, not in Phase 10. Cap the number of simultaneously blurred surfaces per
> screen; the Home list has 5+ glass rows plus a segmented control plus a FAB.

### 4. Components

Ported from `design-reference/assets/` — exact specs are in those files.

- `AmbientBackground` — the radial gradient plus four drifting blurred color blobs
  (18s/22s/26s/30s loops). One instance at the root, not per screen.
- `Row` / `BalanceChip` — from `hisaab-row.js`. Glass card, radius 22 (compact 20), avatar
  tones oxblood/gold/plain, owe = oxblood chip + "You owe", owed = gold chip + "Owes you",
  settled = 30px gold check badge replacing the amount entirely. **Not** the stamp mark — the
  stamp is reserved for branding moments.
- `SegmentedSwitcher` — gold thumb sliding on `cubic-bezier(.35,0,.2,1)` over 340ms.
- `GlassButton` — primary (gold-filled), secondary (outlined glass); press state
  `scale(.982)` plus a gold ring.
- `FAB` — 62px, gold-tinted glass, `scale(.94)` on press, its own shadow + gold glow.
- `Seal` — from `hisaab-seal.js`. Spinner (1.05s linear, gold arc) → stamp landing. Exact
  keyframes: `760ms cubic-bezier(.2,.85,.25,1)`, opacity 0→1, scale 1.5→.965→1.014→1,
  rotate −9°→1.5°→−.6°→0, blur 6px→0; concurrent halo ring 900ms ease-out, scale .7→1.5,
  opacity 0→.55→0. Use `chukta-stamp.png` for the artwork itself, animate the container.
- `Toast` — the prototypes' universal feedback element; becomes the real one.

### 5. The ripple transition — `apps/mobile/src/design/motion/Ripple.tsx`

The app's general screen-change pattern, not just add-expense. Spec from `hisaab-ripple.js`:

- Easing `p = 1 - (1-t)^2.6`, duration 900–950ms
- `rMax` = furthest distance from tap origin to a screen corner; `r = p * rMax`
- **Incoming** revealed by a circular mask at the origin → `@react-native-masked-view` with a
  Reanimated circle
- **Outgoing** blurs to 3.2px, saturation → 0.75, scale → 0.982. Implement the blur with
  `Animated.createAnimatedComponent(BlurView)` driving `intensity` 0→8 via `animatedProps`
- **Three trailing rings**, 1px `rgba(184,150,60,.55)`, blurred 0.4/1.2/2.4px, radii lagging
  `i * rMax * 0.09`, opacities `max(0, 1-p) × [0.85, 0.5, 0.28]`
- Honour `prefers-reduced-motion` → instant swap, no rings

Note `hisaab-ripple.js` documents a `reverse` option that is **never implemented** — the back
direction needs building, not porting.

Wire it into `expo-router` via a transition-origin store (Zustand): pressing the FAB records
the tap point, the navigator reads it.

### 6. Kitchen sink — `apps/mobile/app/_dev/kitchen-sink.tsx`

Every primitive, every state, dev-only route. This is the acceptance artifact.

## Acceptance criteria

- Kitchen sink renders on iOS and on a low-end Android device
- Glass surfaces are visually within tolerance of the prototype at 1×
- Ripple runs at 60fps on both; degraded path verified by forcing the fallback backend
- Fonts load with no flash of system font
- Reduced-motion setting removes ripple, blob drift, and seal animation

## Verification

```bash
npm run design-reference   # side-by-side reference at http://localhost:8080/screens/
npm run android            # kitchen sink on device
```
