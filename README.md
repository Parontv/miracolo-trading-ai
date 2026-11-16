# Miracolo Trading AI

**Miracolo integra i progetti upstream originali Condor e Hummingbot.** Non ne ricostruisce dashboard, backend o motore di trading paralleli.

## Regola di architettura

- **Condor** è l'applicazione principale: utilizzare il progetto completo, inclusi dashboard, backend, agenti, routine, portfolio, monitoraggio e gestione bot.
- **Hummingbot** è il motore originale: utilizzare connettori, strategie/controller, executor e gestione del ciclo ordini.
- **Hummingbot API** viene integrata secondo le modalità e le versioni richieste da Condor.
- **Miracolo** fornisce branding, configurazione, accesso unificato e integrazioni strettamente necessarie.
- **Alpaca PAPER** è il broker iniziale richiesto, subordinatamente alla verifica del supporto reale nella versione upstream adottata. LIVE resta disabilitato.

L'integrazione deve utilizzare codice upstream completo, non soltanto una UI simile o un adapter di sola lettura. Conservare licenze, attribuzioni, configurazioni e comportamento originali. Le modifiche locali devono essere minime, isolate e documentate.

## Repository ufficiali

- Condor: https://github.com/hummingbot/condor
- Hummingbot: https://github.com/hummingbot/hummingbot
- Hummingbot API: https://github.com/hummingbot/hummingbot-api

Il riferimento esatto di ogni componente deve essere fissato e registrato (commit/tag), non lasciato implicitamente mobile.

## Runtime e pubblicazione

Condor e Hummingbot richiedono servizi persistenti e dipendenze proprie. Cloudflare Workers può gestire il livello edge/pubblico, ma non va considerato automaticamente il runtime completo per lo stack.

Prima di scegliere l'hosting, verificare i requisiti upstream e avviare realmente tutti i servizi necessari. Usare un ambiente compatibile con Docker, persistenza, networking privato, database e processi di background. Non riscrivere i componenti upstream per adattarli artificialmente a Workers.

## Stato e distribuzione

Questo README definisce la direzione architetturale, non certifica che lo stack completo sia già installato o operativo. L'integrazione sarà considerata completata solo dopo:
- acquisizione e inizializzazione dei repository/submodule originali;
- verifica di versioni, licenze, dipendenze e configurazioni;
- build e test upstream;
- avvio dello stack completo e health check;
- verifica delle connessioni tra Condor, Hummingbot API e motore;
- test PAPER end-to-end di dati, portfolio, ordini, cancellazione, stop, riconciliazione e recupero;
- verifica web desktop/mobile e verifica post-deploy.

Non dichiarare operativo ciò che non è stato verificato.

## Sicurezza

- Solo Alpaca PAPER nella fase iniziale, se supportato dalla versione upstream.
- LIVE disabilitato.
- Nessuna chiave o token in Git, frontend, URL o log.
- API, MQTT e database non esposti pubblicamente senza autenticazione e rete privata.
- Nessun ordine abilitato prima del superamento dei test end-to-end e dei controlli di rischio.

Per tutte le regole di sviluppo consultare [docs/UPSTREAM_ALIGNMENT.md](docs/UPSTREAM_ALIGNMENT.md).
