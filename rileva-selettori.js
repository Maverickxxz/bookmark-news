/*
 * STRUMENTO (non fa parte dell'estensione).
 * Serve a ricavare i selettori del feed di un sito che non riesco ad analizzare
 * da remoto (es. tomshw.it).
 *
 * Come usarlo:
 *   1) Apri la HOME del sito (es. https://www.tomshw.it/) nel browser.
 *   2) Premi F12 -> scheda "Console".
 *   3) Copia TUTTO il contenuto di questo file e incollalo nella console, poi Invio.
 *   4) Copia il blocco JSON stampato (viene anche copiato negli appunti) e incollamelo.
 */
(() => {
  const origin = location.origin;
  const anchors = [...document.querySelectorAll("a[href]")].filter((a) => {
    try {
      const u = new URL(a.href);
      if (u.origin !== origin) return false;
      const t = (a.textContent || "").trim();
      return t.length >= 25 && u.pathname.length > 1;
    } catch (e) {
      return false;
    }
  });

  const sig1 = (el) =>
    el.tagName.toLowerCase() +
    (el.classList.length ? "." + CSS.escape(el.classList[0]) : "");

  // Frequenza delle firme degli antenati (fino a 6 livelli) dei link-titolo.
  const freq = new Map();
  for (const a of anchors) {
    let el = a.parentElement;
    let depth = 0;
    const seen = new Set();
    while (el && depth < 6) {
      if (el.classList.length) {
        const s = sig1(el);
        if (!seen.has(s)) {
          seen.add(s);
          freq.set(s, (freq.get(s) || 0) + 1);
        }
      }
      el = el.parentElement;
      depth++;
    }
  }

  const cands = [...freq.keys()]
    .map((s) => {
      let els;
      try {
        els = [...document.querySelectorAll(s)];
      } catch (e) {
        return null;
      }
      const withLink = els.filter((e) =>
        [...e.querySelectorAll("a[href]")].some((a) => anchors.includes(a))
      );
      const linksPer = withLink.length
        ? withLink.reduce(
            (n, e) =>
              n +
              [...e.querySelectorAll("a[href]")].filter((a) => anchors.includes(a))
                .length,
            0
          ) / withLink.length
        : 0;
      return {
        sel: s,
        elems: els.length,
        withLink: withLink.length,
        linksPer: +linksPer.toFixed(2),
      };
    })
    .filter(Boolean)
    .filter((c) => c.withLink >= 4)
    .sort(
      (a, b) =>
        b.withLink - a.withLink ||
        a.linksPer - b.linksPer ||
        b.sel.length - a.sel.length
    );

  const report = { url: location.href };
  const best = cands[0];
  if (best) {
    const els = [...document.querySelectorAll(best.sel)].filter((e) =>
      [...e.querySelectorAll("a[href]")].some((a) => anchors.includes(a))
    );
    const first = els[0];
    const titleLink = [...first.querySelectorAll("a[href]")].find((a) =>
      anchors.includes(a)
    );
    const linkSel =
      titleLink.tagName.toLowerCase() +
      (titleLink.classList.length ? "." + CSS.escape(titleLink.classList[0]) : "");
    report.articleSelector = best.sel;
    report.linkSelectorGuess = linkSel + "[href], a[href]";
    report.candidates = cands.slice(0, 5);
    report.samples = els.slice(0, 5).map((e) => {
      const a = [...e.querySelectorAll("a[href]")].find((x) => anchors.includes(x));
      let path = "";
      try {
        path = new URL(a.href).pathname;
      } catch (e2) {}
      return { title: (a.textContent || "").trim().slice(0, 60), path };
    });
  } else {
    report.error = "Nessun contenitore ricorrente trovato automaticamente";
    report.totalTitleLinks = anchors.length;
  }

  const out = JSON.stringify(report, null, 2);
  console.log(
    "%c=== SELETTORI — copia tutto il blocco qui sotto ===",
    "color:#c0392b;font-weight:bold"
  );
  console.log(out);
  try {
    copy(out);
    console.log("(copiato negli appunti)");
  } catch (e) {}
  return report;
})();
