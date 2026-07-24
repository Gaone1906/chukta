/* Hisaab list primitives — reusable across screens.
 *
 *   <script src="hisaab-row.js"></script>
 *   <hisaab-row name="Goa, finally" meta="6 members" amount="12480" direction="owe"></hisaab-row>
 *   <hisaab-row name="Rhea Kapoor" meta="2 shared groups" amount="6200" direction="owed" avatar="RK" avatar-tone="oxblood"></hisaab-row>
 *   <hisaab-row name="Sunday football" meta="11 members" amount="0"></hisaab-row>   <!-- settled -> gold tick -->
 *   <hisaab-balance amount="840" direction="owe"></hisaab-balance>                  <!-- badge on its own -->
 *
 * hisaab-row attributes
 *   name          primary label (Hind medium)
 *   meta          secondary line (member / group count)
 *   amount        number, minor-unit-free rupees; 0 or omitted renders the settled tick
 *   direction     "owe" (oxblood, default) | "owed" (gold leaf)
 *   currency      symbol, default "₹"
 *   avatar        initials; omit for group rows
 *   avatar-tone   "oxblood" | "gold" | "plain" (default plain)
 *   chevron       "off" to hide the chevron on balance rows
 *   compact       flag; tighter row for small mockups
 * Fires "rowtap" (bubbles, composed) on click. Fonts: expects Hind on the page.
 */
(function () {
  const OX = { border: "rgba(122,40,51,.85)", bg: "rgba(122,40,51,.45)", text: "#F6DADE", label: "You owe" };
  const GOLD = { border: "rgba(184,150,60,.7)", bg: "rgba(184,150,60,.2)", text: "#F6E9CB", label: "Owes you" };
  const TONES = { oxblood: "rgba(122,40,51,.35)", gold: "rgba(184,150,60,.24)", plain: "rgba(255,255,255,.1)" };
  const money = (n, c) => c + Number(n).toLocaleString("en-IN");

  const TICK = `<span class="tick" part="tick"><svg width="14" height="11" viewBox="0 0 14 11" fill="none"><path d="M1.4 5.6l3.6 3.6L12.6 1.6" stroke="#D9B65A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  const CHEV = `<svg class="chev" width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1.5 1l4 5-4 5" stroke="rgba(255,255,255,.35)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const BADGE_CSS = `
    .chip { display:inline-block; padding:5px 11px; border-radius:13px; font:600 15px Hind, system-ui, sans-serif; letter-spacing:.2px; }
    .cap { font:300 10.5px Hind, sans-serif; letter-spacing:1.4px; text-transform:uppercase; color:rgba(255,255,255,.3); }
    .tick { display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:15px;
            border:1px solid rgba(184,150,60,.6); background:rgba(184,150,60,.16); box-shadow:inset 0 1px 0 rgba(255,255,255,.18); }
  `;

  function balanceMarkup(amount, direction, currency) {
    const n = Number(amount || 0);
    if (!n) return TICK;
    const t = direction === "owed" ? GOLD : OX;
    return `<span class="stack">
      <span class="chip" part="chip" style="border:1px solid ${t.border};background:${t.bg};color:${t.text}">${money(n, currency)}</span>
      <span class="cap">${t.label}</span>
    </span>`;
  }

  class HisaabBalance extends HTMLElement {
    static get observedAttributes() { return ["amount", "direction", "currency"]; }
    connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: "open" }); this.render(); }
    attributeChangedCallback(n, o, v) { if (o !== v && this.shadowRoot) this.render(); }
    render() {
      this.shadowRoot.innerHTML = `<style>
        :host { display:inline-flex; }
        .stack { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
        ${BADGE_CSS}
      </style>${balanceMarkup(this.getAttribute("amount"), this.getAttribute("direction"), this.getAttribute("currency") || "₹")}`;
    }
  }

  class HisaabRow extends HTMLElement {
    static get observedAttributes() { return ["name", "meta", "amount", "direction", "currency", "avatar", "avatar-tone", "chevron", "compact"]; }
    connectedCallback() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this.render();
      if (!this._wired) {
        this._wired = true;
        this.addEventListener("click", () => this.dispatchEvent(new CustomEvent("rowtap", { bubbles: true, composed: true, detail: { name: this.getAttribute("name") } })));
      }
    }
    attributeChangedCallback(n, o, v) { if (o !== v && this.shadowRoot) this.render(); }
    render() {
      const compact = this.hasAttribute("compact");
      const av = this.getAttribute("avatar");
      const tone = TONES[this.getAttribute("avatar-tone")] || TONES.plain;
      const settled = !Number(this.getAttribute("amount") || 0);
      const chev = settled || this.getAttribute("chevron") === "off" ? "" : CHEV;
      const size = compact ? 36 : 42;

      this.shadowRoot.innerHTML = `<style>
        :host { display:block; }
        .row { display:flex; align-items:center; gap:${compact ? 12 : 14}px; width:100%; box-sizing:border-box; text-align:left;
               padding:${compact ? "13px 14px" : av ? "14px 16px 14px 15px" : "16px 16px 16px 18px"};
               border:1px solid rgba(255,255,255,.12); border-radius:${compact ? 20 : 22}px; background:rgba(255,255,255,.05);
               backdrop-filter:blur(22px) saturate(180%); -webkit-backdrop-filter:blur(22px) saturate(180%);
               box-shadow:inset 0 1px 0 rgba(255,255,255,.18), 0 6px 20px rgba(0,0,0,.28); cursor:pointer;
               transition:transform .16s ease, border-color .18s ease, background .18s ease; }
        .row:hover { border-color:rgba(184,150,60,.4); background:rgba(255,255,255,.08); }
        .row:active { transform:scale(.99); border-color:rgba(184,150,60,.75); }
        .av { flex:none; display:flex; align-items:center; justify-content:center; width:${size}px; height:${size}px;
              border-radius:${size / 2}px; border:1px solid rgba(255,255,255,.16); background:${tone};
              font:500 ${compact ? 13 : 15}px Hind, sans-serif; color:#F4EDE4; }
        .txt { flex:1; min-width:0; display:flex; flex-direction:column; gap:${compact ? 2 : 3}px; }
        .name { font:500 ${compact ? 14.5 : 16.5}px Hind, system-ui, sans-serif; color:#F4EDE4; letter-spacing:.1px;
                overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .meta { font:300 ${compact ? 11.5 : 13}px Hind, sans-serif; color:rgba(255,255,255,.4); }
        .stack { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
        .chev { flex:none; }
        ${BADGE_CSS}
        ${compact ? ".chip { font-size:13px; padding:4px 9px; } .cap { display:none } .tick { width:26px;height:26px }" : ""}
      </style>
      <div class="row" part="row" role="button" tabindex="0">
        ${av ? `<span class="av" part="avatar">${av}</span>` : ""}
        <span class="txt">
          <span class="name">${this.getAttribute("name") || ""}</span>
          <span class="meta">${this.getAttribute("meta") || ""}</span>
        </span>
        ${balanceMarkup(this.getAttribute("amount"), this.getAttribute("direction"), this.getAttribute("currency") || "₹")}
        ${chev}
      </div>`;
    }
  }

  if (!customElements.get("hisaab-balance")) customElements.define("hisaab-balance", HisaabBalance);
  if (!customElements.get("hisaab-row")) customElements.define("hisaab-row", HisaabRow);
})();
