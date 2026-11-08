# Valutazione progetti upstream

## Hummingbot
Motore primario per connettori exchange, strategie, ordini e paper trading. Verificare installazione ufficiale e connettore paper prima di scrivere un adapter.

## Hummingbot API
Backend autenticato per stato, portfolio, bot e operazioni. Integrare inizialmente endpoint read-only; proteggere il servizio con autenticazione e rete privata.

## Condor
https://github.com/hummingbot/condor

Condor contiene già una web dashboard React + TypeScript + Vite e un backend FastAPI. Le funzioni documentate includono portfolio, monitoraggio bot, trading, executor, posizioni, agenti, routine e gestione server. Il progetto è MIT.

La dashboard Streamlit storica di Hummingbot è indicata dalla documentazione ufficiale come non più mantenuta; la raccomandazione attuale è Condor.

Decisione per Miracolo: usare Condor come riferimento concreto e valutare se integrare il suo stack completo. Non copiare alla cieca la dashboard né creare un secondo orchestratore in conflitto. La shell iniziale Miracolo in `web/` è solo il nostro prototipo di navigazione.

## TradingAgents
Integrare dopo che l'esecutore PAPER funziona. Eseguire analisi a intervalli controllati e monitorare i costi del provider AI. Nessun potere di esecuzione.

## Criteri di accettazione
- Installazione upstream completata.
- Connettore paper avviato e dati di mercato ricevuti.
- Ciclo ordine simulato osservabile end-to-end.
- UI collegata a dati reali tramite backend autenticato.
- Ripartenza e recupero testati.
- Nessuna credenziale LIVE o percorso di ordine LIVE abilitato.
