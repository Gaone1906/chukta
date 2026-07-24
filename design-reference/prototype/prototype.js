/* prototype.js — wires the design-reference screens into one clickable walkthrough.
 *
 * Each screen is a full .dc.html document rendered in an iframe. The shell:
 *   1. isolates the 390x844 phone frame inside the iframe (some files are multi-frame
 *      documentation boards with annotation panels beside the phone)
 *   2. intercepts clicks on known buttons and turns them into navigation
 *   3. plays the designed ripple transition between the two iframe layers
 *
 * The screens themselves are never modified — everything here is injected at runtime.
 */
(function () {
  'use strict';

  var SCREEN_DIR = '../screens/';

  /* ------------------------------------------------------------------ screens */

  var SCREENS = {
    login:     { file: 'Hisaab Login',        title: 'Entry',             section: 'Onboarding' },
    phone:     { file: 'Hisaab Phone',        title: 'Phone number',      section: 'Onboarding' },
    otp:       { file: 'Hisaab OTP',          title: 'Verify code',       section: 'Onboarding' },
    profile:   { file: 'Hisaab Profile',      title: 'Profile setup',     section: 'Onboarding' },
    done:      { file: 'Hisaab Done',         title: "You're all set",    section: 'Onboarding' },

    home:      { file: 'Hisaab Home',         title: 'Home',              section: 'Main' },
    group:     { file: 'Hisaab Group',        title: 'Group detail',      section: 'Main' },
    person:    { file: 'Hisaab Person',       title: 'Person detail',     section: 'Main' },
    settle:    { file: 'Hisaab Settle Up',    title: 'Settle up',         section: 'Main', selfRipple: true },

    picker:    { file: 'Hisaab Add Expense',  title: "Who's this with?",  section: 'Add an expense' },
    form:      { file: 'Hisaab Expense Form', title: 'Expense form',      section: 'Add an expense' },

    sidebar:   { file: 'Hisaab Sidebar',      title: 'Sidebar',           section: 'Behind the sidebar' },
    settings:  { file: 'Hisaab Settings',     title: 'Settings',          section: 'Behind the sidebar', selfRipple: true },
    addfriend: { file: 'Hisaab Add Friend',   title: 'Add a friend',      section: 'Behind the sidebar', selfRipple: true },
    tipjar:    { file: 'Hisaab Tip Jar',      title: 'Tip jar',           section: 'Behind the sidebar', selfRipple: true },
    help:      { file: 'Hisaab Help',         title: 'Help & feedback',   section: 'Behind the sidebar', selfRipple: true },
    about:     { file: 'Hisaab About',        title: 'About Hisaab',      section: 'Behind the sidebar', selfRipple: true }
  };

  /* What is genuinely interactive vs a dead end, per screen. Shown in the right panel so the
     prototype is honest about which taps do nothing because the screen was never designed. */
  var NOTES = {
    login:   'All three buttons work here. Apple and Google skip straight to profile setup, matching the real v1 flow — phone/OTP is designed but flag-gated off.',
    phone:   'Digit formatting and the disabled-until-valid button are real. The country code picker was never designed.',
    otp:     'Real six-box behaviour: auto-advance, backspace, arrow keys, and pasting all six digits at once. There is no invalid-code error state anywhere in the design.',
    profile: 'Name and UPI fields are real; the button unlocks past one character. The photo picker is a stub.',
    done:    'The only real loading state in the whole set — the seal spins, then stamps.',
    home:    'The Groups/People switcher and the row taps are real. Tapping a group or person opens its detail. No empty state exists for a brand-new account.',
    group:   'Fully static. Settle up and the FAB navigate. Tapping an expense row goes nowhere — the expense detail screen was never designed.',
    person:  'Fully static, and shows one settled row. Same gap: expense rows lead nowhere.',
    settle:  'The amount is editable. The UPI app icons are empty placeholders — real installed-app icons get queried at runtime in the built app.',
    picker:  'Selection is real, and mutually exclusive between a group and loose people. "+ New group" opens the empty-group screen, which only exists as a sub-state of this file.',
    form:    'The most interactive screen. The split preview genuinely recomputes per split type — but from fabricated demo weights, and it rounds each share independently, which loses a rupee on ₹100 ÷ 3. Date and payer pickers are stubs.',
    sidebar: 'Open/close and swipe-to-close are real. Every row navigates here; in the original file they all just toasted.',
    settings:'The three toggles are real. Every chevron row is a stub, and the delete-account confirmation the copy promises does not exist.',
    addfriend:'Invite buttons genuinely flip to "Invited". This screen needs rework — it is built around the address book, but v1 invites through the OS share sheet instead, so no contacts permission.',
    tipjar:  'Preset and custom amounts are real and mutually exclusive. Note the design doc calls this a non-consumable purchase, which would let someone tip only once.',
    help:    'The accordion and the send validation are real.',
    about:   'Static. The Tip jar link works.'
  };

  /* ------------------------------------------------------------------- routes */

  /* Matched in order against the nearest button/link ancestor of the click target,
     by aria-label first, then by visible text. */
  var ROUTES = {
    login:     [['Continue with Apple', 'profile'], ['Continue with Google', 'profile'], ['Continue with phone number', 'phone']],
    phone:     [['Send code', 'otp']],
    otp:       [['Verify', 'profile'], ['Edit', 'phone']],
    profile:   [['Get started', 'done']],
    done:      [['Go to your hisaab-kitaab', 'home']],
    home:      [['@Open profile', 'sidebar'], ['@Add an expense', 'picker']],
    group:     [['@Add an expense', 'form'], ['Settle up', 'settle']],
    person:    [['@Add an expense with Priya', 'form'], ['Settle up', 'settle']],
    picker:    [['Continue', 'form'], ['Create group', 'home']],
    form:      [['Save expense', 'home']],
    settle:    [['Mark as settled instead', 'home']],
    sidebar:   [['Tip jar', 'tipjar'], ['Settings', 'settings'], ['Invite friends', 'addfriend'],
                ['Help and feedback', 'help'], ['About Hisaab', 'about'],
                ['Edit profile', 'profile'], ['Sign out', 'login']],
    about:     [['Tip jar', 'tipjar']]
  };

  /* Where a "Back" chevron goes, when it is not simply the previous screen. */
  var FALLBACK_BACK = {
    phone: 'login', otp: 'phone', profile: 'login', home: 'login',
    group: 'home', person: 'home', picker: 'home', form: 'picker', settle: 'home',
    sidebar: 'home', settings: 'sidebar', addfriend: 'sidebar',
    tipjar: 'sidebar', help: 'sidebar', about: 'sidebar'
  };

  /* --------------------------------------------------------------------- dom */

  var stage = document.getElementById('stage');
  var layers = [document.getElementById('layerA'), document.getElementById('layerB')];
  var active = 0;
  var current = null;
  var history = [];
  var lastPoint = { x: 195, y: 422 };
  var navigating = false;

  var elTitle = document.getElementById('title');
  var elNotes = document.getElementById('notes');
  var elBack = document.getElementById('back');
  var elCrumb = document.getElementById('breadcrumb');

  /* ------------------------------------------------------------------ flowmap */

  (function buildFlowmap() {
    var nav = document.getElementById('flowmap');
    var seen = {};
    Object.keys(SCREENS).forEach(function (id) {
      var s = SCREENS[id];
      if (!seen[s.section]) {
        seen[s.section] = true;
        var h = document.createElement('p');
        h.className = 'group-title';
        h.textContent = s.section;
        nav.appendChild(h);
      }
      var b = document.createElement('button');
      b.className = 'jump';
      b.type = 'button';
      b.dataset.screen = id;
      b.textContent = s.title;
      b.addEventListener('click', function () { go(id, null, true); });
      nav.appendChild(b);
    });
  })();

  function syncChrome() {
    var s = SCREENS[current];
    elTitle.textContent = s.title;
    elNotes.textContent = NOTES[current] || '';
    elBack.disabled = history.length === 0;
    elCrumb.textContent = history.length
      ? history.map(function (id) { return SCREENS[id].title; }).concat(s.title).join('  ›  ')
      : s.title;
    Array.prototype.forEach.call(document.querySelectorAll('.jump'), function (b) {
      b.setAttribute('aria-current', String(b.dataset.screen === current));
    });
  }

  /* ------------------------------------------------- inside-the-iframe wiring */

  var INJECT_CSS = [
    '[data-proto-hidden] { display: none !important; }',
    '[data-proto-chain] { display: block !important; padding: 0 !important; margin: 0 !important;',
    '  min-height: 0 !important; gap: 0 !important; background: transparent !important;',
    '  align-items: flex-start !important; justify-content: flex-start !important; }',
    '[data-proto-frame] { position: fixed !important; top: 0 !important; left: 0 !important;',
    '  margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }',
    'html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important;',
    '  background: #0A0405 !important; width: 390px !important; height: 844px !important; }'
  ].join('\n');

  /* Match the phone frame on its declared inline size rather than its measured size: as a flex
     item inside a padded wrapper it renders narrower than 390px until it is taken out of flow,
     so measuring would never find it.
     Read the CSSOM, not the style attribute — the dc runtime renders through React, which
     re-serializes inline styles as "width: 390px" (with a space), so string matching fails.
     Document order puts the real screen first in the multi-frame documentation boards. */
  function findFrame(doc) {
    var all = doc.querySelectorAll('div[style]');
    for (var i = 0; i < all.length; i++) {
      if (all[i].style.width === '390px' && all[i].style.height === '844px') return all[i];
    }
    return null;
  }

  /* Hide everything except the first phone frame and its ancestors. Uses data attributes
     rather than inline styles so a React re-render (tab switches, toasts) can't wipe them. */
  function isolate(doc) {
    var frame = findFrame(doc);
    if (!frame) return false;

    frame.setAttribute('data-proto-frame', '');
    var node = frame;
    while (node && node !== doc.body) {
      var parent = node.parentElement;
      if (!parent) break;
      for (var i = 0; i < parent.children.length; i++) {
        var sib = parent.children[i];
        if (sib !== node && sib.tagName !== 'HELMET' && sib.tagName !== 'STYLE' && sib.tagName !== 'LINK') {
          sib.setAttribute('data-proto-hidden', '');
        }
      }
      if (parent !== doc.body) parent.setAttribute('data-proto-chain', '');
      node = parent;
    }
    return true;
  }

  function label(el) {
    var a = el.getAttribute && el.getAttribute('aria-label');
    return a ? a.trim() : '';
  }

  function text(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function matchRoute(screenId, el) {
    var rules = ROUTES[screenId] || [];
    var lbl = label(el);
    var txt = text(el);
    for (var i = 0; i < rules.length; i++) {
      var want = rules[i][0];
      if (want.charAt(0) === '@') {
        if (lbl === want.slice(1)) return rules[i][1];
      } else if (txt.indexOf(want) === 0 || lbl === want) {
        return rules[i][1];
      }
    }
    return null;
  }

  /* The sidebar's scrim closes the drawer. The drawer is whichever element contains
     "Sign out"; a click outside its box is a scrim tap. */
  function sidebarScrimHit(doc, x, y) {
    var candidates = doc.querySelectorAll('div');
    var drawer = null;
    for (var i = 0; i < candidates.length; i++) {
      var r = candidates[i].getBoundingClientRect();
      if (r.width > 200 && r.width < 360 && r.height > 600 && text(candidates[i]).indexOf('Sign out') !== -1) {
        drawer = r;
        break;
      }
    }
    if (!drawer) return false;
    return x < drawer.left || x > drawer.right || y < drawer.top || y > drawer.bottom;
  }

  function wire(doc, screenId) {
    doc.addEventListener('pointerdown', function (e) {
      lastPoint = { x: e.clientX, y: e.clientY };
    }, true);

    /* Home's list rows fire a bubbling `rowtap` CustomEvent. Intercept in capture so the
       screen's own "demo only" toast never fires. */
    doc.addEventListener('rowtap', function (e) {
      if (screenId !== 'home') return;
      var seg = doc.querySelector('.hs-seg');
      var tab = seg ? seg.getAttribute('data-tab') : 'groups';
      e.stopPropagation();
      go(tab === 'people' ? 'person' : 'group', lastPoint);
    }, true);

    doc.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('button, a, [role="button"]') : null;
      lastPoint = { x: e.clientX, y: e.clientY };

      if (el && label(el) === 'Back') {
        e.stopPropagation();
        e.preventDefault();
        back(lastPoint);
        return;
      }

      var dest = el ? matchRoute(screenId, el) : null;
      if (dest) {
        e.stopPropagation();
        e.preventDefault();
        go(dest, lastPoint);
        return;
      }

      if (screenId === 'sidebar' && sidebarScrimHit(doc, e.clientX, e.clientY)) {
        e.stopPropagation();
        back(lastPoint);
      }
    }, true);
  }

  /* ---------------------------------------------------------------- rendering */

  function load(iframe, screenId) {
    return new Promise(function (resolve) {
      iframe.src = encodeURI(SCREEN_DIR + SCREENS[screenId].file + '.dc.html');
      iframe.addEventListener('load', function onLoad() {
        iframe.removeEventListener('load', onLoad);
        var doc = iframe.contentDocument;

        var style = doc.createElement('style');
        style.textContent = INJECT_CSS;
        doc.head.appendChild(style);

        /* The dc runtime renders asynchronously, so poll for the phone frame. The iframe is
           laid out (opacity 0, not display:none) throughout, or nothing would be measurable. */
        var tries = 0;
        (function attempt() {
          var done = false;
          try {
            done = isolate(doc);
          } catch (err) {
            console.error('[prototype] isolate failed on ' + screenId, err);
            done = true;
          }
          if (done || tries++ > 150) {
            if (!done) console.warn('[prototype] no 390x844 frame found in ' + screenId);
            wire(doc, screenId);
            /* Re-isolate a few times: some screens re-render right after mount. */
            [120, 400, 900].forEach(function (ms) { setTimeout(function () { isolate(doc); }, ms); });
            resolve();
          } else {
            /* setTimeout, not requestAnimationFrame: a backgrounded tab pauses rAF entirely,
               which would leave this poll — and therefore the whole navigation — hung. */
            setTimeout(attempt, 16);
          }
        })();
      });
    });
  }

  /* A tap that arrives mid-transition is remembered rather than dropped — otherwise the
     prototype feels dead for the length of every ripple. */
  var pending = null;

  function go(screenId, origin, isJump) {
    if (!SCREENS[screenId] || screenId === current) return;
    if (navigating) { pending = { fn: go, args: [screenId, origin, isJump] }; return; }
    if (current !== null) {
      if (isJump) history = [];
      else history.push(current);
    }
    transition(screenId, origin);
  }

  function back(origin) {
    if (navigating) { pending = { fn: back, args: [origin] }; return; }
    var prev = history.pop() || FALLBACK_BACK[current];
    if (!prev) return;
    transition(prev, origin || { x: 45, y: 87 });
  }

  function transition(screenId, origin) {
    navigating = true;
    pending = null;
    var from = layers[active];
    var to = layers[1 - active];
    var first = current === null;

    var settled = false;
    function settle() {
      if (settled) return;
      settled = true;
      to.style.opacity = '';
      to.style.zIndex = '';
      to.style.pointerEvents = '';
      to.style.clipPath = '';
      to.classList.add('active');
      from.classList.remove('active');
      from.style.filter = '';
      from.style.transform = '';
      from.src = 'about:blank';
      navigating = false;
      if (pending) {
        var p = pending;
        pending = null;
        p.fn.apply(null, p.args);
      }
    }

    load(to, screenId).then(function () {
      current = screenId;
      active = 1 - active;
      syncChrome();

      /* Screens that animate themselves on entry swap instantly — playing the shell ripple
         on top of their own would read as two overlapping transitions.
         A hidden tab pauses requestAnimationFrame, so the ripple would never finish; swap
         instantly in that case rather than stall. */
      if (first || SCREENS[screenId].selfRipple || document.hidden) {
        settle();
        return;
      }

      /* Raise the incoming layer above the outgoing one and let the ripple clip it in. */
      to.style.opacity = '1';
      to.style.zIndex = '8';
      to.style.pointerEvents = 'auto';

      /* Race the animation against a deadline. The ripple drives itself with rAF, which the
         browser pauses when the tab is backgrounded — without this, switching tabs mid-ripple
         would leave `navigating` true and deadlock navigation for good. settle() is
         idempotent, so whichever finishes first wins harmlessly. */
      Promise.race([
        window.HisaabRipple.play({
          incoming: to,
          outgoing: from,
          origin: origin || { x: 195, y: 422 },
          stage: stage,
          duration: 900
        }),
        new Promise(function (r) { setTimeout(r, 1500); })
      ]).then(settle, settle);
    }, settle);
  }

  /* -------------------------------------------------------------- shell chrome */

  elBack.addEventListener('click', function () { back({ x: 45, y: 87 }); });
  document.getElementById('restart').addEventListener('click', function () {
    history = [];
    if (current !== 'login') transition('login', { x: 195, y: 422 });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'ArrowLeft') back({ x: 45, y: 87 });
  });

  transition('login', null);
})();
