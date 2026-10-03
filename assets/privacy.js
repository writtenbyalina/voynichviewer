/* Voynich Viewer: cookies and privacy.
   Microsoft Clarity (visitor analytics, which sets cookies) is loaded only after the visitor accepts in the strip at the
   bottom of the page. "Reject", or closing the strip, means no, and Clarity is never loaded. Accept and Reject look the
   same and sit side by side; nothing is pre-selected and the page is never blocked. The choice is kept in this browser
   for 6 months (or until the notice changes, VERSION) and can be changed in Info > Privacy and cookies, from the "?"
   help and from the bug report box. A Global Privacy Control signal counts as no.
   Nothing is tracked on a local copy (localhost), so testing stays out of the statistics.
   Edit the settings below if the site's contact or host changes; the privacy notice (app.js, Info) reads them. */
"use strict";

const Privacy = {
  CLARITY_ID: "ys2r2nospw",
  CONTACT: "alinajafri4@gmail.com",   // where visitors can ask about their data (an e-mail address or a URL)
  HOST: { name: "GitHub Pages", privacy: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" },
  UPDATED: "3 October 2026",
  KEY: "vv:consent",
  MONTHS: 6,     // ask again after this long (the CNIL's recommendation; the ICO and EDPB allow longer)
  VERSION: 1,    // raise when the privacy notice changes in a way that needs a new choice
  local: /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === "file:",
  gpc: () => navigator.globalPrivacyControl === true,

  /* "granted", "denied" or null (not asked yet, asked too long ago, or asked under an older notice) */
  choice() {
    if (this.gpc()) return "denied";
    try {
      const c = JSON.parse(localStorage.getItem(this.KEY));
      if (c && (c.choice === "granted" || c.choice === "denied") && (c.v || 1) === this.VERSION
          && Date.now() - Date.parse(c.at) < this.MONTHS * 30.44 * 864e5) return c.choice;
    } catch { /* storage blocked: ask again */ }
    return null;
  },

  start() {
    const c = this.choice();
    if (c === "granted") this.loadClarity();
    else if (c === null) this.showStrip();
  },

  choose(choice) {
    const was = this.choice();
    try { localStorage.setItem(this.KEY, JSON.stringify({ choice, at: new Date().toISOString(), v: this.VERSION })); } catch { /* remembered for this visit only */ }
    this.hideStrip();
    if (choice === "granted") this.loadClarity();
    else if (was === "granted" && window.clarity) {   // turned off while Clarity runs: tell it, drop its cookies, start clean
      try { window.clarity("consent", false); } catch { /* older Clarity */ }
      this.dropCookies();
      setTimeout(() => location.reload(), 300);
    }
    document.dispatchEvent(new CustomEvent("vv:privacy", { detail: choice }));
  },

  loadClarity() {
    if (this.local || window.clarity) return;
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", this.CLARITY_ID);
    window.clarity("consent");   // the visitor agreed: Clarity may set its cookies
  },

  dropCookies() {
    const host = location.hostname, base = host.replace(/^www\./, "");
    for (const name of ["_clck", "_clsk", "CLID", "ANONCHK", "MR", "MUID", "SM"])
      for (const dom of ["", `; domain=${host}`, `; domain=.${base}`]) document.cookie = `${name}=; Max-Age=0; path=/${dom}`;
  },

  privacyHref() { return `#info/${encodeURIComponent(typeof S !== "undefined" ? S.order : "beinecke")}/privacy`; },

  showStrip() {
    if (document.getElementById("pv-strip")) return;
    const el = document.createElement("div");
    el.id = "pv-strip";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Cookies and privacy");
    el.innerHTML = `<p>May we use <b>Microsoft Clarity</b> analytics cookies to see how the viewer is used<span class="pv-detail"> (clicks, scrolling, visit recordings)</span>?
      <span class="pv-more">Optional; you can change it any time.</span>
      <a href="${this.privacyHref()}" class="pv-link">Privacy notice</a></p>
      <span class="pv-acts"><button type="button" data-c="granted">Accept</button><button type="button" data-c="denied">Reject</button></span>
      <button type="button" class="pv-x" data-c="denied" aria-label="Close: no analytics cookies" title="Close (same as Reject)">×</button>`;
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-c]");
      if (b) this.choose(b.dataset.c);
      else if (e.target.closest(".pv-link")) e.target.closest(".pv-link").href = this.privacyHref();
    });
    document.body.append(el);
  },
  hideStrip() { document.getElementById("pv-strip")?.remove(); },
};

document.addEventListener("DOMContentLoaded", () => Privacy.start());
