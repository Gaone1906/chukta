/* <hisaab-mark> — rectangular ink-stamp wordmark for recurring screens
 * (the circular seal, <hisaab-seal>, stays reserved for brand moments).
 *
 *   <script src="hisaab-mark.js"></script>
 *   <hisaab-mark width="118"></hisaab-mark>
 *
 * Attributes
 *   width   px width of the mark (default 118; height follows the 160:52 ratio)
 *   color   ink colour (default #B8963C gold leaf)
 * Fonts: expects Rozha One on the page (falls back to serif).
 */
(function () {
  const uid = () => "hm" + Math.random().toString(36).slice(2, 8);

  class HisaabMark extends HTMLElement {
    static get observedAttributes() { return ["width", "color"]; }
    connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: "open" }); this.render(); }
    attributeChangedCallback(n, o, v) { if (o !== v && this.shadowRoot) this.render(); }

    render() {
      const w = Number(this.getAttribute("width")) || 118;
      const h = Math.round(w * 52 / 160);
      const c = this.getAttribute("color") || "#B8963C";
      const id = uid();
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:inline-flex; }
          svg { display:block; filter:drop-shadow(0 3px 14px rgba(184,150,60,.28)); }
        </style>
        <svg width="${w}" height="${h}" viewBox="0 0 160 52" role="img" aria-label="Hisaab">
          <defs>
            <filter id="${id}-ink" x="-20%" y="-30%" width="140%" height="160%">
              <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="11" result="n"></feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
            </filter>
            <filter id="${id}-mottle" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="4" seed="5" result="t"></feTurbulence>
              <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.2 0 0 0 -0.32" result="m"></feColorMatrix>
              <feComposite in="SourceGraphic" in2="m" operator="out"></feComposite>
            </filter>
          </defs>
          <g filter="url(#${id}-ink)"><g filter="url(#${id}-mottle)">
            <rect x="2.2" y="2.2" width="155.6" height="47.6" rx="4" fill="none" stroke="${c}" stroke-width="2.4" opacity="0.9"></rect>
            <rect x="7.4" y="7.4" width="145.2" height="37.2" rx="2.5" fill="none" stroke="${c}" stroke-width="0.9" opacity="0.55"></rect>
            <text x="80" y="34.6" fill="${c}" text-anchor="middle" font-family="Rozha One, serif" font-size="23" letter-spacing="4.2">HISAAB</text>
            <rect x="16" y="24.6" width="10" height="1" fill="${c}" opacity="0.45"></rect>
            <rect x="134" y="24.6" width="10" height="1" fill="${c}" opacity="0.45"></rect>
          </g></g>
        </svg>`;
    }
  }

  if (!customElements.get("hisaab-mark")) customElements.define("hisaab-mark", HisaabMark);
})();
