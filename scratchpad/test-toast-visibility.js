/*
 * Verifica del toast "a tempo di sguardo" (v0.3.4, content.js):
 * il conto alla rovescia dei 7s corre SOLO mentre la scheda è visibile.
 * In una scheda in background il toast aspetta l'arrivo dell'utente; a un
 * cambio scheda si mette in pausa e riparte dal tempo residuo (minimo 1s).
 *
 * Qui startToastTimer/pauseToastTimer sono replicate con clock e setTimeout
 * finti; le transizioni simulano gli eventi visibilitychange.
 *
 * Uso: node scratchpad/test-toast-visibility.js
 */

const assert = require("assert");

const TOAST_MS = 7000;

// Replica dello stato/logica di content.js. now = clock finto (ms);
// t.timer.at = istante (assoluto) in cui scatterebbe dismissToast.
function makeToast(now) {
  const t = { el: {}, done: false, timer: null, left: TOAST_MS, shownAt: 0 };
  t.start = () => {
    if (t.timer || !t.el || t.done) return;
    t.shownAt = now();
    t.timer = { at: now() + t.left }; // setTimeout(dismissToast, t.left)
  };
  t.pause = () => {
    if (!t.timer) return;
    t.timer = null; // clearTimeout
    t.left = Math.max(1000, t.left - (now() - t.shownAt));
  };
  return t;
}

let clock = 0;
const now = () => clock;

// 1) Scheda visibile alla creazione: dismiss dopo 7s, come prima.
let t = makeToast(now);
clock = 0;
t.start();
assert.strictEqual(t.timer.at, 7000, "scheda visibile: 7s dal via");

// 2) IL CASO SEGNALATO: home aperta in scheda in background, l'utente arriva
//    dopo 20s. Il timer non è mai partito: il toast è ancora lì e resta i
//    7 secondi PIENI da quando la scheda diventa visibile.
t = makeToast(now);
clock = 0; // load: scheda nascosta -> nessuno start
assert.strictEqual(t.timer, null, "scheda in background: timer fermo");
clock = 20000; // visibilitychange -> visible
t.start();
assert.strictEqual(t.timer.at, 27000, "7s pieni dall'ingresso nella scheda");

// 3) Cambio scheda a metà: pausa col tempo residuo, ripresa da lì.
t = makeToast(now);
clock = 0;
t.start();
clock = 3000; // -> hidden dopo 3s di sguardo
t.pause();
assert.strictEqual(t.timer, null, "in pausa: nessun timer attivo");
assert.strictEqual(t.left, 4000, "residuo = 7s - 3s guardati");
clock = 60000; // -> visible molto dopo
t.start();
assert.strictEqual(t.timer.at, 64000, "riparte dai 4s residui");

// 4) Ritorno all'ultimo istante: minimo 1s (non deve sparire subito).
t = makeToast(now);
clock = 0;
t.start();
clock = 6900;
t.pause();
assert.strictEqual(t.left, 1000, "residuo minimo 1s");

// 5) Dopo il dismiss (X, "Vai all'ultima letta" o timer scaduto) un
//    visibilitychange non lo fa ripartire.
t = makeToast(now);
clock = 0;
t.start();
t.done = true; // dismissToast: toastDone = true
t.timer = null; //               clearTimeout
t.el = null; //                  toastEl = null
t.start();
assert.strictEqual(t.timer, null, "toast chiuso: start è un no-op");

// 6) start ripetuti (più visibilitychange visible di fila): uno solo conta.
t = makeToast(now);
clock = 0;
t.start();
clock = 2000;
t.start();
assert.strictEqual(t.timer.at, 7000, "start con timer già attivo: no-op");

console.log("TUTTO OK (visibile, background 20s, pausa/ripresa, minimo 1s, chiuso, doppio start)");
