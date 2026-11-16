# Regole vincolanti di sviluppo: upstream-first

Queste regole governano ogni modifica a Miracolo Trading AI. La priorità è utilizzare i progetti originali già esistenti e funzionanti, non ricostruirli.

## Regola fondamentale

**Condor e Hummingbot devono essere acquisiti e integrati come progetti upstream completi, mantenendo codice, interfacce, backend, configurazioni, dipendenze e modalità operative originali.**

Miracolo è il prodotto/contenitore che li integra e li personalizza. Non deve sostituirli con implementazioni proprietarie equivalenti.

- **Condor (https://github.com/hummingbot/condor):** piattaforma applicativa principale. Riutilizzare dashboard, backend, agenti, routine, portfolio, monitoraggio e gestione bot così come forniti dal progetto.
- **Hummingbot (https://github.com/hummingbot/hummingbot):** motore di trading originale. Riutilizzare connettori, strategie/controller, executor, API e ciclo di vita ordini originali.
- **Hummingbot API:** utilizzare il servizio ufficiale quando richiesto dalla versione di Condor e dall'architettura upstream.
- **Miracolo:** solo integrazione, configurazione, branding e adattamenti specifici realmente necessari, tra cui la configurazione iniziale Alpaca PAPER e la distribuzione.
 
Il termine "integrare" non significa copiare soltanto la grafica, creare un clone semplificato o collegare una dashboard vuota. Significa portare nell'app l'applicazione upstream completa e far funzionare i suoi servizi e le sue dipendenze.

## Gerarchia obbligatoria delle decisioni

1. Importare e utilizzare il componente upstream originale, preferibilmente tramite Git submodule o meccanismo ufficiale equivalente, fissando una versione/commit verificabile.
2. Mantenere intatti codice, configurazioni e comportamento upstream.
3. Collegare i componenti tramite API, configurazioni e interfacce ufficiali.
4. Aggiungere adapter Miracolo sottili e isolati soltanto per colmare incompatibilità dimostrate.
5. Applicare patch o fork upstream solo se indispensabile; documentare motivazione, differenze e procedura di riallineamento.
6. Scrivere codice nuovo solo per funzioni che non esistono nei progetti originali o per l'integrazione specifica di Miracolo.

## Divieti

- Non riscrivere Condor o Hummingbot.
- Non sostituire Condor con la dashboard proprietaria Miracolo.
- Non creare un secondo motore, scheduler, sistema agenti, strategia, portfolio o gestione ordini quando esiste già una funzione upstream.
- Non considerare una semplice API read-only o una replica grafica come integrazione completa.
- Non rimuovere funzionalità o configurazioni upstream per semplificare il deploy senza una decisione tecnica documentata.
- Non inventare supporto broker, runtime o compatibilità.
- Non dichiarare un componente integrato/operativo finché non sono stati avviati e verificati i servizi reali.

## Regola di acquisizione e inventario

Prima di intervenire sul codice:
1. Verificare repository ufficiali, licenze, release e commit compatibili di Condor, Hummingbot e Hummingbot API.
2. Verificare il contenuto effettivo dei submodule e che siano inizializzati ricorsivamente nella build/deploy.
3. Ricavare dai file upstream (README, Makefile, Docker Compose, manifest, env example) i requisiti reali.
4. Elencare tutti i servizi, database, broker, code, volumi, porte, health check e segreti richiesti.
5. Confrontare l'installazione upstream completa con ciò che esiste in Miracolo e individuare ciò che manca.
6. Non eliminare né sostituire l'applicazione upstream durante questa analisi.

## Personalizzazioni Miracolo

- Nome, branding e accesso unificato Miracolo.
- Configurazioni e integrazioni specifiche necessarie per l'ambiente scelto.
- Alpaca PAPER come broker iniziale richiesto dal progetto, **solo dopo aver verificato che la versione upstream e i suoi connettori/API lo supportino realmente**. Se non supportato nativamente, documentare il gap e valutare un adapter ufficiale/isolato senza alterare il core.
- LIVE sempre disabilitato nella fase iniziale.
- Le impostazioni originali di Condor/Hummingbot vanno conservate; modificare solo i parametri indispensabili, tracciandoli in file di configurazione Miracolo separati quando possibile.

## Distribuzione e runtime

Condor e Hummingbot includono servizi persistenti e dipendenze che non possono essere dati per scontati su Cloudflare Workers.

- Cloudflare può essere il livello pubblico per dominio, autenticazione, routing, asset e servizi edge compatibili.
- Il runtime completo Condor/Hummingbot deve essere ospitato su un ambiente che soddisfi i requisiti upstream (ad esempio Docker/servizi persistenti).
- Non riscrivere servizi persistenti come Worker per forzare un deploy su Cloudflare.
- Prima di scegliere l'hosting, verificare costi, persistenza, networking privato, database, storage e riavvio automatico.
- Non esporre pubblicamente Hummingbot API, MQTT, database o pannelli amministrativi senza autenticazione e rete privata.

## Sicurezza e trading

- Alpaca PAPER è l'unico ambiente broker autorizzato per la fase iniziale di Miracolo.
- Non inserire credenziali LIVE e mantenere disabilitate le rotte LIVE.
- Non abilitare ordini finché il percorso reale PAPER non supera test end-to-end di connessione, dati, portfolio, invio/cancellazione, stop, riconciliazione, riavvio e recupero.
- Segreti solo in secret manager/environment protetti; mai in Git, frontend, URL o log.
- Non attribuire a Condor/Hummingbot limiti di rischio personalizzati di Miracolo come se fossero default upstream.

## Test e deploy obbligatori

Prima di ogni deploy:
1. Eseguire i test upstream pertinenti e quelli Miracolo.
2. Verificare build frontend e backend, import, dipendenze e configurazioni.
3. Avviare lo stack completo nell'ambiente previsto.
4. Verificare health check di ogni servizio, connessione tra servizi, persistenza e riavvio.
5. Eseguire test PAPER end-to-end senza LIVE.
6. Verificare l'app dal browser e da dispositivo mobile.
7. Pubblicare solo con controlli superati e poi verificare il servizio distribuito.

Una build verde da sola non prova che il trading sia collegato o operativo.

## Eccezioni e continuità

Ogni eccezione va motivata e documentata in PR/commit. Se un componente non è compatibile o mancano credenziali/servizi, completare tutte le verifiche indipendenti, indicare il blocco con precisione e non simulare il completamento.

Lavorare in modo autonomo su analisi, modifiche reversibili e test; chiedere conferma solo per azioni irreversibili, costose, che espongono servizi o che possono generare ordini finanziari.
