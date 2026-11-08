# Miracolo Trading AI

Piattaforma indipendente **crypto-only**, progettata per operatività continua 24/7 e costruita integrando Condor, Hummingbot e TradingAgents.

> Stato: fondazione e integrazione read-only in sviluppo. La dashboard può leggere server, portafoglio e ticker Condor quando il runtime e l'autenticazione sono configurati. Non è ancora un sistema di esecuzione PAPER completo e non invia ordini LIVE.

## Obiettivo operativo
- Solo mercati crypto, 24 ore su 24 e 7 giorni su 7.
- Condor è la base applicativa per dashboard, agenti e gestione operativa.
- Hummingbot è il motore di esecuzione e gestione ordini.
- TradingAgents è il livello di ricerca e proposta, non un esecutore.
- Nessun limite arbitrario di 3 operazioni al giorno: la frequenza dipende dalla strategia, dalla liquidità e dai costi.
- Protezioni su posizioni simultanee, frequenza ordini, perdita giornaliera e stop loss.
- Modalità iniziale esclusivamente PAPER.
- Nessuna API key o credenziale nel repository.

## Stato delle integrazioni

| Funzione | Stato |
|---|---|
| Condor submodule fissato a commit | Integrato |
| Adapter API Condor GET-only | Implementato |
| Rinnovo JWT in Condor Local mode loopback | Implementato e testato |
| Lista server e stato Hummingbot | Implementato |
| Lettura portafoglio cached | Implementata |
| Mercati: venue e ticker | Implementati in sola lettura |
| Aggiornamento ticker dashboard | Ogni 15 secondi mentre la pagina Mercati è visibile |
| Risk Gateway per ordini PAPER | Base iniziale, da collegare al motore |
| Esecuzione PAPER Hummingbot | Non ancora abilitata |
| TradingAgents | Non ancora integrato |
| Runtime persistente 24/7 e deploy | Non ancora configurati |

La UI non inventa prezzi, P&L o ordini: mostra dati mancanti come non disponibili.

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
5. Solo il Risk Gateway potrà autorizzare operazioni PAPER verso Hummingbot.
6. Il journal registra decisioni, motivazioni, ordini e risultati.

## Setup Condor

Consultare [docs/condor-integration.md](docs/condor-integration.md) e [docs/read-only-api.md](docs/read-only-api.md).

Per la connessione locale, Condor deve essere installato e configurato in Local mode sullo stesso host. Impostare nel backend:

\`\`\`bash
CONDOR_API_URL=http://127.0.0.1:8088
CONDOR_AUTH_MODE=local
CONDOR_API_TIMEOUT=5
\`\`\`

In modalità Telegram usare \`CONDOR_AUTH_MODE=bearer\` e un JWT web-session valido nel solo ambiente backend. Non inserire JWT o credenziali exchange nel frontend o in Git.

## Sicurezza
- PAPER è l'unica modalità consentita durante sviluppo e collaudo.
- LIVE resta disabilitato.
- Nessun agente AI può inviare ordini direttamente.
- Le letture di portafoglio usano la cache Condor e non forzano refresh exchange.
- Hummingbot API e Condor non devono essere esposti su Internet pubblico.
- Per un runtime 24/7 serve un host persistente, rete privata, health checks e restart policy.

## Test
\`\`\`bash
python -m unittest discover -s tests -v
node --check web/app.js
\`\`\`

GitHub Actions verifica anche il build frontend e gli import backend della revisione Condor fissata.

Nessun profitto è garantito. I risultati PAPER non garantiscono risultati futuri.
