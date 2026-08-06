# Scheda Chrome Web Store — testi pronti da incollare

Promemoria operativo per la pubblicazione. Non fa parte dell'estensione: `build.ps1`
lo lascia fuori dallo ZIP.

---

## 1. Pacchetto

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Produce `dist/segnalibro-notizie-<versione>.zip` con i soli file dell'estensione e
`manifest.json` nella radice. Prima di caricarlo: `chrome://extensions` → *Modalità
sviluppatore* → *Carica estensione non pacchettizzata* sulla cartella scompattata
dello ZIP, e prova un giro completo (home, articolo, popup, impostazioni). Serve a
escludere che manchi un file dall'elenco in `build.ps1`.

Per ogni aggiornamento: alza `version` in `manifest.json`, ricrea lo ZIP, ricaricalo.

---

## 2. Nome

```
Segnalibro notizie
```

Non aggiungere i nomi dei siti al titolo: una scheda che sembra ufficiale di HDblog o
HWupgrade viene respinta. Nella descrizione c'è già la riga che chiarisce che non è
un'estensione ufficiale.

## 3. Descrizione breve (campo `description` del manifest, max 132 caratteri)

```
Sulla home dei siti di notizie evidenzia l'ultima che avevi già visto e conta quante ne sono uscite dopo. Multi-sito, in locale.
```

128 caratteri. `build.ps1` blocca la creazione dello ZIP se superi il limite.

## 4. Descrizione dettagliata (campo "Descrizione" della scheda)

Tre vincoli da rispettare se la riscrivi: le **prime due righe** sono l'unica parte
visibile nell'anteprima (il resto è troncato); **niente elenchi di parole chiave** in
fondo, è considerato spam ed è causa ricorrente di rifiuto; la **riga finale sulla non
affiliazione** non si tocca, perché la scheda cita tre marchi altrui e senza quella
può sembrare ufficiale.

```
Torni sul sito di notizie e ti chiedi: quali avevo già letto?

Segnalibro notizie tiene il segno al posto tuo. Sulla home dei siti supportati evidenzia l'ultima notizia che avevi già visto e mostra sull'icona quante notizie nuove sono uscite da quel momento. Tutto quello che sta sopra il segno è roba nuova.

COSA FA

• Evidenzia l'ultima notizia già vista, con un colore diverso per ogni sito.
• Conta le notizie nuove sul badge dell'icona e in un messaggio discreto in pagina.
• "Vai all'ultima letta" ti riporta esattamente al punto in cui eri arrivato, anche quando la notizia è finita molto più in basso o è già passata nell'archivio del sito.
• "Segna tutte come lette" quando vuoi ripartire pulito.
• Nasconde le notizie che alcuni siti ripetono mentre scorri la home.
• Il segnalibro avanza solo quando hai davvero visto il segno: se un giorno non arrivi in fondo, il punto in cui eri rimasto ti aspetta lì.

I TUOI INTERESSI, SOLO PER TE

Se lasci attiva l'opzione, l'estensione tiene un elenco degli articoli che apri e ne ricava le categorie e le parole chiave che ricorrono di più: serve a mostrarti cosa segui davvero. Puoi consultare tutto nelle Impostazioni, cancellare le singole voci, azzerare tutto oppure esportarlo in JSON e CSV. Se non ti interessa, si spegne con un interruttore.

PRIVACY

Nessun dato esce dal tuo dispositivo. Non c'è nessun server, nessuna statistica, nessun tracciatore pubblicitario: tutto resta nella memoria locale del browser. L'estensione chiede due sole autorizzazioni — memoria locale e scheda attiva — e l'accesso ai soli siti di notizie su cui lavora.

SITI SUPPORTATI

• hdblog.it — segnalibro, conteggio delle notizie nuove e raccolta degli interessi
• hwupgrade.it — come sopra, con ricerca dell'ultima letta nell'archivio del sito
• hdmotori.it — solo raccolta degli interessi

FEEDBACK E CODICE SORGENTE

Segnalazioni, problemi e richieste di nuovi siti: giudigre01@gmail.com. Leggo tutto.

Il progetto è open source: il codice si può leggere, controllare e migliorare.
https://github.com/Maverickxxz/bookmark-news

Gratuita, senza account e senza pubblicità. Estensione indipendente, non affiliata né approvata dai siti citati, i cui nomi compaiono solo per indicare dove funziona.
```

Il link per le donazioni **non** va messo qui: in vetrina abbassa la conversione e sta
già in cima alla pagina Impostazioni, dove lo vede chi usa davvero l'estensione.

## 5. Categoria e lingua

- Categoria: **Notizie e meteo**
- Lingua: **Italiano**

## 6. Privacy — campi da compilare

**Scopo unico (single purpose):**

```
Sulla home dei siti di notizie supportati, evidenziare l'ultima notizia che l'utente aveva già visto e mostrare quante notizie nuove sono state pubblicate da quel momento.
```

I tre campi "Motivazione" hanno un limite di 1.000 caratteri l'uno. Testi definitivi
(lunghezza fra parentesi):

**Motivazione per `storage`** (808):

```
L'estensione salva in chrome.storage.local, quindi sul dispositivo dell'utente: per ogni sito supportato l'identificativo dell'ultima notizia che l'utente aveva già visto e quello della notizia più recente all'ultimo caricamento, le impostazioni (quattro interruttori), l'elenco delle parole da ignorare e, solo se l'utente lascia attiva l'opzione, l'elenco degli articoli aperti con categoria e parole chiave.

Senza questi dati la funzione dell'estensione è impossibile: al caricamento successivo non ci sarebbe modo di riconoscere il punto in cui l'utente era arrivato né di contare quante notizie sono uscite da allora.

Viene usato esclusivamente storage.local: non si usa storage.sync e nessun dato lascia il dispositivo. L'utente può consultare, esportare e cancellare tutto dalla pagina Impostazioni.
```

