# CLAUDE.md

Estensione Chromium (Manifest V3) che, sulla **home** dei siti di notizie configurati,
evidenzia l'ultima notizia già vista e mostra sul badge dell'icona quante notizie nuove
sono uscite. Multi-sito, con segnalibro e colore indipendenti per ogni sito.

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

## File

- `manifest.json` — MV3; `matches` elenca gli host; carica `sites.js` poi `content.js`.
- `sites.js` — **registro dei siti** (`NEWS_SITES`) + helper condivisi (`findSiteForUrl`, `isSiteHome`). Caricato sia dai content script sia dal popup.
- `content.js` — logica generica (usa la config del sito attivo). Storage per-sito: `marker_<id>`, `pending_<id>`, `initialized_<id>`, `reached_<id>`. Mostra anche un toast in pagina (`renderToast`) col numero di notizie nuove, solo quando `unread > 0`; auto-dismiss 7s, una volta per caricamento. Sulle pagine ARTICOLO chiama `trackArticle()`, che NON scrive: invia l'entry al service worker.
- `content.css` — evidenziazione + toast in basso a destra; colore per sito via variabili `--hdb-accent*` impostate da JS.
- `background.js` — imposta il badge (numero + colore) per tab; riceve `trackArticle` e scrive gli interessi in modo **serializzato** (`trackChain`) per evitare race tra schede; qui stanno l'**anti-doppioni** (un articolo si registra una sola volta per `sito+chiave` = `entryId`; riaprirlo aggiorna solo il `ts` di ultima apertura, senza ricontare cat/keyword), gli aggregati e il cap a 1000. `dedupeInterests` è la migrazione una-tantum (a onInstalled + avvio SW) che ripulisce i doppioni storici e ricostruisce i conteggi dalla lista deduplicata (idempotente).
- `popup.html/js/css` — stato + pulsanti (vai all'ultima letta / segna tutte come lette) + link Impostazioni + stato "disattivata".
- `options.html/js/css` — **pagina Impostazioni** (`options_ui`, apre in tab): 3 interruttori + vista degli interessi (categorie/keyword aggregate + elenco articoli aperti) + eliminazione singola (`deleteEntry`, decrementa gli aggregati) o totale + **export** (`exportJSON` = articoli+keyword+categorie; `exportCSV` = articoli, con BOM; `exportIgnore` = parole da ignorare in .txt, una per riga, ordinate/deduplicate — pensato per raccogliere i file degli utenti e unirli in futuro alle liste predefinite) + gestione "Parole da ignorare". Include `sites.js` per i nomi dei siti.

Nota debug (v0.0.8): `content.js` logga in console `[Segnalibro] content script attivo: …`, `[Segnalibro] articolo registrato: …` e `[Segnalibro] pagina NON riconosciuta come articolo: …`. Servono a diagnosticare i casi in cui il tracciamento non parte (es. content script non iniettato per accesso-al-sito ristretto). Rimuovibili quando non servono più.
- `rileva-selettori.js` — **strumento** (non parte dell'estensione): da incollare nella Console per ricavare i selettori di siti che bloccano il fetch remoto.

## Impostazioni e tracciamento (v1.3)

Impostazioni in `chrome.storage.local` chiave `settings` = `{ enabled, showToast, trackInterests }`
(default tutti `true`). `content.js/init()` le legge: se `!enabled` non fa nulla (badge svuotato,
`lastStatus.disabled=true`); `showToast` abilita/disabilita il toast; `trackInterests` la raccolta.
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
- **hwupgrade** (`www.hwupgrade.it`): `#news-container li.news-item` → `h3 a`; id prima di `.html`. ✅ verificato.
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
  popup) scrolla giù a step per forzare il caricamento finché il marker compare, poi lo centra.
  Verificato con `scratchpad/test-lazy-highlight.js`.
- Storage e stato sono **per-sito** (chiavi con suffisso `_<id>`). Non usare chiavi globali
  (le chiavi v1 senza suffisso esistono solo per la migrazione di hdblog).
- **Verifica** senza browser: scaricare la home con `Invoke-WebRequest` (User-Agent da browser)
  e simulare i selettori con uno script Node (vedi `scratchpad/test-hwupgrade.js`). L'estensione
  MCP "Claude in Chrome" può NON essere connessa: in tal caso niente test live.
- Niente permessi extra: solo `storage` e `activeTab`. Non usare host permission ampi.
