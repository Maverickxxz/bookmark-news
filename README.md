# 📰 Segnalibro notizie

![versione](https://img.shields.io/badge/versione-0.3.0-blue)
![Manifest](https://img.shields.io/badge/Manifest-V3-brightgreen)
![dati](https://img.shields.io/badge/dati-100%25%20locali-success)

Estensione per browser Chromium (**Chrome · Edge · Brave · Opera**) che ti aiuta a seguire i
**siti di notizie**.

Sulla home di un sito supportato evidenzia **l'ultima notizia che avevi già visto** (riquadro
colorato con etichetta «Ultima letta») e mostra sull'icona dell'estensione **quante notizie nuove**
sono uscite dall'ultima volta. Ogni sito ha il proprio segnalibro e il proprio colore, indipendenti.

In più, se lo attivi, tiene un piccolo **profilo dei tuoi interessi** (categorie e parole chiave
degli articoli che apri) — **100% sul tuo dispositivo, nulla viene inviato in rete**.

## Sommario

- [Caratteristiche](#caratteristiche)
- [Siti supportati](#siti-supportati)
- [Installazione](#installazione)
- [Come funziona il segnalibro](#come-funziona-il-segnalibro)
- [Popup e Impostazioni](#popup-e-impostazioni)
- [Raccolta interessi e parole chiave](#raccolta-interessi-e-parole-chiave)
- [Privacy](#privacy)
- [Aggiungere un nuovo sito](#aggiungere-un-nuovo-sito)
- [Struttura del progetto](#struttura-del-progetto)
- [Sviluppo e test](#sviluppo-e-test)
- [Licenza](#licenza)

## Caratteristiche

- 🔖 **Segnalibro dell'ultima notizia letta** sulla home, evidenziata in pagina.
- 🔢 **Badge sull'icona** con il numero di notizie nuove dall'ultima visita.
- 🗂️ **Multi-sito**: segnalibro e colore separati per ciascun sito.
- 🔁 **Lazy-load robusto**: il segno resta corretto anche quando le notizie si caricano scrollando
  o il sito ri-renderizza la lista.
- 🧠 **Profilo interessi opzionale** (categorie + parole chiave) con estrazione keyword evoluta.
- 📤 **Export** in JSON, CSV e TXT (parole da ignorare).
- 🔒 **Nessuna rete, nessun account, permessi minimi** (`storage`, `activeTab`).

## Siti supportati

| Sito | Host | Segnalibro | Note |
|------|------|:---------:|------|
| **HDblog** | `www.hdblog.it` | ✅ | |
| **Hardware Upgrade** | `www.hwupgrade.it` | ✅ | |
| **HDmotori** | `www.hdmotori.it` | — | solo raccolta interessi (nessun segnalibro sulla home) |

Aggiungerne altri è semplice: vedi [Aggiungere un nuovo sito](#aggiungere-un-nuovo-sito).

## Installazione

L'estensione non è (ancora) sul Web Store: si installa **non pacchettizzata** dai sorgenti.

1. Scarica il repository (`Code → Download ZIP`) ed estrailo, oppure clonalo:
   ```bash
   git clone https://github.com/<utente>/bookmark-news.git
   ```
2. Apri `chrome://extensions` (su Edge `edge://extensions`, su Brave `brave://extensions`).
3. Attiva in alto a destra la **Modalità sviluppatore** / **Developer mode**.
4. Clicca **Carica estensione non pacchettizzata** / **Load unpacked** e seleziona la cartella del
   progetto (quella che contiene `manifest.json`).
5. Apri la home di un sito supportato (es. <https://www.hdblog.it/>).

> 💡 Consiglio: **fissa** (pin) l'estensione nella barra per vedere sempre il numero di notizie nuove.
> Dopo ogni aggiornamento dei file, torna su `…/extensions` e premi **Ricarica** sull'estensione.

## Come funziona il segnalibro

Usa un **doppio segnalibro** (registro a scorrimento). Refresh e riapertura sono trattati allo
stesso modo: **ogni caricamento** della home fa avanzare il segno di un passo.

- **La prima volta** che apri il sito, il segnalibro si mette sull'ultima notizia attuale.
- **A ogni caricamento successivo** (apertura o refresh) il segnalibro **avanza di un passo**: si
  sposta sull'ultima notizia che avevi visto al caricamento precedente e salva quella attuale come
  2° segnalibro (per il caricamento dopo).

In pratica: quando apri e sono uscite notizie nuove, il segno resta sulla "vecchia ultima" e ti
conta le nuove sopra; al caricamento successivo il segno le raggiunge.

> L'ordine seguito è quello del **DOM** (la prima notizia in alto è la più recente), non l'ID
> numerico — che sui siti di notizie non è affidabile come data.

## Popup e Impostazioni

**Popup** (clic sull'icona):

- **Numero grande** — notizie nuove da leggere.
- **Vai all'ultima letta** — scorre fino al riquadro evidenziato (se la notizia è ancora più in
  basso e non caricata, scende automaticamente per raggiungerla).
- **Segna tutte come lette** — azzera il conteggio spostando il segnalibro sull'ultima notizia.
- Se non sei su un sito supportato, il popup elenca i siti disponibili.
- **⚙ Impostazioni** — apre la pagina delle opzioni.

**Impostazioni** — tre interruttori (hanno effetto al **prossimo caricamento** della pagina):

- **Estensione attiva** — accende/spegne tutto (evidenziazione, conteggio, badge, toast, raccolta).
- **Pop-up in pagina** — mostra/nasconde il messaggio col numero di notizie nuove.
- **Raccogli i miei interessi** — salva categoria e parole chiave degli articoli che apri.

## Raccolta interessi e parole chiave

Quando la raccolta è attiva, aprendo un **articolo** l'estensione ne estrae **categoria** e
**parole chiave** e le aggrega localmente. Ogni articolo è registrato **una sola volta**: riaprirlo
non crea doppioni e non gonfia i conteggi.

Le parole chiave vengono ricavate con una pipeline a più livelli, in ordine:

1. **Tag della fonte** — i tag strutturati dell'articolo (`article:tag`, `news_keywords`, `keywords`,
   selettori dedicati). Sono la fonte migliore quando presenti.
2. **Sigle e acronimi dal titolo** — sempre: prodotti e acronimi come `PS5`, `5G`, `S24`, `AI`,
   `USB`, `GPU`, anche quando i tag ci sono (spesso il titolo cita il prodotto chiave che i tag
   non hanno).
3. **Frasi dal titolo (RAKE)** — solo se mancano i tag: estrae *keyphrase* (es. «intelligenza
   artificiale», «auto elettrica») invece di parole isolate, scartando parole comuni, **verbi**
   (~650 forme), parole generiche di dominio (prezzo, offerta, recensione…) e numeri.

Nella pagina Impostazioni puoi **vedere** categorie e parole chiave più frequenti e l'**elenco degli
articoli aperti** (titolo, categoria, sito, data, parole chiave), ed **eliminarli** singolarmente
(**×**) o in blocco (**Azzera tutti i dati raccolti**).

**Export** disponibili:

- **Esporta tutto (JSON)** — articoli visitati + parole chiave + categorie.
- **Articoli in CSV** — la lista degli articoli (data, sito, categoria, titolo, parole chiave),
  apribile in Excel/Fogli (con BOM UTF‑8).
- **Esporta parole ignorate (TXT)** — l'elenco delle parole da ignorare, una per riga.

**Parole da ignorare**: le parole chiave imprecise si possono bandire cliccando la **×** su una
parola chiave (viene rimossa dai dati e non sarà più salvata) o scrivendole nella card dedicata.

## Privacy

Tutti i dati raccolti restano **solo sul tuo dispositivo** (storage locale dell'estensione):
categoria, parole chiave e un elenco degli ultimi articoli aperti (max 1000). **Nulla viene inviato
in rete.** Puoi disattivare la raccolta o azzerare i dati in qualsiasi momento dalle Impostazioni.
I permessi richiesti sono solo `storage` e `activeTab` — nessun accesso ampio ai siti.

## Aggiungere un nuovo sito

Servono **2 modifiche**, poi si ricarica l'estensione da `…/extensions`.

### 1) `sites.js` — aggiungi un blocco in `NEWS_SITES`

```js
{
  id: "ilsito",                     // identificativo unico (usato per il segnalibro)
  name: "Il Sito",                  // nome mostrato nel popup
  color: "#0066cc",                 // colore accento (#rrggbb)
  hosts: ["www.ilsito.it"],         // host su cui agire
  homePaths: ["/", ""],             // percorsi considerati "home"
  articleSelector: "article.card",  // OGNI notizia del feed (dalla più recente in alto)
  linkSelector: "a[href]",          // link con URL+titolo dentro la notizia
  idRegex: "",                      // opzionale: regex sull'URL per un id stabile
  idPrefix: "",
  newestLast: false,
}
```

I due campi delicati sono `articleSelector` (ogni notizia del feed) e `linkSelector` (il link del
**titolo** dentro la notizia — va messo per primo, non quello dell'immagine). In `sites.js` c'è un
TEMPLATE commentato da copiare.

### 2) `manifest.json` — aggiungi gli host

Nel content script, nel campo `matches`, aggiungi una riga `https://HOST/*` per ogni host del sito.

> Per i siti che bloccano l'analisi da remoto c'è lo strumento **`rileva-selettori.js`**: aprilo,
> copia il contenuto, incollalo nella Console del browser (F12) sulla home del sito e usa l'output
> per ricavare i selettori.

## Struttura del progetto

| File | Ruolo |
|------|-------|
| `manifest.json` | Configurazione (Manifest V3) + elenco host |
| `sites.js` | **Registro dei siti supportati** (config + funzioni comuni), condiviso con il popup |
| `content.js` | Logica del segnalibro + toast in pagina + estrazione keyword |
| `content.css` | Stile dell'evidenziazione e del pop-up (colore per sito) |
| `background.js` | Service worker: badge sull'icona + scrittura interessi (serializzata, anti-doppioni) |
| `popup.html` · `popup.css` · `popup.js` | Finestrella con stato e comandi |
| `options.html` · `options.css` · `options.js` | Pagina Impostazioni + vista/esport interessi |
| `rileva-selettori.js` | Strumento (non parte dell'estensione) per ricavare i selettori di un nuovo sito |
| `icons/` | Icone dell'estensione |

## Sviluppo e test

Il codice è **JavaScript vanilla**, senza build né dipendenze: si modifica e si ricarica
l'estensione da `…/extensions`.

La logica critica (segnalibro, estrazione keyword, anti-doppioni) è coperta da test **Node** in
`scratchpad/`, che simulano il DOM/storage senza browser. Con [Node.js](https://nodejs.org)
installato:

```bash
node scratchpad/test-rake.js            # keyphrase RAKE + parole generiche
node scratchpad/test-strong-tokens.js   # acronimi/sigle (AI, PS5, 5G…)
node scratchpad/test-dedup.js           # anti-doppioni + migrazione
node scratchpad/test-lazy-highlight.js  # riapplicazione del segnalibro in lazy-load
```

## Licenza

Nessuna licenza ancora definita. Prima di pubblicare, scegline una (per es.
[MIT](https://choosealicense.com/licenses/mit/)) e aggiungi un file `LICENSE`.
