# Miracolo Trading AI

Piattaforma indipendente **crypto-only**, progettata per operatività continua 24/7 e basata sui progetti originali Hummingbot e TradingAgents.

> Stato: bootstrap architetturale. Questo repository non invia ordini reali.

## Obiettivo operativo
- Solo mercati crypto, 24 ore su 24 e 7 giorni su 7.
- Hummingbot è il motore di esecuzione e gestione ordini.
- TradingAgents è il livello di ricerca e proposta, non un esecutore.
- Nessun limite arbitrario di 3 operazioni al giorno: la frequenza dipende dalla strategia, dalla liquidità e dai costi.
- Protezioni su posizioni simultanee, frequenza ordini, perdita giornaliera e stop loss.
- Modalità iniziale esclusivamente PAPER.
- Nessuna API key o credenziale nel repository.

## Componenti upstream
- Hummingbot: https://github.com/hummingbot/hummingbot
- Hummingbot API: https://github.com/hummingbot/hummingbot-api
- Condor (da valutare in fase successiva): https://github.com/hummingbot/condor
- TradingAgents: https://github.com/TauricResearch/TradingAgents

Le componenti upstream mantengono le rispettive licenze. Consultare i file LICENSE originali prima di redistribuirli.

## Architettura
1. Hummingbot gestisce connettori, strategie, ordini e posizioni crypto.
2. TradingAgents produce analisi a intervalli controllati.
3. Un Risk Gateway verifica modalità, esposizione e limiti.
4. Solo il Risk Gateway può inoltrare proposte approvate a Hummingbot.
5. Il journal registra decisioni, motivazioni, ordini e risultati.

## Prima verifica
Seguire l'installazione ufficiale Hummingbot: https://hummingbot.org/installation/
Configurazione Binance Paper Trade: https://hummingbot.org/global-configs/exchanges/
TradingAgents: https://github.com/TauricResearch/TradingAgents

## Test
Eseguire: python -m unittest discover -s tests -v

Nessun profitto è garantito. I risultati PAPER non garantiscono risultati futuri.
