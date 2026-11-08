# Architettura e confini di integrazione

## Decisione
Usare i progetti upstream per le funzioni che già implementano bene. Miracolo mantiene la propria interfaccia, policy di rischio e integrazione, senza riscrivere il motore di trading.

## Componenti
- Hummingbot: connettori exchange, strategie, ordini e paper trading.
- Hummingbot API: controllo autenticato e osservabilità del runtime.
- Condor: riferimento upstream per la web UI React e per i flussi di gestione. La sua dashboard esiste già; valutare l'integrazione del progetto completo prima di duplicarne le funzioni.
- Web UI Miracolo: pannello mobile-first in italiano, separato dal runtime e senza credenziali exchange nel browser.
- TradingAgents: ricerca e analisi. Il suo output è una proposta non attendibile fino alla validazione.
- Risk Gateway: controlli deterministici, idempotenza e journal.

## Regole di sicurezza
1. La modalità predefinita è PAPER.
2. Il trading LIVE resta disabilitato.
3. Gli agenti AI non possono chiamare API exchange né endpoint di invio ordini.
4. I limiti di esposizione, frequenza e perdita sono applicati lato server.
5. Usare chiavi di idempotenza per evitare ordini duplicati.
6. Bloccare l'esecuzione se rischio, dati o stato Hummingbot non sono disponibili.
7. Non esporre API Hummingbot o database direttamente su Internet.
8. La UI non deve mostrare dati fittizi: stati non disponibili sono visualizzati come tali.

## Interfaccia web
La prima shell statica è in `web/`:
- Panoramica
- Mercati
- Strategie
- Operazioni
- Gestione rischio
- Impostazioni

È un prototipo navigabile, non ancora collegato al backend. La prossima integrazione dovrà usare un backend autenticato come ponte verso Hummingbot API.

## Vincolo runtime
Hummingbot e TradingAgents richiedono un runtime Python/container persistente. Cloudflare Workers/Pages possono ospitare la UI e un piano di controllo leggero, ma non l'intero runtime upstream. Il funzionamento 24/7 richiederà una macchina sempre accesa.
