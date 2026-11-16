# Stato operativo e prossime attività

Aggiornato: 2026-11-16

## Direzione vincolante

- Prodotto: Miracolo Trading AI, web app accessibile da link.
- Hosting della dashboard/API leggera: Cloudflare Workers + Static Assets + D1.
- Base applicativa upstream: Condor, repository ufficiale https://github.com/hummingbot/condor.
- Motore di trading: Hummingbot, repository ufficiale https://github.com/hummingbot/hummingbot.
- Broker ammesso nella fase attuale: Alpaca PAPER soltanto.
- LIVE: disabilitato.
- Regola di sviluppo: upstream-first, nessuna duplicazione di funzioni già disponibili.
- Regola di lavoro: continuità autonoma, ridurre le interruzioni; proseguire su attività sicure e indipendenti senza chiedere conferme superflue.

## Verifiche repository

### Branch main
Contiene la web app Cloudflare:
- `web/` dashboard statica;
- `cloudflare/worker.js` API e scanner;
- D1 e migrazioni;
- workflow GitHub Actions per deploy.

Lo scanner Worker registra segnali EMA 9/21 su barre crypto da un minuto. Non è il motore Hummingbot e non invia ordini. Il codice dichiara esplicitamente che l'invio ordini è bloccato.

### Branch integration/condor-foundation
Contiene:
- Condor upstream come Git submodule in `upstream/condor`, fissato al commit `a817f6633a90afe41523377bfd360c0b9316d423`;
- adapter Python Condor GET-only;
- policy di sicurezza e test;
- documentazione che identifica Condor come base applicativa, non come semplice ispirazione grafica.

I test CI di questo branch risultavano superati nel controllo precedente. Il branch non è stato unito a main.

### Divergenza tra branch
Il confronto aggiornato mostra:
- main: 120 commit avanti rispetto al merge base;
- integration/condor-foundation: 38 commit avanti rispetto al merge base;
- stato: diverged.

Il branch integration elimina la precedente cartella `web/`. Un merge completo in main cancellerebbe quindi l'attuale dashboard Cloudflare. Non eseguire merge integrali. Integrare selettivamente componenti e documentazione dopo test.

## Risultati audit upstream

Condor upstream documenta già:
- dashboard web;
- portfolio e PnL;
- monitoraggio bot;
- trading CEX/DEX;
- gestione ordini e posizioni via Hummingbot API;
- agenti AI e routine.

Hummingbot upstream fornisce:
- connettori exchange;
- strategie e controller;
- executors e ciclo di vita degli ordini;
- strumenti CLI e modalità paper trading.

Queste capacità devono essere riutilizzate quando compatibili. Evitare di replicare dashboard, agenti, orchestrazione, strategie o order lifecycle in codice Miracolo.

## Vincolo infrastrutturale

Cloudflare Workers può ospitare dashboard, API edge, autenticazione e storage D1. Non sostituisce il runtime persistente richiesto da Condor e Hummingbot API. Il README upstream Condor richiede Mac/Linux o WSL2 e Docker per Hummingbot API; Hummingbot è un runtime di trading continuo.

Conseguenza: il link pubblico della dashboard può restare su Cloudflare, ma il motore Condor/Hummingbot non può essere dichiarato operativo 24/7 finché non esiste un runtime persistente raggiungibile in modo privato e autenticato. Non esporre Hummingbot API pubblicamente. La preferenza attuale è non introdurre un VPS in questa fase: quindi mantenere l'app Cloudflare in modalità dashboard/monitoraggio e non simulare il motore.

## Problemi da risolvere prima dell'esecuzione

1. Riconciliare le due implementazioni di rischio: il Worker Cloudflare e la policy Python del branch Condor hanno soglie differenti. Deve esistere una policy autorevole, non due controlli divergenti.
2. Definire il confine tra dashboard Cloudflare e dashboard Condor per evitare duplicazioni: Condor è la UI upstream da riutilizzare; Cloudflare deve essere il punto di accesso/hosting solo dove tecnicamente compatibile.
3. Verificare tutti i percorsi di esecuzione Hummingbot API e instradarli attraverso il controllo di rischio server-side prima di abilitare PAPER.
4. Mantenere l'invio ordini disabilitato fino a test end-to-end di idempotenza, stop-loss, cancel, recovery e riconciliazione.
5. Ripristinare il deploy Cloudflare solo quando sono disponibili i GitHub Actions secrets mancanti: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`. Le credenziali non devono essere inviate in chat o committate.
6. Dopo il deploy, verificare URL effettivo, dashboard, endpoint API, Access e D1. Un workflow verde con step deploy saltati non conta come pubblicazione.

## Sequenza operativa

1. Conservare main e la web app Cloudflare senza merge distruttivi.
2. Aggiornare e verificare il submodule Condor rispetto all'upstream ufficiale; documentare commit e licenza.
3. Mappare API Condor e Hummingbot API: letture, mutazioni, autenticazione, runtime e dipendenze.
4. Confrontare i componenti rischio esistenti e scegliere un'unica policy.
5. Integrare la UI upstream senza duplicarla, preservando l'accesso Cloudflare dove possibile.
6. Eseguire test statici, unitari, integrazione e sicurezza.
7. Deploy solo dopo test superati e secrets presenti; poi smoke test sul link reale.

## Regola di continuità

Non fermare il lavoro per chiedere conferme su attività di analisi, documentazione e test sicure. Quando una dipendenza richiede un'azione dell'utente (secrets, permessi o scelta infrastrutturale non reversibile), completare nel frattempo tutte le attività indipendenti e lasciare un blocco operativo preciso. Non dichiarare mai completato ciò che non è stato verificato.
