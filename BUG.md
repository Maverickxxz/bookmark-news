# 🐞 Bug risolti

Registro dei bug trovati e corretti, dal più recente al più vecchio.
Per ognuno: **sintomo** (cosa vedeva l'utente), **causa** (perché succedeva),
**correzione** (cosa è cambiato nel codice) e **verifica** (come è stato provato).

Le spiegazioni lunghe della logica stanno in `CLAUDE.md`; qui c'è solo la storia dei guasti.

---

## #13 — Il Web Store rifiutava il pacchetto: `description` troppo lunga
**Versione:** 0.3.8 · **Data:** 06/08/2026 · **Sito:** — (pubblicazione) · **Segnalato da:** utente

- **Sintomo:** caricando il pacchetto, la dashboard sviluppatore risponde «Il campo description nel
  file manifest è troppo lungo: 138. Supera il limite massimo di 132 caratteri».
- **Causa:** il campo `description` del manifest non è solo una descrizione interna: il Web Store lo
  usa come **descrizione breve** della scheda (quella nei risultati di ricerca) e impone 132
  caratteri. La descrizione scritta durante lo sviluppo ne aveva 138.
- **Correzione:** riscritta a 128 caratteri senza perdere i tre concetti che servono in vetrina
  (evidenzia l'ultima vista / conta le nuove / multi-sito e in locale). Il controllo è stato messo
  in `build.ps1`, che si rifiuta di creare lo ZIP se il limite viene superato: così non si scopre
  di nuovo al momento del caricamento.
- **Trappola evitata nello stesso lavoro:** `Compress-Archive` di PowerShell 5.1 scrive i nomi delle
  voci dello ZIP con la barra **rovesciata** (`icons\icon16.png`) invece della barra normale prevista
  dallo standard. Il Web Store spacchetta su Linux, dove quel nome diventa un unico file chiamato
  `icons\icon16.png` nella radice: le icone non si troverebbero più. `build.ps1` costruisce quindi
  l'archivio con `System.IO.Compression.ZipArchive`, scrivendo i nomi a mano con `/`.
- **Verifica:** `build.ps1` eseguito → `description: 128/132`; elenco delle voci dello ZIP riletto
  con `ZipFile::OpenRead` (14 voci, `manifest.json` nella radice, `icons/` con la barra giusta, nessun
  file di sviluppo).

---

## #12 — Ricaricare per togliere i doppioni faceva perdere il segnalibro
**Versione:** 0.3.7 · **Data:** 01/08/2026 · **Sito:** tutti (nato su hdblog) · **Segnalato da:** utente

- **Sintomo:** «io come refresho il sito, sparisce la duplicazione (vedi #11). Allo stesso tempo
  però, chiaramente mi sposta il segnalibro nella vera ultima notizia».
- **Causa:** l'F5 è un caricamento come un altro. Con `reached=true` — ed è il caso tipico, visto
  che "Vai all'ultima letta" ti ci porta proprio sopra — `init()` fa avanzare `marker = pending`,
  cioè "sei in pari": le notizie non ancora lette vengono buttate via. Il tipo di navigazione non
  aiuta: il reload del sito, il nostro e l'F5 dell'utente sono indistinguibili (motivo per cui
  `getNavType` fu rimosso in v0.0.8, vedi #1 e #9).
- **Correzione:** il ricaricamento lo fa **l'estensione**, ed è l'unico modo di riconoscerlo.
  Il marcatore `autoRefreshParam` di #9 è stato generalizzato a un elenco di parametri
  "stessa visita" (`sameVisitParams`): quello del sito più il nostro `hdbkeep`. Nuovo pulsante
  **«Ricarica pulita»** nel popup → `reloadKeepingMarker()` ricarica con `?hdbkeep=1`, `init()`
  tratta il caricamento come stessa visita (`marker` e `pending` fermi, `reached` conservato) e il
  parametro viene subito tolto dall'URL (lezione di #10). L'**ancora** si conserva: hdblog ci tiene
  il numero di blocchi già aperti (`#?t=…&b=N`) e la usa per rirenderizzarli tutti in una sola
  richiesta — che è poi il motivo per cui ricaricare toglie i doppioni. Il flag `rescroll_<id>`
  (TTL 2 min, consumato sempre) riporta l'utente all'ultima letta dopo il caricamento: la ricarica
  non costa né il segnalibro né il punto di lettura.
- **Non risolto di proposito:** l'F5 premuto dall'utente resta una visita vera. Non è distinguibile,
  e fingere di saperlo fare è esattamente l'errore di v0.0.7.
- **Attenzione al ritorno automatico:** per il segnalibro i due marcatori sono equivalenti, ma il
  salto all'ultima letta scatta solo su `keepLoad` (il NOSTRO `hdbkeep`), mai su `sameVisitLoad`.
  Altrimenti un flag `rescroll` rimasto appeso — "Ricarica pulita" il cui caricamento non arriva
  mai perché l'utente clicca un link — verrebbe raccolto dal primo auto-refresh del sito, che
  trascinerebbe la pagina sotto gli occhi dell'utente: di nuovo il sintomo del #9.
- **Verifica:** `scratchpad/test-clean-reload-dupes.js`, parti (4)-(6), inclusa la (5b) sul refresh
  automatico di hdblog.

---

## #11 — Notizie duplicate scorrendo il feed
**Versione:** 0.3.7 · **Data:** 01/08/2026 · **Sito:** hdblog · **Segnalato da:** utente

- **Sintomo:** «delle volte le notizie vengono duplicate». Con 41 notizie da recuperare, risalendo
  il feed dopo "Vai all'ultima letta" molte comparivano due volte.
- **Causa:** **non è l'estensione, è la paginazione del sito.** Il lazy-load di hdblog
  (`pages.php?page=N`) è a **offset sulla lista VIVA**: ricalcola le posizioni a ogni richiesta. La
  home è renderizzata all'apertura (blocchi 1-2), i blocchi successivi arrivano mentre scorri —
  ogni notizia pubblicata nel frattempo fa scalare la sequenza di una posizione, così il blocco che
  arriva **ripete le ultime già in pagina**. Un doppione per ogni notizia pubblicata, a ogni
  confine di blocco attraversato: da qui il "delle volte" (serve che il sito pubblichi mentre
  leggi) e il fatto che peggiori con tante notizie arretrate. Misurato dal vivo scaricando le
  pagine a distanza di minuti: pubblicata `n666098`, la pagina 3 è passata da iniziare con
  `n666081` a iniziare con `n666086` — che era l'ultima notizia della home già mostrata.
- **Il conteggio NON era sbagliato:** `collectArticles` deduplicava già per chiave, quindi "41"
  erano 41 notizie distinte. Il difetto era solo di visualizzazione.
- **Correzione:** `collectArticles` ora tiene da parte gli elementi scartati (`out.dups`) e
  `hideDuplicates()` nasconde le occorrenze **successive alla prima** con la classe `.hdb-dup`
  (`display:none`); la prima sta nella posizione cronologica giusta ed è quella che riceve
  l'evidenziazione. Il confronto è sulla chiave dell'articolo (per hdblog l'id `nXXXXXX`): due
  notizie diverse non possono collidere. Si ripulisce prima di ri-marcare, perché `applyHighlight`
  è idempotente e il sito può ri-renderizzare la lista. Nella firma del feed (`currentSig`) entra
  anche `feed.raw` (nodi trovati dal selettore): un blocco fatto di **soli** doppioni non cambia il
  numero di notizie distinte e senza `raw` resterebbe visibile. Interruttore dedicato in
  Impostazioni (`hideDupes`, attivo di default) e nota nel popup con quanti ne sono stati nascosti.
- **Verifica:** `scratchpad/test-clean-reload-dupes.js`, parti (1)-(3) — inclusa la sequenza reale
  misurata sul sito. Diagnostica riutilizzabile: `scratchpad/diag-hdblog-dup.js`.
- **Seguito:** ha portato al #12 (ricaricare toglieva i doppioni ma spostava il segnalibro).

---

## #10 — L'URL restava incollato su `?refresh_ce` e il segnalibro si bloccava per sempre
**Versione:** 0.3.6 · **Data:** 22/07/2026 · **Sito:** hdblog · **Segnalato da:** utente

- **Sintomo:** dopo l'auto-refresh della home la scheda restava su
  `https://www.hdblog.it/?refresh_ce` e il segnalibro non si aggiornava più,
  "neanche refreshando 100 volte".
- **Causa:** la correzione #9 usa il parametro `refresh_ce` nell'URL per riconoscere i
  ricaricamenti fatti dal sito. Ma il parametro **restava nella barra degli indirizzi**:
  da lì in poi ogni caricamento (F5 compreso, perché ricarica proprio quell'URL) sembrava
  automatico → segnalibro sempre fermo. Il sito poi ripuntava di nuovo a `?refresh_ce`,
  quindi non se ne usciva.
- **Correzione:** `content.js` legge il parametro **una volta sola** all'avvio (costante
  `autoRefreshLoad`) e subito dopo lo toglie dall'URL con `stripAutoRefreshParam()` →
  `history.replaceState`, che riscrive la barra degli indirizzi **senza ricaricare** la
  pagina. Il caricamento in corso resta trattato come automatico; i successivi tornano
  visite vere. Il meta refresh del sito punta all'URL assoluto col parametro, quindi il
  prossimo auto-refresh viene comunque riconosciuto (e ripulito a sua volta).
- **Effetto collaterale risolto:** l'URL ora alterna `/` → `/?refresh_ce`, quindi Chrome
  non ripristina più lo scroll a ogni auto-refresh.
- **Verifica:** `scratchpad/test-autorefresh-url.js` (36 controlli).

---

## #9 — Il segnalibro avanzava da solo su notizie mai lette
**Versione:** 0.3.5 · **Data:** 21/07/2026 · **Sito:** hdblog · **Segnalato da:** utente

- **Sintomo:** lasciando la home aperta, il segnalibro si spostava da solo su notizie che
  l'utente non aveva mai letto, e la pagina si ricaricava sotto di lui.
- **Causa:** la home di hdblog contiene
  `<meta http-equiv="refresh" content='777;url=https://www.hdblog.it/?refresh_ce'>` e la
  pagina di arrivo **ripete lo stesso tag**: la home si ricarica da sola ogni ~13 minuti
  finché la scheda resta aperta. `init()` contava ogni ricaricamento come una visita nuova.
- **Correzione:** nuovo campo `autoRefreshParam` in `sites.js` (per hdblog `"refresh_ce"`):
  se l'URL porta quel parametro il caricamento è la **stessa visita** — `marker` e `pending`
  restano fermi e `reached` non si azzera. Si usa un marcatore nell'URL e non il tipo di
  navigazione perché un `reload()` fatto dal sito è indistinguibile dall'F5 dell'utente.
- **Verifica:** `scratchpad/test-autorefresh-archive.js`, parte (1).
- **Seguito:** ha generato il bug #10.

---

## #8 — I pulsanti del popup sparivano sulle pagine dell'archivio
**Versione:** 0.3.5 · **Data:** 21/07/2026 · **Sito:** hwupgrade · **Segnalato da:** utente

- **Sintomo:** sulle pagine `/news/index[Z].html` il popup mostrava "apri la home" senza i
  pulsanti — proprio le pagine dove ti porta "Vai all'ultima letta".
- **Causa:** `initArchive()` scriveva uno stato minimo (`{onHome:false, archive:true}`) e
  `popup.js/boot()` mandava tutto sul pannello ridotto.
- **Correzione:** `initArchive` compila uno stato completo (`archivePage`, `found`,
  `markerTitle`, `total`, più `unread`/`approx` letti da `status_<id>`) e il popup rende il
  pannello principale anche con `status.archive`. **`markAllRead` nell'archivio non può usare
  `feed[0]`** (è una notizia vecchia: manderebbe il segnalibro all'indietro): usa
  `pending_<id>`. `startArchiveSeek(page)` riparte dalla pagina successiva invece che da 1.
- **Verifica:** `scratchpad/test-autorefresh-archive.js`, parte (2) + markup reale delle
  pagine archivio.

---

## #7 — Il toast spariva prima che si aprisse la scheda
**Versione:** 0.3.4 · **Sito:** tutti · **Segnalato da:** utente

- **Sintomo:** aprendo più home in schede di sfondo, l'avviso col numero di notizie nuove
  era già sparito quando si arrivava sulla scheda (perso dopo ~20 secondi).
- **Causa:** i 7 secondi di auto-chiusura partivano al caricamento della pagina, anche se la
  scheda non era mai stata guardata.
- **Correzione:** il conto alla rovescia corre **solo a scheda visibile**
  (`visibilitychange`: pausa col tempo residuo, ripresa al ritorno, minimo 1s).
- **Verifica:** `scratchpad/test-toast-visibility.js`.

---

## #6 — Il badge diceva sempre "20+"
**Versione:** 0.3.4 · **Sito:** hdblog · **Segnalato da:** utente

- **Sintomo:** conteggio delle non lette bloccato a "20+" invece del numero vero.
- **Causa:** il feed della home è lazy (~19 notizie caricate); se il segnalibro stava oltre,
  non c'era modo di contare più in là — hdblog non ha un archivio navigabile.
- **Correzione:** si usa come archivio l'endpoint ajax del lazy-load
  (`/new_files/ajax/pages.php?page=N`), che ricalca esattamente la sequenza della home:
  `archive.urlTemplate` + `countOnly: true` (solo conteggio, mai navigazione — le pagine
  navigabili stanno dietro Cloudflare Turnstile), `countMaxPages: 16` (~150 notizie).
- **Verifica:** `scratchpad/test-hdblog-count.js` (unit + live).

---

## #5 — Il badge diceva "42 nuove" ogni giorno
**Versione:** 0.3.3 · **Data:** 17/07/2026 · **Sito:** hwupgrade · **Segnalato da:** utente

- **Sintomo:** il numero di notizie nuove era sempre 42, qualunque fosse la situazione reale.
- **Causa:** quando il segnalibro non era nel feed della home, il conteggio ripiegava su
  `unread = feed.length` — e il feed di hwupgrade è fisso a 42 notizie. Era solo un limite
  inferiore spacciato per numero esatto.
- **Correzione:** `refineUnread()` scarica le pagine dell'archivio via `fetch` same-origin,
  le parsa con `DOMParser` e trova la posizione vera del segnalibro nella sequenza completa.
  Oltre il tetto di pagine (o su errore) il numero resta un limite inferiore ed è mostrato
  come "N+" arrotondato alla decina in giù (42 → "40+"). Cache in `count_<id>` (TTL 10 min).
- **Verifica:** `scratchpad/test-exact-count.js` (unit + live).

---

## #4 — "Vai all'ultima letta" scrollava a vuoto
**Versione:** 0.3.2 · **Sito:** hwupgrade · **Segnalato da:** utente

- **Sintomo:** il pulsante scrollava la home all'infinito senza mai trovare il segnalibro.
- **Causa:** il feed della home di hwupgrade è **fisso** (~42 notizie, nessun lazy-load): se
  la notizia segnata era più vecchia, non sarebbe comparsa mai, per quanto si scrollasse.
- **Correzione:** `feedStatic: true` (inutile scrollare) + blocco `archive` in `sites.js`:
  se il segnalibro non è nel feed, si naviga alle pagine "Tutte le notizie"
  (`/news/index[Z].html`) cercandolo pagina per pagina. Sicurezze: TTL 5 min sulla ricerca,
  tetto di 40 pagine, nessun dirottamento se sei arrivato all'archivio a mano. Sulle pagine
  archivio il segnalibro non avanza mai.
- **Verifica:** `scratchpad/test-archive-seek.js` + controllo dei selettori sull'HTML reale.

---

## #3 — Il segnalibro "scappava" e la posizione vera andava persa
**Versione:** 0.3.1 · **Sito:** tutti · **Segnalato da:** utente

- **Sintomo:** se l'ultima notizia letta era molto in basso e non si arrivava mai a vederla,
  dopo un paio di caricamenti il segnalibro diventava "l'ultima notizia caricata" e il punto
  vero era perso.
- **Causa:** il registro avanzava a **ogni** caricamento, anche quando l'utente non aveva
  mai visto il segno.
- **Correzione:** avanzamento **condizionato** al flag `reached` — il segnalibro si sposta
  solo se nella visita precedente era stato davvero visto sullo schermo
  (`IntersectionObserver`, soglia 0.5). Altrimenti resta fermo quanto serve.
  Migrazione implicita: per gli utenti esistenti `reached` è assente → al primo caricamento
  dopo l'aggiornamento il segnalibro non avanza (scelta conservativa).
- **Verifica:** `scratchpad/test-marker-reached.js`.

---

## #2 — L'evidenziazione non compariva (feed lazy)
**Versione:** 0.3.0 · **Data:** 14/07/2026 · **Sito:** tutti · **Segnalato da:** utente

- **Sintomo:** la notizia segnata spesso non risultava evidenziata.
- **Causa:** il segnalibro sta **sotto** le notizie nuove, quindi al primo caricamento non è
  ancora nel DOM (feed lazy); i tentativi a tempo fisso non bastavano, e il sito può
  ri-renderizzare la lista cancellando l'evidenziazione.
- **Correzione:** `startFeedWatch()` osserva il DOM (`MutationObserver` + listener `scroll`) e
  riapplica l'evidenziazione, protetto da una **firma** (`numFeed|idxMarker|hasClass`) per non
  ciclare sui cambi degli annunci. `scrollToMarker` scrolla giù a step finché il segnalibro
  compare, poi lo centra.
- **Verifica:** `scratchpad/test-lazy-highlight.js`.

---

## #1 — Segnalibro invertito
**Versioni:** 0.0.7 → 0.0.8 · **Data:** 13/07/2026 · **Sito:** hdblog

- **Sintomo:** il segnalibro si comportava al contrario rispetto a quanto voluto.
- **Causa:** in 0.0.7 il registro a doppio segnalibro era stato invertito per un
  fraintendimento della logica.
- **Correzione:** in 0.0.8 il registro è stato ripristinato e poi semplificato: ogni
  caricamento avanza, nessuna distinzione tra refresh e apertura (rimosso `getNavType`,
  perché un reload fatto dal sito è indistinguibile dall'F5 dell'utente — vedi #9).

---

## Altri interventi non "da segnalazione"

- **Doppioni negli interessi** (v1.x): riaprire lo stesso articolo lo registrava di nuovo e
  gonfiava i conteggi di categorie/keyword. Ora l'anti-doppioni sta in `background.js`
  (chiave `sito+articolo`: riaprire aggiorna solo il timestamp) e `dedupeInterests` ripulisce
  una-tantum i dati storici. Verificato con `scratchpad/test-dedup.js`.
- **Scritture in conflitto tra schede** (v1.x): più schede che registravano articoli insieme
  potevano sovrascriversi. Ora le scritture sono **serializzate** in `background.js`
  (`trackChain`).

---

## Regole imparate da questi bug

1. Non fidarsi del feed della home come misura del "tutto": può essere fisso (hwupgrade) o
   lazy (hdblog). Un numero che non si può calcolare va mostrato come **limite inferiore**
   ("N+"), non come dato esatto.
2. Il segnalibro deve **preferire lo stare fermo** all'avanzare a sproposito: un errore
   conservativo si recupera, una posizione persa no.
3. Mai usare `feed[0]` fuori dalla home: nelle pagine archivio è una notizia vecchia.
4. Un marcatore messo nell'URL va **anche tolto** (bug #10): finché resta, riclassifica ogni
   caricamento successivo.
5. Il tipo di navigazione non distingue il reload del sito dall'F5 dell'utente: serve un
   segnale esplicito. Corollario (#12): se un comportamento deve valere solo per certi
   ricaricamenti, il ricaricamento devono farlo l'estensione o il sito, non l'utente.
6. L'ordine del feed nel DOM non è affidabile come **insieme**: una paginazione a offset su una
   lista che cambia ripete elementi (#11). Deduplicare per chiave, sempre — e quel che si
   deduplica nel conteggio va tolto anche dalla vista, altrimenti i due non tornano.