**Motivazione per `activeTab`** (580):

```
I tre pulsanti del popup — "Vai all'ultima letta", "Ricarica pulita" e "Segna tutte come lette" — devono agire sulla scheda che l'utente ha davanti: leggere lo stato della pagina, scorrere fino alla notizia evidenziata oppure ricaricare la pagina conservando la posizione del segnalibro.

activeTab concede questo accesso solo dopo che l'utente ha cliccato l'icona dell'estensione ed è l'alternativa più restrittiva a un permesso permanente. Non viene usato per raggiungere schede diverse da quella su cui l'utente ha appena cliccato, né per leggere pagine di siti non supportati.
```

**Motivazione per Autorizzazione host** (848):

```
L'estensione funziona su tre siti di notizie italiani, dichiarati in content_scripts: hdblog.it, hwupgrade.it e hdmotori.it.

Su questi deve leggere l'elenco delle notizie della home per identificare le singole notizie (link e identificativo), evidenziare l'ultima che l'utente aveva già visto e contare quelle pubblicate dopo; è lo scopo unico dell'estensione e non è realizzabile senza leggere il contenuto di quelle pagine. Per stabilire il numero esatto di notizie nuove scarica, dallo stesso sito e senza credenziali, le pagine di archivio che l'utente riceverebbe comunque navigando. Sulle pagine degli articoli legge titolo e metadati per la raccolta degli interessi, che resta in locale ed è disattivabile.

Gli schemi sono limitati a questi tre host: non si richiede <all_urls> né altri domini. Le uniche modifiche alle pagine sono visive.
```

Il `fetch` verso le pagine di archivio va dichiarato qui di proposito: il revisore lo
trova comunque nel codice, e trovarlo già spiegato vale più che farglielo scoprire.
Il banner "a causa dell'autorizzazione host potrebbe servire un esame approfondito"
compare a chiunque usi `content_scripts`: allunga la revisione, non è un problema.

**Usi codice remoto? → NO.** Verificato sul codice che si spedisce: nessun `eval`,
nessun `new Function`, nessun `import()` dinamico, nessun `<script src>` esterno,
nessun `url()`/`@import` nel CSS. L'unico `fetch` scarica HTML che viene letto con
`DOMParser`, che **non esegue** nulla: sono dati, non codice. Rispondere "Sì" sarebbe
falso e farebbe scattare le restrizioni MV3 sul codice remoto.

**Uso dei dati:** l'estensione non trasmette dati fuori dal dispositivo, quindi non
va dichiarata alcuna raccolta. Vanno accettate le tre certificazioni (niente vendita
a terzi, nessun uso estraneo allo scopo dichiarato, nessun uso per valutare la
solvibilità).

**URL dell'informativa privacy** (campo obbligatorio):

```
https://github.com/Maverickxxz/bookmark-news/blob/main/PRIVACY.md
```

Va bene così finché il repository resta **pubblico**: se lo rendi privato l'indirizzo
smette di funzionare e la scheda viene segnalata. In quel caso serve un'altra
ospitazione (per esempio GitHub Pages su un repo pubblico apposta).

## 7. Immagini

- **Icona 128×128** — è `icons/icon128.png` (già 128×128 PNG con canale alfa). La
  dashboard non la prende dal manifest: va caricata a parte, ma è lo stesso file. Le
  linee guida consigliano grafica dentro ~96×96 con il resto trasparente, perché lo
  store aggiunge cornice e ombra proprie; l'icona attuale riempie tutta la tela, cosa
  che molte estensioni fanno e che non comporta rifiuto.
- **Screenshot 1280×800 (o 640×400), da 1 a 5.** È l'elemento che decide se la gente
  installa. Da mostrare, in quest'ordine:
  1. la home di un sito con la notizia evidenziata e il badge col numero sull'icona;
  2. il popup aperto con i tre pulsanti;
  3. il messaggio in pagina con il conteggio delle notizie nuove;
  4. la pagina Impostazioni con categorie e parole chiave.
- **Tile promozionale 440×280** — facoltativo.

## 8. Prima della pubblicazione

- [ ] Account sviluppatore creato (quota una tantum di 5 USD).
- [ ] **Email di contatto dell'editore inserita E verificata** (dashboard → Account).
      Senza, la pubblicazione di qualunque elemento è bloccata. Diventa pubblica sulla
      scheda: usare `giudigre01@gmail.com`, lo stesso indirizzo della descrizione e
      della pagina Impostazioni, per non averne tre diversi in giro.
- [ ] **Stato di operatore commerciale (trader status) dichiarato.** Obbligatorio per
      l'UE: senza dichiarazione l'estensione viene esclusa dalla distribuzione
      europea, cioè dal suo unico pubblico. Se ti dichiari operatore commerciale,
      nome, indirizzo e recapiti diventano pubblici sulla scheda.
- [ ] Informativa privacy raggiungibile a un URL pubblico (repository pubblico:
      vedi sezione 6).
- [ ] Screenshot pronti.
- [ ] Prima pubblicazione con visibilità **"Non elencata"**: installi dallo store col
      link, verifichi che il pacchetto funzioni davvero, poi passi a "Pubblica".
