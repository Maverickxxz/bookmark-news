# CLAUDE.md

Estensione Chromium (Manifest V3) che, sulla **home** dei siti di notizie configurati,
evidenzia l'ultima notizia già vista e mostra sul badge dell'icona quante notizie nuove
sono uscite. Multi-sito, con segnalibro e colore indipendenti per ogni sito.

**Ogni bug corretto va registrato in `BUG.md`** (sintomo / causa / correzione / verifica,
dal più recente in cima), oltre alla spiegazione della logica qui sotto.

## Cosa fa (logica del segnalibro)

**Doppio segnalibro** (registro a scorrimento). Per sito in `chrome.storage.local`: `marker`
(1° segnalibro, evidenziato), `pending` (2° segnalibro) e `reached` (flag: nella visita il
marker è stato VISTO nel viewport — `IntersectionObserver` threshold 0.5 in `watchMarkerReached`,
riagganciato a ogni `applyHighlight` perché il sito può sostituire il nodo). NON si distingue
refresh da apertura (scelta esplicita dell'utente), ma l'avanzamento è **condizionato**:

| Caso | Azione |
|------|--------|
| Prima volta in assoluto | `marker = pending = più recente` |
| Caricamento con marker RAGGIUNTO nella visita precedente (`reached=true`) | `marker = pending precedente`; `pending = più recente` |
| Caricamento con marker MAI raggiunto (`reached` falsy) | `marker` RESTA FERMO; `pending = più recente` |

Ogni caricamento azzera `reached` (va ri-raggiunto nella visita). Le notizie "non lette" sono
quelle SOPRA il marker; il conteggio = indice del marker nel feed. Effetto "lag di un
caricamento" nel flusso normale (marker visibile): apri e vedi le nuove sopra il segno, il
caricamento dopo le raggiunge. Verificato con `scratchpad/test-marker-reached.js`
(registro + condizione `reached`, inclusa la migrazione).
Storia: v0.0.7 invertito (fraintendimento) → v0.0.8 registro ripristinato e poi semplificato:
ogni caricamento avanza, nessuna distinzione refresh/apertura (rimosso `getNavType`) →
v0.3.1 avanzamento SOLO se il marker era stato raggiunto: prima, se l'ultima letta stava oltre
il lazy-load e non la si raggiungeva mai, dopo due caricamenti il marker diventava "l'ultima
notizia caricata" e la posizione vera era persa (bug segnalato dall'utente). La migrazione è
implicita: per gli utenti esistenti `reached` è assente = falsy → al primo load post-update il
marker non avanza (conservativo), poi il flusso riparte normale.

**Ricerca nell'archivio (v0.3.2)** — su hwupgrade il feed della home è FISSO (~42 notizie
server-rendered, NESSUN lazy-load): se il marker era più vecchio, "Vai all'ultima letta"
scrollava a vuoto senza mai trovarlo (bug segnalato dall'utente). Ora i siti possono dichiarare
in `sites.js` `feedStatic: true` (inutile scrollare) e un blocco `archive`
(`urlBase`/`pathRegex`/`maxPages`): se il marker non è nel feed, `scrollToMarker` imposta il
flag `seek_<id>` = `{page, ts}` e naviga all'archivio ("Tutte le notizie",
`/news/index.html` = pag. 1, `/news/indexZ.html` = pag. Z, ~30 notizie/pagina, stesso markup).
Su ogni pagina archivio `initArchive()` cerca il marker: trovato → evidenzia+centra e rimuove
il flag; assente → naviga alla pagina successiva. Il segnalibro NON avanza MAI sulle pagine
archivio (`marker`/`pending`/`init` intatti); `reached` invece sì (stessa semantica della home:
vista l'ultima letta, al load successivo della home si avanza). Sicurezze: TTL 5 min sul flag
(ts originale conservato tra le pagine), tetto `maxPages` (40), auto-navigazione solo se
`seek.page` = pagina corrente (una visita manuale all'archivio non viene dirottata; senza flag
c'è solo evidenziazione passiva). Verificato con `scratchpad/test-archive-seek.js` + check dei
selettori sull'HTML reale (chiavi archivio = chiavi home, ultima notizia della home presente
in p1/p2).

**Conteggio esatto dall'archivio (v0.3.3)** — quando il marker NON è nel feed, il vecchio
fallback `unread = feed.length` era solo un limite inferiore: su hwupgrade (feed fisso di 42)
il badge diceva "42 nuove" ogni giorno (segnalato dall'utente). Ora, sui siti con `archive`,
`init()` avvia `refineUnread()` (asincrono): scarica le pagine archivio via `fetch` same-origin
(nessun permesso extra), le parsa con `DOMParser` + `collectArticles` (la ex `getFeedArticles`
generalizzata a root/baseUrl, stessi selettori) e conta la posizione del marker nella sequenza
completa = numero VERO di non lette (verificato live: la sequenza archivio ricalca la home,
home[i] ha esattamente i notizie sopra anche nell'archivio). Tetto `COUNT_MAX_PAGES` = 5
(~150 notizie); oltre, o su errore rete/markup, resta il limite inferiore mostrato come "N+"
arrotondato alla decina in giù (42 → "40+", scelta dell'utente; `formatUnread` in `sites.js`,
logica replicata nel SW che non carica sites.js). Il toast ASPETTA l'esito del conteggio (flag
`refining`, così non mostra prima "40+" e poi il numero vero); badge e popup mostrano intanto
"N+". Cache in `count_<id>` = `{marker, newest, count, exact, ts}` (TTL 10 min, valida solo per
la stessa coppia marker/più-recente) per non riscaricare l'archivio a ogni refresh. Dedup tra
pagine contigue (il feed può scorrere tra un fetch e l'altro); "Segna tutte come lette" azzera
il conteggio in corso. Verificato con `scratchpad/test-exact-count.js` (unit + live).

**Toast "a tempo di sguardo" + conteggio esatto su hdblog (v0.3.4)** — due richieste utente:
(1) aprendo più home in schede in background, il toast partiva al load e i 7s scadevano prima
di arrivare sulla scheda (perso dopo ~20s). Ora il conto alla rovescia corre SOLO a scheda
visibile (`visibilitychange`: pausa col tempo residuo al cambio scheda, ripresa al ritorno,
minimo 1s; in una scheda in background il toast ASPETTA l'utente e poi resta i 7s pieni).
(2) su hdblog il badge diceva "20+": feed lazy, il marker spesso è oltre le ~19 notizie
server-rendered e non c'era archivio per `refineUnread`. L'endpoint ajax del lazy-load
(`/new_files/ajax/pages.php?page=N`, numerato da 1, ~9-10 notizie/pagina; home = pagine 1-2,
il bottone "Altre Notizie" parte da page=3) ricalca esattamente la sequenza della home
(verificato live: home = prefisso di p1+p2+p3), quindi fa da archivio per il conteggio:
`archive.urlTemplate` (URL con `{n}` al posto del numero, in alternativa a `urlBase`),
`countOnly: true` = SOLO conteggio, mai navigazione (è un frammento HTML nudo — allora si
credeva che le pagine `/page/N/` fossero irraggiungibili; in v0.3.9 `countOnly` è stato
sostituito da `countTemplate`, cioè sorgente del conteggio e archivio navigabile come due campi
distinti), `countMaxPages: 16` (~150 notizie, come hwupgrade col default 5 × ~30; sceso a 10 in
v0.3.9, dove il muro dell'endpoint è stato misurato). Con conteggio oltre il tetto (exact=false) il badge mostra il maggiore
tra conteggio archivio e feed caricato (entrambi limiti inferiori). Verificato con
`scratchpad/test-toast-visibility.js` (timer: background 20s, pausa/ripresa, minimo 1s) e
`scratchpad/test-hdblog-count.js` (unit `archiveUrlFor` + live). NB: hdblog rifiuta
l'handshake TLS di Node (ECONNRESET; browser e PowerShell passano, l'estensione non è
toccata): il check live ha un fallback che scarica via `Invoke-WebRequest` (con TLS 1.2
forzato: il PowerShell figlio `-NoProfile` parte con TLS 1.0).

**Refresh automatico del sito + comandi nell'archivio (v0.3.5)** — due segnalazioni utente:
(1) su hdblog il segnalibro avanzava da solo su notizie mai lette. Causa: la home contiene
`<meta http-equiv="refresh" content='777;url=https://www.hdblog.it/?refresh_ce'/>` e la pagina
di arrivo **ripete lo stesso tag**, quindi la home si ricarica da sola ogni ~13 min finché la
scheda resta aperta (verificato scaricando `/` e `/?refresh_ce`: identiche, tag incluso;
hwupgrade non ce l'ha). `init()` contava quel caricamento come visita nuova: con `reached=true`
(probabile dopo 13 min di lettura) il marker avanzava a `pending`, e dal 2° refresh in poi
l'URL non cambia più (`?refresh_ce` → `?refresh_ce`) quindi Chrome ripristina lo scroll e la
pagina si ricarica sotto l'utente con l'evidenziazione spostata. Ora `sites.js` ha
`autoRefreshParam` (per hdblog `"refresh_ce"`): se l'URL porta quel parametro il caricamento è
la **stessa visita** — `marker` e `pending` restano fermi (pending congelato apposta: alla
prossima visita vera si riparte dalla più recente di quando hai APERTO la pagina, non da quelle
uscite mentre leggevi) e `reached` NON si azzera. Si usa un marcatore nell'URL e non il tipo di
navigazione perché un `reload()` del sito è indistinguibile dall'F5 dell'utente (era il motivo
per cui `getNavType` fu rimosso in v0.0.8). (L'effetto collaterale — F5 manuale sull'URL
`?refresh_ce` che non avanza — è stato poi eliminato in v0.3.6, sotto.)
(2) su hwupgrade i pulsanti del popup sparivano sulle pagine archivio `/news/index[Z].html`:
lì `initArchive()` metteva `lastStatus = {onHome:false, archive:true}` e `popup.js/boot()`
mandava tutto su `renderOffHome`. Non era un caso limite: è "Vai all'ultima letta" stesso a
portarti lì (`startArchiveSeek`). Ora `initArchive` compila uno `lastStatus` completo
(`archivePage`, `found`, `markerTitle`, `total`, più `unread`/`approx` letti da `status_<id>` =
ultimo stato noto della HOME, lo stesso numero del badge, che ora viene anche impostato) e il
popup rende il pannello principale anche con `status.archive`, con titolo "· archivio p.N" e
testo dedicato quando il marker non è in quella pagina. **`markAllRead` non può usare `feed[0]`
nell'archivio** (è una notizia vecchia: sposterebbe il segnalibro all'INDIETRO gonfiando le non
lette): usa `pending_<id>` = più recente all'ultimo caricamento della home, azzera badge/stato
e riscrive `status_<id>`; è diventata async, quindi il gestore messaggi risponde in modo
asincrono. `startArchiveSeek(page)` ora accetta la pagina di partenza: da una pagina archivio
la ricerca prosegue da quella DOPO invece di rifare il giro da 1. Verificato con
`scratchpad/test-autorefresh-archive.js` (30 controlli: registro sotto auto-refresh, gating del
popup, markAllRead in archivio, prosecuzione della ricerca) + markup reale delle pagine
archivio (30 `li.news-item` con `h3 a` su `index.html` e `index3.html`).

**L'URL del refresh automatico va ripulito (v0.3.6)** — conseguenza della v0.3.5 segnalata
dall'utente: dopo l'auto-refresh la scheda restava "incollata" su
`https://www.hdblog.it/?refresh_ce`, e siccome quel parametro È il segnale di riconoscimento,
da lì in poi **ogni** caricamento sembrava automatico — il segnalibro non avanzava più
"neanche refreshando 100 volte" (l'F5 ricarica l'URL della barra, che porta ancora il
parametro; il sito stesso poi ripunta a `?refresh_ce`, quindi non se ne usciva). Ora
`content.js` legge il parametro **una volta sola** all'avvio (costante `autoRefreshLoad`, non
più `location.search` a ogni chiamata) e subito dopo lo toglie dall'URL con
`stripAutoRefreshParam()` → `history.replaceState` (riscrive la barra degli indirizzi SENZA
ricaricare: la scheda resta dov'è, la cronologia torna alla home pulita, gli altri parametri
e l'ancora sono conservati). Così il caricamento in corso resta trattato come auto-refresh
(segnalibro fermo, `reached` conservato) ma tutti quelli successivi tornano visite vere.
Il meta refresh del sito punta all'URL **assoluto** col parametro, quindi il prossimo
auto-refresh viene comunque riconosciuto (e ripulito a sua volta): la catena è stabile.
Bonus: l'URL ora alterna `/` → `/?refresh_ce`, quindi Chrome non ripristina più lo scroll a
ogni auto-refresh (l'altro sintomo descritto in v0.3.5). Verificato con
`scratchpad/test-autorefresh-url.js` (36 controlli: pulizia URL, scenario "auto-refresh poi
F5 a mano", 5 auto-refresh a catena, siti senza `autoRefreshParam`).

**Doppioni del feed + ricarica che non sposta il segnalibro (v0.3.7)** — segnalato dall'utente:
su hdblog «delle volte le notizie vengono duplicate» (con 41 arretrate, risalendo il feed molte
comparivano due volte). Causa: **non è l'estensione, è il sito**. Il lazy-load
(`pages.php?page=N`) è paginato a **offset sulla lista VIVA** e ricalcola le posizioni a ogni
richiesta; la home è renderizzata all'apertura (blocchi 1-2), i blocchi dopo arrivano mentre
scorri, quindi ogni notizia pubblicata nel frattempo fa scalare la sequenza di una posizione e il
blocco che arriva **ripete le ultime già in pagina**. Misurato dal vivo: pubblicata `n666098`, la
pagina 3 è passata da iniziare con `n666081` a iniziare con `n666086`, che era l'ultima della home
già mostrata (diagnostica riutilizzabile: `scratchpad/diag-hdblog-dup.js`). Il **conteggio non era
gonfiato** (`collectArticles` deduplicava già): era un difetto di sola visualizzazione.
Ora `collectArticles` tiene da parte gli scarti in `out.dups` (e il numero di nodi grezzi in
`out.raw`) e `hideDuplicates()` nasconde le occorrenze **successive alla prima** con `.hdb-dup`
(`display:none`) — la prima sta nella posizione cronologica giusta ed è quella evidenziata; il
confronto è sulla chiave dell'articolo, quindi due notizie diverse non collidono mai. Si ripulisce
prima di ri-marcare (`applyHighlight` è idempotente e il sito ri-renderizza), e `feed.raw` entra
nella firma `currentSig` perché un blocco di **soli** doppioni non cambierebbe il numero di
distinte e resterebbe visibile. Interruttore `hideDupes` in Impostazioni (default true).
Seconda metà della segnalazione: ricaricare la pagina **toglie i doppioni** (il server rirende
tutto in un'istantanea coerente; su hdblog l'ancora `#?t=…&b=N`, che scrive lui stesso mentre
scorri, gli fa richiedere in una volta sola tutti i blocchi già aperti) **ma sposta il segnalibro**,
perché con `reached=true` il caricamento vale come visita e `marker` avanza a `pending`. Siccome
l'F5 dell'utente non è distinguibile (lezione di v0.0.8), la ricarica deve farla l'estensione:
`autoRefreshParam` è stato generalizzato a `sameVisitParams()` = marcatore del sito + il nostro
`hdbkeep`, e il pulsante **«Ricarica pulita»** del popup chiama `reloadKeepingMarker()`
(`location.replace` con `?hdbkeep=1`, **ancora conservata**). `init()` lo tratta come stessa visita
(`marker`/`pending` fermi, `reached` conservato) e `stripVisitParams()` toglie subito il parametro
(lezione di v0.3.6). Il flag `rescroll_<id>` (`{ts}`, TTL 2 min, **consumato sempre**) riporta poi
l'utente all'ultima letta: la ricarica non costa né il segnalibro né il punto di lettura. Attenzione
alla condizione: il salto guarda `keepLoad` (SOLO `hdbkeep`), non `sameVisitLoad` — un flag rimasto
appeso verrebbe altrimenti raccolto dal primo auto-refresh del sito, che trascinerebbe la pagina
sotto gli occhi dell'utente (il sintomo di v0.3.5). L'F5 a mano resta di proposito una visita vera.
Verificato con `scratchpad/test-clean-reload-dupes.js` (44 controlli: doppioni sulla sequenza reale
misurata, idempotenza e re-render, firma con blocco di soli doppioni, registro sotto ricarica
pulita, F5 a mano invariato, flag che non resta appeso, siti senza `autoRefreshParam`).

**Il feed della home ha un muro: l'archivio di hdblog (v0.3.9)** — segnalato dall'utente al
ritorno da una vacanza lunga (>99 arretrate): su hwupgrade "Vai all'ultima letta" funziona, su
hdblog «si è fermato sul bottone "clicca qui per altre notizie" che mi porta ad un'altra pagina
`/page/2/`». Il lazy-load di hdblog **si ferma a `pages.php?page=10`** (da `page=11` il server
risponde con un blocco vuoto contenente solo `var autoloading_disabled = true`; stesso tetto nel
JS del sito, `MAX_NUM_PAGES = 10`): home (~19) + pagine 3..10 = **~99 notizie**, punto. Più
indietro di così `scrollToMarker` scrollava a vuoto e usciva in silenzio, lasciando l'utente sul
bottone — che non carica altro in pagina ma **naviga** su `/page/N/`.
**Tentativo scartato:** scaricare quelle pagine con `fetch` e appenderle alla home. Sull'endpoint
ajax funziona (ma è proprio il pezzo che finisce a ~99), mentre `/page/N/` risponde **429 a
qualunque client che non sia una navigazione vera del browser** — PowerShell, Node, fetch remoto
e, provato dall'utente, anche il `fetch` del content script. Codice rimosso: una pagina protetta
si raggiunge navigandoci, non scaricandola.
**Come funziona ora:** `/page/N/` *è* l'archivio di hdblog, quindi si riusa la macchina di
v0.3.2 già collaudata su hwupgrade (flag `seek_<id>` + `initArchive`, una pagina alla volta finché
il marker compare, poi evidenziazione e centratura). In `sites.js` l'`archive` di hdblog diventa
navigabile (`urlTemplate: ".../page/{n}/"`, `pathRegex`, `maxPages: 40`) con due campi nuovi:
`firstPage` (2 — la pagina 1 ripete quel che sta già nella home, ed è dove porta il bottone del
sito) e `countTemplate`, la sorgente **separata** per il conteggio: l'endpoint ajax, l'unico
scaricabile (`countUrlFor` vs `archiveUrlFor`). Sparisce `countOnly` ("archivio buono solo per
contare"): ora sono due campi distinti, e la scelta della strada in `seekMarker` è di nuovo una
sola (`site.archive` → archivio).
**Contro il silenzio** — metà del guasto era che non diceva niente: `showSeekToast` (rotellina,
riusa lo stile del toast) accompagna la ricerca pagina per pagina, e a fine corsa spiega perché si
è fermata (tetto, pagina vuota, TTL scaduto per strada); la × la annulla togliendo il flag `seek`,
così la pagina dopo non riparte da sola. Lo scroll di ricerca — fino a ~25 secondi — viene
**saltato** quando è inutile: feed statico, pagina d'archivio, o conteggio che ha già sfogliato
tutto il feed della home senza trovare il segnalibro (`refined.exact === false` = oltre il muro).
`SEEK_TTL_MS` sale da 5 a 10 minuti perché la passeggiata può durare decine di caricamenti veri.
Nella stessa occasione `countUnreadInArchive` ha smesso di **buttare via** il conteggio quando
incontra una pagina vuota (su hdblog succede sempre, a `page=11`): quel che ha contato resta un
limite inferiore ("90+" invece di ricadere sul numero di notizie caricate in pagina), e
`countMaxPages` è sceso da 16 a 10. Verificato con `scratchpad/test-hdblog-archive.js`
(45 controlli + check live: muro a pagina 10, `/page/2/` non scaricabile da fuori).

**Arrivare fino al muro, e sapere quando fermarsi (v0.4.1)** — segnalato dall'utente: con **97
notizie nuove** "Vai all'ultima letta" ha scrollato la home, è passato a `/page/N/` ed è arrivato
**fino a pagina 40** senza trovare niente («è come se avesse perso il segnalibro»); cercando a mano
la notizia era lì, evidenziata. Il segnalibro non si era perso: 97 non lette **esatte** vuol dire
che stava alla posizione 97, cioè la 98ª di ~100 — **dentro** il feed della home. Quattro cause
sovrapposte, tutte misurate sul sito vero:
1. **la ricerca mollava la home dopo 1,6 secondi** — la vecchia condizione di uscita era "8 giri di
   fila senza che `scrollY` cambi", e ogni blocco lazy è una richiesta di rete da 1-3 secondi
   durante la quale la pagina è già in fondo e non si muove. Ora `growFeedByScrolling()` guarda la
   **crescita del feed**, non il movimento dello scroll: si smette dopo 7s di immobilità totale, 20s
   senza notizie nuove (pagina che si gonfia di pubblicità), o 90s di tetto. Con blocchi da 6
   secondi arriva comunque in fondo;
2. **l'archivio comincia dopo la home**: `/page/2/` è dove porta il pulsante del sito *dopo* il
   muro, quindi la 98ª notizia non poteva starci — sfogliare da lì era tempo perso per costruzione;
3. **di ogni pagina d'archivio si guardava solo la prima fetta**: le `/page/N/` hanno lo stesso
   stampo della home (~20 renderizzate, il resto scrollando), e `initArchive` leggeva solo quelle.
   Ora le scrolla come la home — ma **solo durante una ricerca**: una visita normale all'archivio
   non deve muoversi da sola (sui feed statici, hwupgrade, la funzione esce subito);
4. **il sito porta via la pagina da solo**: in fondo alla home il suo handler dello scroll fa
   `$('.btn_more').click()`, e finito il lazy-load quel pulsante è un semplice link a `/page/2/`
   (l'ultimo blocco servito contiene `<a href="/page/2/" class="btn_more">` senza più `onclick`).
   `installAutoNavGuard()` annulla la navigazione dei clic **non fidati** (`isTrusted === false` =
   generati da script) per la durata della ricerca: i clic dell'utente passano, e l'handler inline
   del sito gira lo stesso perché `preventDefault` toglie la navigazione, non il caricamento del
   blocco. Doppia sicurezza: il flag `seek` si mette **prima** di scrollare e accetta le pagine
   **≥** a quella attesa, così se il sito ci sposta lo stesso la pagina d'arrivo riprende la ricerca
   invece di lasciare l'utente fermo lì.

**Quando smettere di sfogliare l'archivio.** La passeggiata si porta dietro `seek.target` = la
posizione esatta del segnalibro (dal conteggio; da una pagina d'archivio, dall'ultimo stato noto
della home se era un numero esatto — `exactMarkerIndex()`). L'archivio va **solo indietro nel
tempo**: dopo aver esaminato più di `target` notizie a partire dalla prima pagina, il segnalibro è
per forza alle spalle — o l'archivio comincia dopo di lui, o non lo elenca affatto (le notizie
hdmotori che compaiono nella home, per esempio, sono ~17% del feed). In entrambi i casi continuare
è inutile: ci si ferma dicendolo, invece di arrivare a pagina 40. Senza conteggio esatto restano i
vecchi limiti (pagina vuota, `maxPages`, TTL).

**Conteggio in una richiesta sola.** `pages.php` accetta il parametro **`b`** che il sito stesso usa
quando ricarica una home già scorsa (hash `#?t=…&b=N` → `check_hash_url` → `pages.php?page=3&b=N`):
con `page=1&b=10` risponde con **tutti i blocchi insieme**, cioè le ~100 notizie raggiungibili, in
un'**unica istantanea coerente**. Prima erano 10 fetch separati su una lista **viva**: se il sito
pubblicava nel frattempo la sequenza scivolava e le ultime notizie si perdevano per strada (stesso
difetto che genera i doppioni, v0.3.7). Ora `countMaxPages: 1` e `refined.exact` è un segnale di cui
fidarsi: dice esattamente se il segnalibro è dentro o oltre il muro — ed è quello che decide se
scrollare la home o andare dritti all'archivio. Verificato con `scratchpad/test-deep-seek.js`
(38 controlli + check live: una richiesta = ~100 notizie senza doppioni, home = prefisso della
sequenza, muro a `page=11`, `/page/2/` che risponde 429 al fetch).

**hdblog ha cambiato il caricamento: archivio statico, niente più scroll (v0.4.2)** — segnalato
dall'utente: «delle volte il sito carica male il segnalibro, oppure passa attraverso il segnalibro
e continua a scrollare le pagine» (bug #16). Due cambi del sito, misurati in Chrome headless:
(1) il lazy-load della home **appende ogni blocco due volte** (gara fra il precaricamento del sito
e il clic sul suo pulsante: **intermittente**), il contatore `MAX_NUM_PAGES` si esaurisce dopo
`page=6` e la home arriva a **~60 notizie distinte** invece di ~100 — mentre il conteggio
(`pages.php?page=1&b=10`) ne vede ancora 100, quindi un segnalibro fra la 60ª e la 100ª è "esatto"
ma introvabile scrollando; (2) **`/page/N/` è diventato statico**: 100 notizie già nel DOM,
paginazione numerata, e **`/page/1/` = la sequenza completa della home** (`/page/2/` dalla 101ª).
La ricerca partiva da `/page/2/`, cioè già oltre, e scrollava ogni pagina statica fino in fondo.
Ora in `sites.js` hdblog ha `noScrollSeek: true` (se l'ultima letta non è già in pagina si va
**dritti all'archivio**, senza scrollare la home) e l'archivio `firstPage: 1`, `perPage: 100`,
`static: true` (niente scroll nelle pagine), `idOrdered: true`; più `articleExclude:
"#listnewssdx"`, la barra laterale in fondo alle `/page/N/` con le 5 notizie più recenti e la
stessa classe del feed. In `content.js`: `archiveStartPage(pos)` salta alla **pagina che contiene
la posizione nota** (`markerPositionLowerBound()` = conteggio esatto o limite inferiore; le
posizioni col tempo possono solo crescere, quindi non si salta mai oltre): 0-99 → pagina 1,
"100+" → pagina 2; `pageOlderThanMarker()` ferma la ricerca quando il 90% degli id di una pagina è
più basso di quello del segnalibro (su hdblog l'id cresce con la data, salvo pochi ripubblicati):
prova di "sei già oltre" che non dipende dal conteggio; `waitFeedSettled()` concede al feed 1,5s
(max 6s) per assestarsi prima di lasciare la home — dopo "Ricarica pulita" il sito riapre tutti i
blocchi con una richiesta sola. Il lazy-load raddoppiato resta visibile solo come doppioni, che
`hideDuplicates` già nasconde. Verificato con `scratchpad/test-live-seek.ps1`: il VERO
`content.js` in Chrome headless sulla home vera (DevTools Protocol da PowerShell, `chrome.storage`
simulato in localStorage; strumenti in `scratchpad/live/`), 7 scenari. **Node non è installato**
su questa macchina: i vecchi `test-*.js` non girano finché non lo si installa.

## File

- `manifest.json` — MV3; `matches` elenca gli host; carica `sites.js` poi `content.js`.
- `sites.js` — **registro dei siti** (`NEWS_SITES`) + helper condivisi (`findSiteForUrl`, `isSiteHome`). Caricato sia dai content script sia dal popup.
- `content.js` — logica generica (usa la config del sito attivo). Storage per-sito: `marker_<id>`, `pending_<id>`, `initialized_<id>`, `reached_<id>`, `seek_<id>`, `count_<id>`, `rescroll_<id>`. Mostra anche un toast in pagina (`renderToast`) col numero di notizie nuove, solo quando `unread > 0`; auto-dismiss dopo 7s di scheda VISIBILE (in background aspetta; pausa/ripresa su `visibilitychange`), una volta per caricamento; un secondo toast (`showSeekToast`, con rotellina) accompagna la ricerca dell'ultima letta — sia mentre carica il feed a forza di scroll (`growFeedByScrolling`, con il conto delle notizie caricate) sia mentre sfoglia l'archivio — e dice perché si è fermata; la sua × la annulla togliendo il flag `seek`. Sulle pagine ARTICOLO chiama `trackArticle()`, che NON scrive: invia l'entry al service worker.
- `content.css` — evidenziazione + toast in basso a destra; colore per sito via variabili `--hdb-accent*` impostate da JS.
- `background.js` — imposta il badge (numero + colore) per tab; riceve `trackArticle` e scrive gli interessi in modo **serializzato** (`trackChain`) per evitare race tra schede; qui stanno l'**anti-doppioni** (un articolo si registra una sola volta per `sito+chiave` = `entryId`; riaprirlo aggiorna solo il `ts` di ultima apertura, senza ricontare cat/keyword), gli aggregati e il cap a 1000. `dedupeInterests` è la migrazione una-tantum (a onInstalled + avvio SW) che ripulisce i doppioni storici e ricostruisce i conteggi dalla lista deduplicata (idempotente).
- `popup.html/js/css` — stato + pulsanti (vai all'ultima letta / **ricarica pulita** / segna tutte come lette) + nota sui doppioni nascosti + avviso "segnalibro bloccato" (`status.frozen`) + link Impostazioni + stato "disattivata". I pulsanti compaiono sulla **home** e sulle **pagine archivio** (`status.archive`, v0.3.5); su articoli/sezioni e su hdmotori resta il pannello "apri la home". "Ricarica pulita" è nascosta nell'archivio (lì il feed è storico).
- `options.html/js/css` — **pagina Impostazioni** (`options_ui`, apre in tab): card di sostegno
  in cima (link facoltativo a `revolut.me/maverickx`, `target="_blank"` + `rel="noopener"`; nessun
  pagamento gestito dall'estensione, nessuno sblocco di funzioni — vale anche come regola: il
  link sta SOLO qui, mai iniettato nelle pagine dei siti, che è causa di rimozione dallo store),
  poi 5 interruttori (compreso "Non spostare mai il segnalibro", v0.3.9) + card finale "Segnalazioni e codice sorgente" (mail di feedback come
  TESTO semplice — niente `mailto:` né pulsante, scelta dell'utente — e link al repo GitHub,
  stessi vincoli del link di sostegno) + vista degli interessi (categorie/keyword aggregate + elenco articoli aperti) + eliminazione singola (`deleteEntry`, decrementa gli aggregati) o totale + **export** (`exportJSON` = articoli+keyword+categorie; `exportCSV` = articoli, con BOM; `exportIgnore` = parole da ignorare in .txt, una per riga, ordinate/deduplicate — pensato per raccogliere i file degli utenti e unirli in futuro alle liste predefinite) + gestione "Parole da ignorare". Include `sites.js` per i nomi dei siti.

Nota debug (v0.0.8): `content.js` logga in console `[Segnalibro] content script attivo: …`, `[Segnalibro] articolo registrato: …` e `[Segnalibro] pagina NON riconosciuta come articolo: …`. Servono a diagnosticare i casi in cui il tracciamento non parte (es. content script non iniettato per accesso-al-sito ristretto). Rimuovibili quando non servono più.
- `rileva-selettori.js` — **strumento** (non parte dell'estensione): da incollare nella Console per ricavare i selettori di siti che bloccano il fetch remoto.
- `build.ps1` — **pacchetto per il Web Store**: elenco ESPLICITO dei file che spediscono (whitelist,
  non esclusioni: scratchpad, CLAUDE.md, BUG.md, STORE.md, README e strumenti restano fuori),
  controllo del limite di 132 caratteri su `description` e ZIP costruito con `ZipArchive` scrivendo
  i nomi con `/` (`Compress-Archive` di PS 5.1 usa `\` e su Linux le icone si perderebbero, vedi
  BUG #13). Output in `dist/` (in `.gitignore`).
- `PRIVACY.md` — informativa privacy, obbligatoria per la scheda dello store. Va tenuta allineata
  al codice: se un giorno l'estensione mandasse qualcosa in rete, va aggiornata PRIMA.
- `STORE.md` — testi pronti della scheda (nome, descrizioni, scopo unico, giustificazione dei
  permessi, screenshot) e checklist di pubblicazione, incluso il **trader status** UE.
- `BUG.md` — **storico dei bug risolti** (sintomo / causa / correzione / verifica, dal più recente). Da aggiornare a ogni correzione.

## Impostazioni e tracciamento (v1.3)

Impostazioni in `chrome.storage.local` chiave `settings` =
`{ enabled, showToast, hideDupes, trackInterests, freezeMarker }` (i primi quattro default `true`,
`freezeMarker` default `false`). `content.js/init()` le legge: se `!enabled` non fa nulla (badge
svuotato, `lastStatus.disabled=true`); `showToast` abilita/disabilita il toast delle notizie nuove
(quello della RICERCA no: è la risposta a un clic, non un avviso che arriva da solo); `hideDupes`
lo scarto visivo dei doppioni (v0.3.7); `trackInterests` la raccolta.
**`freezeMarker` (v0.3.9, chiesto dall'utente)** = segnalibro BLOCCATO: non avanza mai da solo,
nemmeno dopo averlo raggiunto — solo "Segna tutte come lette" lo sposta. È un caso in più nel
registro di `init()`, subito dopo "stessa visita" e prima di `reached`; `pending` continua ad
aggiornarsi, così spegnendo l'opzione il registro riparte di un passo dalla più recente
dell'ultimo caricamento. Nasce da un arretrato di centinaia di notizie, dove il segnalibro è il
punto di ripartenza e deve muoverlo solo l'utente. Il popup lo dice (`status.frozen`), altrimenti
"non si sposta mai" sembra un guasto.
**Applicate al caricamento pagina** (serve ricaricare le schede dopo aver cambiato un'opzione).

Tracciamento (100% locale, nessuna rete): pagina articolo = `isArticlePage()` = `idRegex` matcha
il pathname **oppure** `meta og:type=article` (fallback universale, serve per hdmotori).
`content.js` estrae categoria (`meta article:section` → `categorySelector` → segmento URL
`catPathIndex`) e parole chiave: PRIMA i tag veri (`article:tag`, `news_keywords`, `keywords` solo
se con virgole, `keywordsSelector`); POI **sempre** i "token forti" dal titolo via
`extractStrongTokens` — acronimi (AI, USB, GPU) e sigle prodotto (PS5, 5G, S24, RTX4090); questi
bypassano `isStop` apposta (altrimenti "AI" deaccentato = "ai" = preposizione stopword) e
distinguono l'acronimo dal titolo "gridato" (se il titolo è quasi tutto maiuscolo, gli acronimi di
sole lettere non contano); SOLO se **non c'erano tag veri** (`hadRealTags`, deciso prima di aggiungere
i token forti così "ai" non sopprime il fallback) estrae **keyphrase dal titolo con RAKE**
(`keyphrasesRake`): la punteggiatura spezza in blocchi, e dentro ogni blocco stopword/verbi
(`isStop` = `IT_STOPWORDS` + `IT_VERBS`, ~650 forme, confronto deaccentato) + **parole generiche**
(`IT_GENERIC`: prezzo, offerta, recensione, uscita, migliori… — genericità della LINGUA, non IDF sul
corpus personale, che declasserebbe gli interessi dell'utente) + parole ignorate + numeri + parole
<4 char fanno da delimitatori; le parole di contenuto contigue restano UNITE ("intelligenza
artificiale"), punteggio RAKE `deg/freq`. Manda l'entry al service
worker. `background.js` scrive (serializzato) in chiave `interests` =
`{ categories:{name:count}, keywords:{name:count}, opened:[…max 1000], totalOpened }` (dedup per
`sito+chiave`; riaprire un articolo non crea doppioni né gonfia i conteggi).
La pagina opzioni si aggiorna live via `storage.onChanged`. Verifiche: `scratchpad/test-track.js`
(estrazione), `scratchpad/test-keywords.js` (stopword/junk), `scratchpad/test-strong-tokens.js`
(acronimi/sigle: AI, PS5…), `scratchpad/test-rake.js` (keyphrase RAKE + generiche + composizione
tag/forti), `scratchpad/test-dedup.js` (anti-doppioni + migrazione).

L'utente può bandire parole tramite la chiave storage `ignoreWords` (array): `content.js` le
esclude in fase di estrazione (`isIgnored`, confronto deaccentato); la pagina opzioni le gestisce
(card "Parole da ignorare", × sui chip delle keyword) e con `ignoreWord()` le rimuove anche dai
dati già raccolti (aggregato `keywords` + `opened[].kw`). Verificato con `scratchpad/test-ignore.js`.

## Siti configurati

- **hdblog** (`www.hdblog.it`): `article.newlist_normal` → `a.title_new`; id `nXXXXXX`. ✅ verificato.
  Feed home LAZY; conteggio esatto dall'endpoint ajax del lazy-load
  (`archive.countTemplate`: solo fetch, mai navigazione), vedi v0.3.4 — con
  `?page=1&b=10`, cioè **tutti i blocchi in una richiesta sola** e in un'istantanea coerente
  (v0.4.1), `countMaxPages: 1`.
  Il lazy-load **si ferma a `pages.php?page=10`** (~100 notizie in tutto) e da settembre 2026
  **raddoppia i blocchi** a intermittenza, fermandosi a ~60 notizie distinte: per questo
  `noScrollSeek: true`, la ricerca non scrolla la home (v0.4.2). L'archivio navigabile `/page/N/`
  — quello del bottone "Clicca qui per Altre Notizie" — è **statico, 100 notizie a pagina**, e
  `/page/1/` = la sequenza completa della home: la ricerca salta alla pagina della posizione nota
  (`firstPage: 1`, `perPage: 100`, `static: true`, `idOrdered: true`; v0.4.2). Quelle pagine si
  possono solo NAVIGARE: al fetch senza cookie rispondono 429 (col cookie del sito, in Chrome,
  rispondono 200 — non usato: il conteggio resta senza credenziali, vedi PRIVACY.md). In fondo a
  ogni `/page/N/` una barra laterale `#listnewssdx` ripete le 5 notizie più recenti con la stessa
  classe del feed → `articleExclude`.
  La home si **auto-ricarica** ogni 777s via meta refresh su `/?refresh_ce` →
  `autoRefreshParam: "refresh_ce"` impedisce che quei caricamenti facciano avanzare il
  segnalibro (v0.3.5); il parametro viene poi tolto dall'URL con `replaceState` così la
  scheda torna alla home pulita e i caricamenti manuali contano di nuovo (v0.3.6).
  Il lazy-load è paginato **a offset sulla lista viva**: se il sito pubblica mentre scorri, i
  blocchi che arrivano ripetono le notizie già in pagina → `hideDuplicates` (v0.3.7).
- **hwupgrade** (`www.hwupgrade.it`): `#news-container li.news-item` → `h3 a`; id prima di `.html`. ✅ verificato.
  Feed home FISSO → `feedStatic: true` + archivio paginato `/news/index[Z].html` (`archive`), vedi
  "Ricerca nell'archivio". (Nell'archivio compaiono anche notizie di `greenmove.hwupgrade.it`:
  la chiave resta l'id numerico, coerente con la home.)
- **hdmotori** (`www.hdmotori.it`): `trackingOnly` — nessun segnalibro, solo tracciamento articoli (rilevati via `og:type=article`, URL a solo slug senza id numerico).

## Da fare / in sospeso

- **tomshw.it**: richiesto dall'utente ma blocca il fetch remoto (403, Cloudflare). Servono i
  selettori dal browser dell'utente tramite `rileva-selettori.js`, poi aggiungerlo a
  `sites.js` + `manifest.json`.

## Come aggiungere un sito

1. Blocco in `NEWS_SITES` (`sites.js`) — campi chiave: `articleSelector` (ogni notizia del feed,
   dalla più recente in alto) e `linkSelector` (link titolo dentro la notizia).
2. Host in `manifest.json` → `content_scripts[0].matches` (`https://HOST/*`).
3. Ricaricare l'estensione da `chrome://extensions` (o `brave://extensions`).

## Regole / cosa NON fare

- **Ordine = ordine del DOM**, non ordinare per ID numerico (gli ID non sono monotoni con la
  data, vedi hwupgrade). Il primo elemento del feed è "la più recente".
- `linkSelector` va provato **in ordine di priorità** (funzione `pickLink`): il primo selettore
  deve puntare al link del TITOLO, non all'immagine (altrimenti titolo vuoto).
- Agire **solo sulla home** (`homePaths`), non sulle pagine dei singoli articoli/categorie.
- **Non** ricalcolare/avanzare il segnalibro fuori da `init()`; `applyHighlight()` è idempotente
  e può girare più volte. Il feed è **lazy** (le notizie sotto la piega si caricano scrollando) e
  il sito può ri-renderizzare la lista: `startFeedWatch()` osserva il DOM (`MutationObserver` +
  listener `scroll`) e richiama `applyHighlight` via `reapplyIfChanged` — protetto da una **firma**
  (`currentSig` = `numFeed|idxMarker|hasClass`) per non ciclare sull'ad-churn e per convergere.
  Il marker "ultima letta" sta SOTTO le notizie nuove, quindi spesso non è nel DOM al primo load:
  i vecchi retry a tempo fisso non bastavano. `scrollToMarker` (bottone "Vai all'ultima letta" e
  popup) scrolla giù a step (`growFeedByScrolling`) per forzare il caricamento finché il marker
  compare, poi lo centra; se il feed finisce senza trovarlo la ricerca prosegue **nell'archivio**
  del sito, pagina per pagina (`site.archive`, v0.3.2 per hwupgrade e v0.3.9 per hdblog) —
  scrollando anche quelle se sono lazy (v0.4.1; non se `archive.static`, v0.4.2). Lo scroll si
  salta quando non può servire (feed statico, pagina d'archivio, marker già noto come "oltre il
  muro", lazy-load dichiarato inaffidabile con `noScrollSeek` — hdblog dalla v0.4.2). Verificato
  con `scratchpad/test-lazy-highlight.js`, `scratchpad/test-deep-seek.js` e
  `scratchpad/test-live-seek.ps1`.
- La condizione per smettere di scrollare è **la crescita del feed**, non il movimento dello
  scroll: mentre arriva un blocco lazy la pagina è già in fondo e non si muove per interi secondi,
  e chi guarda `scrollY` scambia quell'attesa per "fine della pagina" (bug #15: la ricerca mollava
  dopo 1,6 secondi una home che ne voleva 15). Pazienza: 7s di immobilità totale, 20s senza notizie
  nuove, 90s di tetto.
- Il sito può **navigare via da solo** mentre scrolliamo (hdblog: il suo handler dello scroll fa
  `$('.btn_more').click()`, e a lazy-load finito quel pulsante è un link a `/page/N/`). Durante una
  ricerca i clic **non fidati** (`isTrusted === false`) non navigano, vedi `installAutoNavGuard`:
  solo `preventDefault`, mai `stopPropagation`, altrimenti si blocca anche il codice del sito che
  carica il blocco successivo.
- Un feed lazy **ha un fondo**, e va misurato prima di dare per scontato che scrollando si arrivi
  ovunque: hdblog serve al massimo 10 pagine (~100 notizie), oltre le quali il bottone "altre
  notizie" NAVIGA via invece di caricare. E una pagina che risponde **429 a tutto quel che non è
  una navigazione vera del browser** (le `/page/N/` di hdblog: fetch del content script compreso)
  si raggiunge **navigandoci**, non scaricandola: è il motivo per cui l'archivio si sfoglia e non
  si "appende" alla home (tentativo scartato in v0.3.9).
- L'archivio va **solo indietro nel tempo**: sfogliarlo oltre la posizione nota del segnalibro
  (`seek.target`, dal conteggio esatto) è dimostrabilmente inutile — se non è comparso entro
  `target` notizie, o l'archivio comincia dopo di lui o non lo elenca affatto. Fermarsi e dirlo,
  non arrivare al tetto delle pagine (bug #15). Dove l'id cresce con la data (`idOrdered`) vale
  anche la prova senza conteggio: una pagina con il 90% di id più bassi del segnalibro è già oltre.
- **I siti cambiano il caricamento senza avvisare** (bug #16: hdblog in settembre 2026 ha reso
  statico l'archivio e rotto il proprio lazy-load). Quando l'utente segnala che la ricerca "non
  arriva", prima di toccare il codice **rimisurare il sito vero**: quante notizie dà la home
  scrollando (distinte, non nodi), cosa contiene `/page/1/`, se le pagine d'archivio sono lazy o
  statiche. Lo strumento è `scratchpad/test-live-seek.ps1` (Chrome headless via CDP, gira il vero
  `content.js`): le `/page/N/` rispondono 429 a `Invoke-WebRequest`, ma non al Chrome headless.
- Un'ipotesi sulla posizione del segnalibro va presa come **limite inferiore**, mai come stima
  "circa": le notizie nuove si impilano sopra, quindi la posizione può solo crescere. Partire
  dalla pagina del limite inferiore non salta mai il segnalibro (`archiveStartPage`).
- Sulle **pagine archivio** il feed è storico, non attuale: "la più recente" è `pending_<id>`
  (scritto sulla home), MAI `feed[0]` della pagina — usarlo manderebbe il segnalibro
  all'indietro. Stessa ragione per cui il conteggio non si ricalcola lì ma si legge da
  `status_<id>`.
- Storage e stato sono **per-sito** (chiavi con suffisso `_<id>`). Non usare chiavi globali
  (le chiavi v1 senza suffisso esistono solo per la migrazione di hdblog).
- Il feed di una pagina **non è un insieme**: una paginazione a offset su una lista che cambia
  ripete elementi (v0.3.7). `collectArticles` deduplica per chiave e tiene gli scarti in
  `out.dups`; quel che si deduplica nel conteggio va nascosto anche nella vista (`hideDuplicates`),
  altrimenti il numero mostrato e le notizie che si scorrono non tornano.
- **Verifica** senza browser: scaricare la home con `Invoke-WebRequest` (User-Agent da browser)
  e simulare i selettori con uno script Node (vedi `scratchpad/test-hwupgrade.js`). L'estensione
  MCP "Claude in Chrome" può NON essere connessa: in tal caso niente test live.
- Niente permessi extra: solo `storage` e `activeTab`. Non usare host permission ampi.
