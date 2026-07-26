# Brand assets

- `chukta-stamp.png` — 1024×1024 RGBA circular seal. Used for brand moments only (onboarding,
  the completion screen, About). **Not** the settled indicator on list rows — that's a plain
  gold checkmark badge, deliberately, to keep the stamp special.
- `chukta-mark.png` — 1280×416 RGBA wordmark. The everyday logo (Home header, Sidebar).

## Still needed (Phase 11)

The App Store icon **cannot** be `chukta-stamp.png` as-is:

- iOS rejects icons with an alpha channel — needs compositing onto the dark background
- iOS applies its own rounded-square mask, so the source must be square and un-rounded
- The inner dotted ring (`dasharray 1.5 3.5`) disappears below ~120px — the small-size icon
  needs an optically simplified variant with that ring dropped and strokes thickened

Fonts (Rozha One, Hind) load from `@expo-google-fonts/*`, not from `assets/fonts/` — that
folder exists only for any custom faces added later.
