# Miracolo Trading AI

Piattaforma indipendente **crypto-only**, progettata per operatività continua 24/7 e costruita integrando Condor, Hummingbot e TradingAgents.

> Stato: integrazione architetturale in corso. Non è ancora collegata a un exchange e non invia ordini reali.

## Obiettivo operativo
- Solo mercati crypto, 24 ore su 24 e 7 giorni su 7.
- Condor è la base applicativa per dashboard, agenti e gestione operativa.
- Hummingbot è il motore di esecuzione e gestione ordini.
- TradingAgents è il livello di ricerca e proposta, non un esecutore.
- Nessun limite arbitrario di 3 operazioni al giorno: la frequenza dipende dalla strategia, dalla liquidità e dai costi.
- Protezioni su posizioni simultanee, frequenza ordini, perdita giornaliera e stop loss.
- Modalità iniziale esclusivamente PAPER.
- Nessuna API key o credenziale nel repository.

## Componenti upstream
- Condor: https://github.com/hummingbot/condor
- Hummingbot: https://github.com/hummingbot/hummingbot
- Hummingbot API: https://github.com/hummingbot/hummingbot-api
- TradingAgents: https://github.com/TauricResearch/TradingAgents

Le componenti upstream mantengono le rispettive licenze. Conservare licenze e attribuzioni originali.

## Architettura
1. Condor fornisce dashboard, agenti, routine e gestione operativa.
2. Hummingbot gestisce connettori, strategie, ordini e posizioni crypto.
3. TradingAgents produce analisi a intervalli controllati.
4. Il Risk Gateway verifica modalità, esposizione, limiti e idempotenza.
5. Solo il Risk Gateway può autorizzare operazioni verso Hummingbot.
6. Il journal registra decisioni, motivazioni, ordini e risultati.

## Sicurezza
- PAPER è l'unica modalità consentita durante sviluppo e collaudo.
- LIVE resta disabilitato.
- Nessun agente AI può inviare ordini direttamente.
- Hummingbot API non deve essere esposta su Internet pubblico.
- Per i vincoli di rete, runtime e setup leggere [docs/condor-integration.md](docs/condor-integration.md).

## Test
Eseguire: `python -m unittest discover -s tests -v`

Nessun profitto è garantito. I risultati PAPER non garantiscono risultati futuri.
