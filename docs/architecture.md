# Architettura e confini di integrazione

## Decisione
Condor diventa la base applicativa da integrare, non un semplice riferimento grafico. Miracolo aggiunge il livello di prodotto crypto-only e le protezioni deterministiche. Evitare una seconda dashboard e un secondo orchestratore quando Condor offre già queste funzioni.

## Componenti e responsabilità
- **Condor**: dashboard web, interazione Telegram opzionale, agenti, routine, gestione dei server e flussi operativi. È l'applicazione di controllo.
- **Hummingbot API**: backend autenticato per stato, portfolio, bot, executor e operazioni.
- **Hummingbot**: connettori exchange, strategie, ordini e posizioni.
- **Miracolo Risk Gateway**: policy crypto-only, approvazione deterministica, limiti, idempotenza, kill switch e journal.
- **TradingAgents**: analisi e proposte. Non deve avere credenziali exchange né accesso diretto agli endpoint di invio ordini.

## Confine di sicurezza obbligatorio
Condor documenta flussi di trading e agenti autonomi che possono operare tramite Hummingbot API. Non si deve quindi collegare Condor direttamente a un account LIVE prima di aver verificato ogni percorso di invio ordini e averlo instradato attraverso il Risk Gateway.

1. Modalità iniziale PAPER; LIVE disabilitato.
2. Gli agenti AI non inviano ordini direttamente.
3. Ogni ordine passa dal Risk Gateway, che controlla policy, rischio, limiti e idempotenza.
4. Bloccare l'esecuzione se dati, rischio, autenticazione o stato runtime non sono disponibili.
5. Nessuna chiave exchange nel browser, nel repository o nei log.
6. Non esporre Hummingbot API (porta 8000) o database su Internet pubblico.
7. Usare rete privata autenticata, ad esempio Tailscale, e credenziali robuste.
8. Disabilitare le funzioni DEX/Gateway nella prima fase: il perimetro è solo crypto CEX spot/perpetual, con modalità PAPER.

## Interfaccia
La dashboard web di Condor è la base da valutare e integrare. La precedente shell statica prototipale in `web/` è stata rimossa: la dashboard ufficiale Condor è l'unica interfaccia applicativa. L'interfaccia finale sarà in italiano e ottimizzata per Android.

## Runtime 24/7
Condor e Hummingbot API richiedono un host persistente e, per l'API, Docker. Cloudflare Workers/Pages non possono ospitare il runtime Python/container. La dashboard può essere pubblicata separatamente, ma il motore deve restare su una macchina sempre attiva. La modalità locale di Condor non ha login e si lega a 127.0.0.1 per impostazione predefinita: non esporla in rete senza un livello di autenticazione e rete privata.

## Criteri per dichiarare l'integrazione completata
- Condor avviato con configurazione locale verificata.
- Hummingbot API raggiungibile solo attraverso rete privata e autenticazione.
- Connettore PAPER collegato e dati di mercato reali ricevuti.
- Ogni percorso di invio ordini verificato e protetto dal Risk Gateway.
- Ordine simulato end-to-end, stop, cancellazione e recovery testati.
- Journal e audit log verificabili.
- Nessun percorso LIVE abilitato.
