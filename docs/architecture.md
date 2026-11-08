# Architettura e confini di integrazione

## Decisione
Usare i progetti upstream come progetti upstream. Non copiare o riscrivere i loro motori interni.

## Componenti
- Hummingbot: connettori exchange, strategie, ordini e paper trading.
- Hummingbot API: controllo autenticato e osservabilità del runtime.
- TradingAgents: ricerca e analisi. Il suo output è una proposta non attendibile fino alla validazione.
- Risk Gateway: controlli deterministici e journal.
- UI: controllo e osservabilità mobile; nessun segreto nel browser.

## Regole di sicurezza
1. La modalità predefinita è PAPER.
2. Il trading LIVE resta disabilitato.
3. Gli agenti AI non possono chiamare API exchange né endpoint di invio ordini.
4. I limiti giornalieri sono applicati lato server.
5. Usare chiavi di idempotenza per evitare ordini duplicati.
6. Bloccare l'esecuzione se rischio, dati o stato Hummingbot non sono disponibili.
7. Non esporre API Hummingbot o database direttamente su Internet.

## Vincolo runtime
Hummingbot e TradingAgents richiedono un runtime Python/container persistente. Cloudflare Workers può ospitare il piano di controllo web/API, ma non l'intero runtime upstream. Un PC può servire per la prima installazione; il funzionamento 24/7 richiederà una macchina sempre accesa.
