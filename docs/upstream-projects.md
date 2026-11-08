# Valutazione progetti upstream

## Condor: base applicativa scelta
Repository: https://github.com/hummingbot/condor

Condor è un'applicazione Python per monitorare e operare Hummingbot, con interazione Telegram opzionale e dashboard web. Il frontend è React + TypeScript + Vite; il progetto include anche il backend applicativo e client per Hummingbot API.

Funzioni documentate nel repository upstream:
- Dashboard web e portfolio con PnL, saldi, posizioni e grafici.
- Monitoraggio bot e metriche.
- Trading CEX, ordini e gestione posizioni.
- Executor Hummingbot.
- Agenti AI, routine schedulabili e notifiche.
- Configurazione server API, credenziali exchange e Gateway.
- Modalità locale senza Telegram e modalità Telegram per controllo da telefono.

**Decisione:** Condor è la base applicativa preferita per Miracolo. Non duplicare dashboard, orchestrazione, agenti o gestione bot prima di aver verificato le funzioni upstream. La shell statica `web/` è provvisoria.

## Vincoli e sicurezza Condor
- Condor può inviare ordini tramite Hummingbot API: non collegarlo a credenziali LIVE prima di aver verificato e protetto tutti i percorsi di esecuzione.
- La modalità locale è senza login e lega il server a 127.0.0.1 per default. Non esporre la porta web senza autenticazione.
- Hummingbot API usa la porta 8000: non pubblicarla su Internet. Preferire rete privata autenticata (es. Tailscale).
- Condor include funzioni DEX/Gateway: lasciarle disabilitate nella prima fase crypto CEX.
- Condor dichiara telemetria anonima opzionale e con controlli dedicati; verificare le impostazioni privacy durante il setup.
- Licenza dichiarata dal repository Condor: MIT. Conservare licenza e attribuzioni upstream in ogni distribuzione derivata.

## Hummingbot e Hummingbot API
Hummingbot è il motore per connettori exchange, strategie, ordini e paper trading. Hummingbot API è il piano di controllo autenticato per stato, portfolio, bot ed esecuzione. L'API deve essere privata e inizialmente usata in sola lettura fino al completamento del Risk Gateway.

## TradingAgents
Integrare come livello di ricerca e proposta dopo aver stabilizzato il flusso PAPER. Eseguire analisi a intervalli controllati e monitorare costi e latenza del provider AI. Nessun accesso diretto a chiavi exchange o endpoint di invio ordini.

## Criteri di accettazione
- Condor e Hummingbot API installati e avviati in un runtime persistente.
- Connettore PAPER avviato e dati di mercato ricevuti.
- Tutti i percorsi di invio ordini passano dal Risk Gateway.
- Ciclo ordine simulato osservabile end-to-end, inclusi stop e cancellazione.
- Ripartenza, recovery e audit log testati.
- Nessuna credenziale LIVE o percorso di ordine LIVE abilitato.
