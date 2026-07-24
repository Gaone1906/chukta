# Clickable prototype

Walks the real flows through the original design screens, with the designed ripple
transition between them. Useful for getting a feel for the app before Phase 1 starts, and for
finding flow problems that static screens hide.

```bash
npm run design-reference
```

Then open **http://localhost:8080/prototype/index.html**.

It has to be served — the screens load sibling files, so `file://` won't work.

## How it works

Each screen stays an untouched `.dc.html` document, rendered in one of two stacked iframes.
The shell does three things at runtime, injecting into the iframe rather than editing any
source file:

1. **Isolates the phone frame.** Several files are documentation boards — annotation panels
   beside the phone, or four frames demonstrating one component in different states. The
   shell finds the first 390×844 frame, pins it to the top-left, and hides everything else.
2. **Intercepts clicks.** Known buttons are matched by `aria-label` or visible text and turned
   into navigation, capturing the event so the screen's own "demo only" toast never fires.
   Home's list rows dispatch a `rowtap` event, which is intercepted the same way.
3. **Plays the ripple** between the outgoing and incoming iframe, reusing
   `assets/hisaab-ripple.js` unchanged — the same easing, the same three trailing gold rings,
   the same blur and micro-shrink on the outgoing layer.

Anything the screens already do for real — the OTP boxes, the segmented switcher, the split
preview, the accordion, the sidebar's swipe-to-close — still works, because the original
component logic is untouched.

## Things worth knowing

- **Six screens animate themselves on entry** (Settle up, Settings, Tip jar, Help, About, Add
  friend). Those swap instantly and play their own ripple; running the shell ripple on top
  would read as two overlapping transitions.
- **Validation is real, so some buttons refuse to advance.** "Send code" stays disabled until
  ten digits are entered; "Get started" needs a name. That's the prototype behaving correctly.
- **The empty-group screen has no file of its own** — it exists only as a sub-state of
  `Hisaab Add Expense`, reachable there via "+ New group".
- **`document.hidden` skips the ripple.** Browsers pause `requestAnimationFrame` in
  backgrounded tabs, so animating would stall mid-transition. Transitions also race a 1.5s
  deadline for the same reason — without it, switching tabs mid-ripple would deadlock
  navigation permanently.

## Taps that go nowhere

Usually because the screen was never designed. The big ones: **expense detail** (every expense
row in Group and Person detail), edit expense, the date and "who paid" pickers, group
members/settings, and **every empty state and every error state** — there are none anywhere in
the design set.

Full list in [`../../plan/phase-10-states-polish.md`](../../plan/phase-10-states-polish.md).

## Changing the wiring

Everything is in `prototype.js`:

- `SCREENS` — the registry, and which screens self-animate
- `ROUTES` — per-screen click targets. `'@Label'` matches an `aria-label`; anything else
  matches from the start of the button's visible text
- `FALLBACK_BACK` — where a back chevron goes when there's no history to pop
- `NOTES` — the right-hand panel copy
