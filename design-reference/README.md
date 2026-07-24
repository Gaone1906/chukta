# Design reference

The visual source of truth for Hisaab. These are **prototype exports, not application code** —
nothing here ships. Read them for exact colors, spacing, blur radii, shadow stacks, easing
curves and animation keyframes while porting each screen to React Native.

## Viewing them

The screens are static HTML but load sibling files, so `file://` won't work. Serve the folder:

```bash
python3 -m http.server 8080 --directory design-reference
```

Then open `http://localhost:8080/screens/Hisaab%20Home.dc.html`. Each screen renders inside a
390×844 iPhone frame. Some files (`Hisaab Add Expense`, `Hisaab Transition`) are multi-frame
documentation boards rather than single screens.

## Layout

```
screens/     20 .dc.html exports covering 17 screens + the ripple motion spec
  support.js   vendored prototype runtime (see below)
assets/      shared brand assets and web components
```

| Asset | What it is | Ships? |
|---|---|---|
| `hisaab-stamp.png` (1024², RGBA) | Circular wax-seal mark, texture baked in | Yes — but needs an **opaque, optically simplified** variant for the app icon. iOS rejects alpha, and the inner dotted ring disappears below ~120px. |
| `hisaab-mark.png` (1280×416, RGBA) | Rectangular ink-stamp wordmark | Yes, as-is |
| `hisaab-stamp.svg`, `hisaab-mark.svg` | Vector source | Not directly. Text is un-outlined (falls back to a generic serif without the webfonts) and the hand-pressed texture is `feTurbulence`/`feDisplacementMap`, which no native vector format supports. Needs a designer pass to outline text and bake the noise. |
| `hisaab-seal.js` | Animated seal: 1.05s spinner → stamp landing | Reimplement natively; keyframes are in the file |
| `hisaab-ripple.js` | The screen transition primitive | Reimplement natively; fully specified |
| `hisaab-row.js` | Glass list row + balance chip | Reimplement natively |
| `hisaab-mark.js` | Wordmark as inline SVG | Use the PNG instead — the SVG filters have no cheap native equivalent |

## Vendored files — not ours, not ported

- **`screens/support.js`** — the `DCLogic`/`x-dc` prototype runtime that every `.dc.html`
  file depends on. Generated, marked "do not edit". Tracked only so the screens render.
- **`assets/image-slot.js`** — a generic image-placeholder component from an unrelated
  starter kit, used only by `Hisaab Settle Up` for the (empty) UPI app icons. Those icons are
  replaced at runtime by real installed-app icons, so this is never ported.

## Known gaps

These screens do not exist and must be designed before they can be built: expense detail,
edit expense, date picker, "who paid" picker, group members/settings, edit profile,
delete-account confirmation, receipt viewer, recurring-expense setup, currency picker — plus
**every empty state and every error state**, of which there are currently none anywhere.

The three search inputs (picker ×2, Add friend) are decorative — no `onChange` handler.

Version strings differ between screens (1.0.0 vs 1.0.3); both are placeholder text.
