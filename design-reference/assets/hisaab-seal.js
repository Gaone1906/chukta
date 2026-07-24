/* <hisaab-seal> — reusable Hisaab seal + "stamping down" animation.
 *
 *   <script src="hisaab-seal.js"></script>
 *   <hisaab-seal size="158" delay="1500"></hisaab-seal>
 *
 * Attributes
 *   size      px diameter of the settled seal (default 158)
 *   delay     ms of spinner before the stamp presses down (default 1500)
 *   state     "animate" (default) | "loading" | "settled" — freeze a state
 *   label     spinner caption (default "Sealing your ledger"); "" hides it
 * Methods
 *   play()    replay spinner -> stamp
 * Event
 *   "settled" fires when the stamp lands
 * Fonts: expects Rozha One + Hind on the page (falls back to serif/sans).
 */
(function () {
  const GOLD = "#B8963C";
  const uid = () => "hs" + Math.random().toString(36).slice(2, 8);

  class HisaabSeal extends HTMLElement {
    static get observedAttributes() { return ["size", "delay", "state", "label"]; }

    connectedCallback() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this.render();
      if (this.state === "animate") this.play();
    }

    disconnectedCallback() { clearTimeout(this._t); }

    attributeChangedCallback(name, oldVal, newVal) {
      if (oldVal === newVal || !this.shadowRoot) return;
      if (name === "size" || name === "label") { this.render(); if (this.state === "animate") this.play(); return; }
      if (name === "state") {
        if (this.state === "animate") this.play();
        else { clearTimeout(this._t); this.show(this.state === "settled" ? "settled" : "loading"); }
      }
    }

    get size() { return Number(this.getAttribute("size")) || 158; }
    get delay() { return this.getAttribute("delay") === null ? 1500 : Number(this.getAttribute("delay")); }
    get state() { return this.getAttribute("state") || "animate"; }
    get label() { return this.getAttribute("label") === null ? "Sealing your ledger" : this.getAttribute("label"); }

    play() {
      clearTimeout(this._t);
      this._landed = false;
      this.show("loading");
      this._t = setTimeout(() => {
        this.show("settled");
        this.dispatchEvent(new CustomEvent("settled", { bubbles: true }));
      }, this.delay);
    }

    show(which) {
      const r = this.shadowRoot;
      if (!r) return;
      const load = r.getElementById("load"), seal = r.getElementById("seal");
      load.style.display = which === "loading" ? "flex" : "none";
      seal.style.display = which === "settled" ? "flex" : "none";
      if (which === "settled" && !this._landed) {
        this._landed = true;
        const a = r.getElementById("anim"), h = r.getElementById("halo");
        [a, h].forEach(el => { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; });
      }
    }

    render() {
      const s = this.size, box = Math.round(s * 1.09), ring = Math.round(s * 0.66), id = uid();
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:inline-flex; flex-direction:column; align-items:center; }
          .box { position:relative; display:flex; align-items:center; justify-content:center; width:${box}px; height:${box}px; }
          .layer { position:absolute; inset:0; align-items:center; justify-content:center; }
          .track { width:${ring}px; height:${ring}px; border-radius:50%; border:1.5px solid rgba(255,255,255,.08); box-shadow:inset 0 1px 0 rgba(255,255,255,.1); }
          .arc { position:absolute; width:${ring}px; height:${ring}px; border-radius:50%; border:1.5px solid transparent; border-top-color:#D9B65A; border-right-color:rgba(184,150,60,.45); animation:spin 1.05s linear infinite; filter:drop-shadow(0 0 10px rgba(184,150,60,.45)); }
          .core { position:absolute; width:${Math.round(ring * 0.5)}px; height:${Math.round(ring * 0.5)}px; border-radius:50%; background:radial-gradient(circle, rgba(184,150,60,.22), transparent 70%); }
          .halo { position:absolute; width:${Math.round(s * 0.95)}px; height:${Math.round(s * 0.95)}px; border-radius:50%; border:1px solid rgba(184,150,60,.55); animation:halo 900ms ease-out both; pointer-events:none; }
          .press { opacity:1; transform:none; filter:none; animation:stamp 760ms cubic-bezier(.2,.85,.25,1) both; }
          .box { overflow:visible; }
          svg { display:block; filter:drop-shadow(0 7px 26px rgba(184,150,60,.32)); }
          .cap { margin-top:${Math.round(s * 0.19)}px; font:300 14px Hind, system-ui, sans-serif; letter-spacing:2.2px; text-transform:uppercase; color:rgba(255,255,255,.34); }
          @keyframes spin { to { transform:rotate(360deg) } }
          @keyframes halo { 0%{opacity:0;transform:scale(.7)} 40%{opacity:.55} 100%{opacity:0;transform:scale(1.5)} }
          @keyframes stamp { 0%{opacity:0;transform:scale(1.5) rotate(-9deg);filter:blur(6px)} 55%{opacity:1;transform:scale(.965) rotate(1.5deg);filter:blur(0)} 78%{transform:scale(1.014) rotate(-.6deg)} 100%{opacity:1;transform:scale(1) rotate(0);filter:blur(0)} }
          @media (prefers-reduced-motion: reduce) { .arc { animation:none } .press, .halo { animation:none } }
        </style>
        <div class="box">
          <div class="layer" id="load" style="display:none">
            <div class="track"></div><div class="arc"></div><div class="core"></div>
          </div>
          <div class="layer" id="seal" style="display:none">
            <div class="halo" id="halo"></div>
            <div class="press" id="anim">
              <svg width="${s}" height="${s}" viewBox="0 0 132 132">
                <defs>
                  <filter id="${id}-ink" x="-25%" y="-25%" width="150%" height="150%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="7" result="n"></feTurbulence>
                    <feDisplacementMap in="SourceGraphic" in2="n" scale="4.4" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
                  </filter>
                  <filter id="${id}-mottle" x="0%" y="0%" width="100%" height="100%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.42" numOctaves="4" seed="3" result="t"></feTurbulence>
                    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.15 0 0 0 -0.3" result="m"></feColorMatrix>
                    <feComposite in="SourceGraphic" in2="m" operator="out"></feComposite>
                  </filter>
                  <path id="${id}-top" d="M 16 66 A 50 50 0 0 1 116 66"></path>
                  <path id="${id}-bot" d="M 117 66 A 51 51 0 0 1 15 66"></path>
                </defs>
                <g filter="url(#${id}-ink)"><g filter="url(#${id}-mottle)">
                  <circle cx="66" cy="66" r="62" fill="none" stroke="${GOLD}" stroke-width="2.6" opacity="0.9"></circle>
                  <circle cx="66" cy="66" r="55.5" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.65"></circle>
                  <circle cx="66" cy="66" r="44" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.4" stroke-dasharray="1.5 3.5"></circle>
                  <text fill="${GOLD}" font-family="Hind, sans-serif" font-size="8.4" font-weight="500" letter-spacing="3.4" opacity="0.85"><textPath href="#${id}-top" startOffset="50%" text-anchor="middle">SQUARED · SETTLED</textPath></text>
                  <text fill="${GOLD}" font-family="Hind, sans-serif" font-size="7.6" letter-spacing="3" opacity="0.55"><textPath href="#${id}-bot" startOffset="50%" text-anchor="middle">NO AWKWARD ASKING</textPath></text>
                  <text x="66" y="72" fill="${GOLD}" text-anchor="middle" font-family="Rozha One, serif" font-size="21" letter-spacing="2.4">HISAAB</text>
                  <rect x="50" y="79" width="32" height="1.2" fill="${GOLD}" opacity="0.5"></rect>
                </g></g>
              </svg>
            </div>
          </div>
        </div>
        ${this.label ? `<div class="cap" id="cap">${this.label}</div>` : ""}
      `;
      const st = this.state;
      this._landed = false;
      this.show(st === "settled" ? "settled" : "loading");
      const cap = this.shadowRoot.getElementById("cap");
      if (cap) cap.style.visibility = st === "settled" ? "hidden" : "visible";
      this.addEventListener("settled", () => { if (cap) cap.style.visibility = "hidden"; });
    }
  }

  if (!customElements.get("hisaab-seal")) customElements.define("hisaab-seal", HisaabSeal);
})();
