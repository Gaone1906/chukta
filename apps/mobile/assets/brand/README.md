# Brand assets

- `chukta-stamp.png` — 1024×1024 RGBA circular seal. Used for brand moments only (onboarding,
  the completion screen, About). **Not** the settled indicator on list rows — that's a plain
  gold checkmark badge, deliberately, to keep the stamp special.
- `chukta-mark.png` — 1280×416 RGBA wordmark. The everyday logo (Home header, Sidebar).

## Launcher icons — generated, in `../icon/`

Built from `chukta-stamp.png` with a small CoreGraphics compositor (`sips` cannot flatten an
alpha channel; it converts and pads but keeps the channel).

| File | Alpha | Art size | Why |
|---|---|---|---|
| `icon.png` | **no** | 86% | iOS rejects transparency outright. Square and un-rounded — iOS masks it itself |
| `adaptive-foreground.png` | yes | 62% | Only the centre 72 of an adaptive icon's 108dp survives every launcher mask |
| `adaptive-monochrome.png` | yes | 62% | Android 13+ themed icons; flat white, system recolours it |
| `notification-icon.png` | yes | 92% | Android draws notification icons as a silhouette and discards colour |
| `splash-icon.png` | yes | 55% | Launch screen, on `bgBase` |

**Generate from the PNG, never the SVG.** `chukta-stamp.svg` sets the wordmark in Rozha One,
which lives in `node_modules` rather than in system fonts — so QuickLook, a headless browser, or
anything else rasterising it here silently falls back to a different serif and produces an icon
whose wordmark does not match the app's own. Checked: `fc-list` finds no Rozha One or Hind.

## Still needed

**An optically simplified small-size seal.** The micro-text (`SQUARED · SETTLED`, `NO AWKWARD
ASKING`) and the dotted ring turn to illegible smudge below ~120px, which is most of where a
launcher icon lives. Verified by downscaling and magnifying: `CHUKTA` and the outer ring still
read well, the micro-text does not.

This is **design work, not scripting**, and the reason is worth recording so nobody burns an
afternoon on it: the obvious fix is to mask out the annulus containing the micro-text, but
`CHUKTA` is set at 21pt with 2.4 letter-spacing and its outermost glyphs reach r≈49 in the 132
viewBox — straight through the same annulus as the arc text at r≈45–56. A radial mask that
removes the micro-text clips the C and the A off the wordmark.

The clean version is an SVG edit: drop lines 19–21 of `chukta-stamp.svg` (dotted ring, both
`textPath`s), thicken the remaining strokes, re-render **with Rozha One actually installed**.

Fonts (Rozha One, Hind) load from `@expo-google-fonts/*`, not from `assets/fonts/` — that
folder exists only for any custom faces added later.
