# Regole di allineamento upstream

Queste regole sono vincolanti per ogni modifica a Miracolo Trading AI.

## Progetti di riferimento

- Condor: https://github.com/hummingbot/condor
- Hummingbot: https://github.com/hummingbot/hummingbot

Prima di progettare o implementare una funzione, verificare nei repository ufficiali se esiste già una soluzione mantenuta e adatta. Consultare codice, documentazione, API, configurazioni, release e licenze; non basarsi soltanto sul nome di una funzione o su esempi non verificati.

## Gerarchia delle decisioni

1. Riutilizzare direttamente componenti upstream compatibili.
2. Integrare le funzionalità upstream tramite API, interfacce e configurazioni ufficiali.
3. Se serve un adattamento, realizzare un adapter sottile e isolato, mantenendo intatto il comportamento upstream.
4. Modificare o fare fork del codice upstream soltanto quando le prime tre opzioni non sono praticabili; documentare motivo, file, differenze e modalità di riallineamento agli aggiornamenti upstream.
5. Scrivere codice proprietario nuovo soltanto per ciò che manca davvero nei progetti originali o per l'integrazione specifica con Cloudflare, D1 e Alpaca PAPER.

## Divieti

- Non riscrivere da zero funzioni già presenti in Condor o Hummingbot.
- Non creare un secondo motore di trading, scheduler, strategia, dashboard o sistema di gestione ordini se l'equivalente upstream è riutilizzabile.
- Non introdurre librerie o servizi alternativi senza una necessità verificata.
- Non dichiarare una funzione integrata, collegata o operativa finché non è stata eseguita una verifica reale.
- Non copiare codice senza controllare licenza, attribuzioni, dipendenze e obblighi di distribuzione.
- Non sostituire componenti upstream con mock o simulazioni senza dichiararlo chiaramente.

## Vincolo architetturale Cloudflare

Cloudflare Workers, D1 e Static Assets costituiscono il livello web/serverless di pubblicazione di Miracolo. Non si deve presumere che possano eseguire senza adattamenti processi persistenti o servizi backend richiesti da Condor o Hummingbot.

Prima di collegare un componente, verificare i suoi requisiti reali di runtime, persistenza, rete, storage e processi in background. Se un componente upstream richiede un runtime non disponibile su Cloudflare Workers, mantenere il componente upstream e progettare un'integrazione compatibile; non riscriverlo per simulare un supporto inesistente. L'eventuale necessità di un runtime separato va esplicitata, non introdotta di nascosto.

## Regole operative per ogni intervento

Prima di modificare il codice:

1. Individuare il componente upstream corrispondente e la versione/commit di riferimento.
2. Leggere implementazione e documentazione ufficiali.
3. Confrontare il codice presente nel repository Miracolo con l'upstream.
4. Descrivere in modo breve cosa si riutilizza, cosa manca e perché serve ogni modifica proprietaria.

Dopo la modifica:

1. Eseguire i test upstream pertinenti e quelli Miracolo.
2. Verificare compatibilità, sicurezza, gestione errori e persistenza.
3. Verificare che il comportamento non sia stato duplicato o alterato inutilmente.
4. Pubblicare solo dopo test superati; verificare il servizio effettivamente distribuito.

## Vincoli di trading e sicurezza

- Alpaca PAPER è l'unico broker autorizzato nel progetto attuale.
- LIVE deve restare disabilitato.
- Nessun ordine deve essere abilitato finché risk gateway, journal, riconciliazione e protezione stop-loss non sono stati verificati end-to-end.
- Segreti e credenziali non devono mai essere inseriti nel repository, nel frontend o nei log.

## Eccezioni

Ogni eccezione a queste regole deve essere motivata e documentata nel pull request o nel commit. In caso di dubbio, fermarsi alla verifica e non inventare una nuova implementazione.
