# Valutazione progetti upstream

## Hummingbot
Fondazione primaria. Verificare installazione ufficiale e connettore paper trading prima di scrivere un adapter.

## Hummingbot API
Integrare solo dopo aver verificato il runtime. Iniziare con health/status e endpoint read-only. Proteggere il servizio con autenticazione e rete privata.

## TradingAgents
Integrare dopo che l'esecutore PAPER funziona. Eseguire analisi a intervalli controllati e monitorare i costi del provider AI. Nessun potere di esecuzione.

## Condor
Opzionale. Si sovrappone a orchestrazione e dashboard. Non introdurlo finché non è chiaro chi possiede scheduling e ciclo di vita dei bot.

## Criteri di accettazione
- Installazione upstream completata.
- Connettore paper avviato e dati di mercato ricevuti.
- Ciclo ordine simulato osservabile end-to-end.
- Ripartenza e recupero testati.
- Nessuna credenziale LIVE o percorso di ordine LIVE abilitato.
