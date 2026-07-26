# Phase 0 — Repository & scaffold

**Status:** ✅ done · **Estimate:** 2–3 days

## Goal

Get the design handover under version control, restructure it into a working monorepo, and
stand up empty-but-wired scaffolds for the app, the shared money package, and the database —
so that every later phase has a place to put its files and a CI job that checks them.

## What was done

- `git init`; first commit preserves the handover byte-for-byte, so the original artifacts
  stay recoverable no matter what happens later.
- Restructure: `docs/design-doc.md`, `design-reference/{screens,assets}/`, `plan/`, `legal/`.
  Asset references inside the 20 `.dc.html` files rewritten `./assets/` → `../assets/`.
- `.gitignore` — OS junk, node, Expo/`prebuild` output, signing material (`*.p8`, `*.p12`,
  `*.keystore`), secrets (`.env*`, `google-services.json`, `GoogleService-Info.plist`),
  build/test output. `apps/mobile/modules/` is deliberately **not** ignored.
- npm workspaces: `apps/mobile` (Expo SDK 57 / RN 0.86), `packages/core`, `supabase/`.
- GitHub Actions: typecheck, lint, test on push and PR.
- `legal/terms.md`, `legal/privacy.md` drafted.
- Private repo `Gaone1906/chukta`, pushed.

## Deviations from the original plan

**Kept `support.js` and `image-slot.js`.** The plan said delete them as prototyping-tool
infrastructure. They are — but they're also what makes the reference screens render in a
browser, and the plan's own verification step calls for side-by-side fidelity comparison
against them. Keeping ~130KB of vendored runtime is cheaper than losing that. Both are
labelled as third-party and never-ported in `design-reference/README.md`.

## Notes for later phases

- **`expo-glass-effect` is in the default SDK 57 template.** It wraps Apple's native Liquid
  Glass API — which is precisely the material this design targets ("Apple Liquid Glass style"
  in the design doc). Phase 1 should prefer it on iOS 26+ and fall back to `expo-blur`
  elsewhere and on Android, rather than using `expo-blur` everywhere.
- Xcode is **not installed** (Command Line Tools only). Not blocking until Phase 4 needs an
  iOS dev build. Android Studio + SDK are present.
- Apple Developer Program and Google Play enrolment are not done. Blocks Sign in with Apple
  (Phase 4) and submission (Phase 11), nothing earlier.

## Verification

```bash
npm install && npm run typecheck && npm run test
npm run design-reference        # then open http://localhost:8080/screens/
gh repo view Gaone1906/chukta
git log --oneline
```

Confirm `git ls-files | grep -E '\.env|\.p8|\.p12|keystore'` returns nothing.
