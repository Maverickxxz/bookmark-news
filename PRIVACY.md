# Informativa sulla privacy — Segnalibro notizie

**Ultimo aggiornamento: 6 agosto 2026**

Segnalibro notizie è un'estensione per browser Chromium che, sulla home dei siti di
notizie supportati, evidenzia l'ultima notizia che avevi già visto e conta quante
notizie nuove sono uscite da allora.

## In breve

**L'estensione non raccoglie, non trasmette e non vende alcun dato.** Non esiste
alcun server dello sviluppatore: non c'è niente a cui i tuoi dati possano essere
inviati. Tutto quello che l'estensione salva resta nella memoria locale del tuo
browser, sul tuo dispositivo.

Non sono presenti sistemi di analisi statistica, tracciatori pubblicitari, cookie
propri dell'estensione, né codice scaricato da remoto.

## Quali dati vengono salvati sul tuo dispositivo

Nella memoria locale dell'estensione (`chrome.storage.local`) vengono salvati:

1. **Posizione del segnalibro**, per ogni sito supportato: l'identificativo
   dell'ultima notizia che avevi già visto, quello della notizia più recente
   all'ultimo caricamento e alcuni flag di servizio (se il segnalibro è stato
   raggiunto sullo schermo, il conteggio delle notizie non lette e la sua scadenza).
2. **Le tue impostazioni**: i quattro interruttori della pagina Impostazioni.
3. **L'elenco delle parole da ignorare** che hai aggiunto tu.
4. **I tuoi interessi**, solo se lasci attivo l'interruttore *"Raccogli i miei
   interessi"* (attivo di default e disattivabile in qualsiasi momento). Per ogni
   articolo che apri sui siti supportati vengono salvati: identificativo
   dell'articolo, sito, titolo (massimo 120 caratteri), categoria, parole chiave
   ricavate dal titolo e dai metadati della pagina, data e ora di apertura. La lista
   conserva al massimo gli ultimi 1000 articoli. Da questa lista l'estensione calcola
   i due riepiloghi (categorie e parole chiave più frequenti) che vedi in
   Impostazioni.

Non vengono salvati la cronologia di navigazione, gli indirizzi delle pagine
visitate al di fuori dei siti supportati, dati personali, indirizzi email,
credenziali, dati di pagamento, né alcun identificativo che permetta di risalire a te.

## Connessioni di rete

L'estensione effettua un solo tipo di richiesta di rete: scarica altre pagine **dello
stesso sito di notizie che stai già visitando** (le pagine dell'archivio o l'endpoint
che il sito usa per caricare altre notizie mentre scorri) per stabilire il numero
esatto di notizie nuove da mostrare sul badge. Sono le stesse pagine che il sito ti
servirebbe comunque navigando, richieste senza credenziali (`credentials: "omit"`)
e senza inviare alcun dato tuo. Nessuna richiesta viene fatta verso lo sviluppatore o
verso terze parti.

Quando premi «Vai all'ultima letta» e la notizia è più indietro delle pagine
dell'archivio già viste, l'estensione **naviga** da una pagina all'altra
dell'archivio del sito, come se sfogliassi tu: sono normali visite, non richieste
in più.

Il link di sostegno facoltativo presente nella pagina Impostazioni è un normale
collegamento: si apre solo se lo clicchi tu, e a quel punto vale l'informativa
privacy del servizio di pagamento (Revolut). L'estensione non gestisce pagamenti e
non riceve da quel servizio alcun dato.

## Autorizzazioni richieste e perché

- **`storage`** — salvare in locale le voci elencate sopra. Senza, l'estensione non
  potrebbe ricordare a che punto eri arrivato.
- **`activeTab`** — permettere ai pulsanti del popup ("Vai all'ultima letta",
  "Ricarica pulita", "Segna tutte come lette") di agire sulla scheda che hai davanti,
  solo quando clicchi l'icona dell'estensione.
- **Accesso ai siti `hdblog.it`, `hwupgrade.it`, `hdmotori.it`** — leggere l'elenco
  delle notizie della home per riconoscerle e per evidenziare quella giusta. Non
  viene richiesto l'accesso a nessun altro sito.

## Il tuo controllo sui dati

Dalla pagina Impostazioni puoi in qualsiasi momento: disattivare del tutto la
raccolta degli interessi, cancellare un singolo articolo registrato, azzerare tutti i
dati raccolti, esportarli (JSON, CSV, TXT) e gestire le parole da ignorare —
rimuovendole anche dai dati già raccolti.

I dati restano finché non li cancelli tu. Disinstallando l'estensione, il browser
elimina la sua memoria locale e con essa tutto quanto descritto qui.

## Cessione a terzi

Nessun dato viene venduto, ceduto o condiviso con terzi, per il semplice motivo che
nessun dato lascia il tuo dispositivo. I dati non vengono usati per finalità estranee
alla funzione dell'estensione, né per valutare la solvibilità o per concedere
prestiti.

## Modifiche a questa informativa

Eventuali modifiche saranno pubblicate in questa pagina, aggiornando la data in alto.

## Contatti

Per domande su questa informativa: **info@fgmscale.com**
