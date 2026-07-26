# Launcher icons

Design direction **1A "Pressed seal"**, chosen from the five in the `Chukta App Icon` design
doc: a gold ring and a single Rozha One **C** on the oxblood radial. The circular *seal* with the
full wordmark stays reserved for brand moments (splash, onboarding, About) — the icon is the
short mark.

| File | Alpha | Art | Used as |
|---|---|---|---|
| `icon.png` | **no** | 67% | iOS + the base icon. Transparency is an outright App Store rejection |
| `adaptive-foreground.png` | yes | 62% | Android adaptive foreground |
| `adaptive-background.png` | no | — | The oxblood radial, as a real gradient |
| `adaptive-monochrome.png` | yes | 62% | Android 13+ themed icons; flat white, system recolours |
| `notification-icon.png` | yes | 90% | Android draws these from the alpha channel and discards colour |
| `splash-icon.png` | yes | 55% | Launch screen — still the **full seal**, a brand moment |

## Which variant became the master, and why

The design doc gives two cells per direction, at 180px and at 60px, and they are **not** the same
drawing. The 180px cell uses a 3.4 stroke plus a second ring at r=50; the 60px cell drops the
inner ring, thickens the stroke to 5, and enlarges the C from 52 to 56.

Both were rendered at 1024, downscaled to 60px and measured across the ring band:

| Variant | Peak luminance @60px |
|---|---|
| Large cell (3.4 stroke, two rings) | 34.5 |
| Small cell (5 stroke, one ring) | 49.0 |
| **Shipped: small geometry + ink filter** | **51.5** |

A thin stroke averages into a dark background under downsampling, and the two rings collapse onto
each other into a muddy double line. The small geometry won on measurement, not taste.

The **ink** displacement filter was put back on top of it, and that is the one deviation from
either cell. Texture degrades gracefully where a second ring does not — it scored *higher* than
the clean small variant, because the displacement thickens the stroke in places. The **mottle**
filter stays out: it punches holes through the stroke, which is exactly what small sizes cannot
afford.

## Regenerating

Two constraints make this less obvious than it looks.

**Rozha One is not a system font.** It lives in `node_modules/@expo-google-fonts/rozha-one`, so
any rasteriser here falls back to a different serif and silently produces an icon whose C is not
the brand's C. Install it before rendering and remove it after:

```bash
cp node_modules/@expo-google-fonts/rozha-one/400Regular/RozhaOne_400Regular.ttf ~/Library/Fonts/
```

**QuickLook is the only SVG rasteriser on this machine and it always composites onto opaque
white**, so a transparent layer cannot be produced directly. `tools/unmatte.swift` recovers true
straight alpha from two renders of the same artwork, one on black and one on white:

    Pb = C·a,  Pw = C·a + (1−a)  ⇒  a = 1 − (Pw − Pb),  C = Pb / a

Both unknowns fall out with no assumption about the artwork's colour, which is what keeps the
ring's `#B8963C` and the C's `#D9B65A` distinct. Chroma-keying a background instead is wrong at
every anti-aliased edge, and on a 5-unit stroke that is most of the stroke.

`tools/make-icons.swift` does the flattening and scaling — `sips` cannot strip an alpha channel,
it converts and pads but keeps it.
