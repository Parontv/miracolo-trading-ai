# Miracolo Trading AI

Piattaforma indipendente per trading crypto PAPER basata sui progetti originali Hummingbot e TradingAgents.

> Stato: bootstrap architetturale. Questo repository non invia ordini reali.

## Principi
- Hummingbot resta il motore di esecuzione: non ne riscriviamo strategie, connettori o ciclo ordini.
- TradingAgents produce analisi e proposte, senza inviare ordini.
- Ogni proposta passa da controlli di rischio deterministici.
- Modalità iniziale esclusivamente PAPER.
- Massimo 3 nuove operazioni al giorno.
- Nessuna API key o credenziale nel repository.

## Componenti upstream
- Hummingbot: https://github.com/hummingbot/hummingbot
- Hummingbot API: https://github.com/hummingbot/hummingbot-api
- Condor (da valutare in fase successiva): https://github.com/hummingbot/condor
- TradingAgents: https://github.com/TauricResearch/TradingAgents

Le componenti upstream mantengono le rispettive licenze. Consultare i file LICENSE originali prima di redistribuirle.

## Architettura
1. Hummingbot gestisce connettori, strategie e ordini.
2. TradingAgents produce analisi a intervalli controllati.
3. Un Risk Gateway verifica modalità, limiti ed esposizione.
4. Solo il Risk Gateway può inoltrare proposte approvate a Hummingbot.
5. Il journal registra decisioni, motivazioni, ordini e risultati.

## Prima verifica
Seguire l'installazione ufficiale Hummingbot: https://hummingbot.org/installation/
Configurazione Binance Paper Trade: https://hummingbot.org/global-configs/exchanges/
TradingAgents: https://github.com/TauricResearch/TradingAgents

## Test
Eseguire: python -m unittest discover -s tests -v

Nessun profitto è garantito. I risultati PAPER non garantiscono risultati futuri.
