# Miracolo Trading AI

Piattaforma indipendente **crypto-only**. La modalità operativa attuale è un bot PAPER eseguito nel browser: lavora mentre la pagina è aperta e si mette in pausa quando la pagina non è visibile o viene chiusa.

> Stato: bot browser PAPER in sviluppo, con feed pubblico e simulazione locale. L'integrazione Condor resta opzionale. Non vengono inviati ordini reali e LIVE resta disabilitato.

## Obiettivo operativo
- Solo mercati crypto; il bot browser lavora esclusivamente durante la sessione web aperta.
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
| Bot PAPER browser con feed pubblico Binance | Implementato in sviluppo |
| Arresto/pausa del loop quando la pagina è nascosta o chiusa | Implementato |
| Persistenza locale di saldo simulato, posizioni e storico | Implementata |
| Condor submodule fissato a commit | Integrato, non richiesto per il bot browser |
| Adapter API Condor GET-only | Implementato |\n| Adapter Alpaca crypto PAPER (backend, host fisso Paper) | Implementato, in collaudo |\n| API Alpaca protette con token server-side | Implementate, UI session handoff da completare |
| Rinnovo JWT in Condor Local mode loopback | Implementato e testato |
| Lista server e stato Hummingbot | Implementato |
| Lettura portafoglio cached | Implementata |
| Mercati: venue e ticker | Implementati in sola lettura |
| Aggiornamento ticker dashboard | Ogni 15 secondi mentre la pagina Mercati è visibile |
| Monitoraggio bot e controller | Implementato in sola lettura |
| Monitoraggio posizioni aperte | Implementato in sola lettura, refresh 15 secondi nella pagina Operazioni |
| Risk Gateway per ordini PAPER | Adapter Alpaca con allowlist, limiti e controlli; collegamento UI da completare |
| Esecuzione PAPER Hummingbot | Non ancora abilitata |
| TradingAgents | Non ancora integrato |
| Runtime persistente 24/7 | Non previsto nella modalità browser |

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
- La modalità browser si arresta quando la pagina è nascosta o chiusa; non è un servizio 24/7.

## Runtime deployment

Per avviare API e interfaccia su un host Linux persistente con Condor locale, seguire [docs/runtime-deployment.md](docs/runtime-deployment.md) e configurare Alpaca secondo [docs/alpaca-paper.md](docs/alpaca-paper.md). Il pacchetto Docker usa rete host e mantiene API e proxy vincolati a loopback; l'accesso remoto va protetto con Cloudflare Tunnel + Cloudflare Access.

## Test
\`\`\`bash
python -m unittest discover -s tests -v
node --check web/app.js
node --check web/browser-bot.js
\`\`\`

GitHub Actions verifica anche il build frontend e gli import backend della revisione Condor fissata.

Nessun profitto è garantito. I risultati PAPER non garantiscono risultati futuri.
