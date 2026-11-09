# Miracolo Trading AI

Miracolo è una piattaforma **crypto-only** con **Alpaca PAPER come unico broker**. L'app è una dashboard web servita direttamente da Cloudflare Workers; la scansione usa un Cron Trigger ogni minuto e non dipende dal browser aperto né da un server Linux sempre acceso.

## Architettura

- **Cloudflare Worker**: API same-origin e scanner schedulato.
- **Cloudflare D1**: journal persistente di stato e segnali.
- **Cloudflare Workers Static Assets**: dashboard mobile-first dalla cartella `web/`.
- **Alpaca PAPER**: unica integrazione broker; le chiavi sono Worker Secrets, mai esposte al browser.
- **Cloudflare Access**: protegge gli endpoint privati e la dashboard.
- **Condor**: solo riferimento UI/UX. Hummingbot e simulatori browser non sono nel percorso di esecuzione.

## Stato reale

| Componente | Stato |
|---|---|
| Dashboard statica | Implementata |
| Worker API Cloudflare | Implementata, da distribuire |
| Cron scanner crypto EMA 9/21 | Implementato con cursori per simbolo, recupero dei bar persi e controllo dati stale; da distribuire |
| Journal D1 | Schema pronto, database da creare nell'account Cloudflare |
| Lettura privata Alpaca PAPER | Implementata nel Worker, richiede secrets e Cloudflare Access |
| Risk Gateway | Implementato e testato nel runtime Python, da portare nel percorso Worker prima di abilitare ordini |
| Invio ordini | **Bloccato** |
| LIVE | **Disabilitato** |

La scansione interroga separatamente BTC/USD, ETH/USD e QNT/USD, usa solo barre da 1 minuto chiuse e controlla che i dati siano recenti. I cursori D1 consentono di recuperare i crossover delle barre non ancora elaborate dopo un ritardo del Cron. La scansione registra segnali, non ordini. Nessun ordine viene inviato da questa versione.

## Pubblicazione

Segui [la guida Cloudflare](docs/runtime-deployment.md). Il primo deploy richiede un D1 database e tre GitHub repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `D1_DATABASE_ID`. Dopo il primo deploy, attiva Cloudflare Access sul Worker e aggiungi i secrets Alpaca PAPER e Access. Il workflow pubblica automaticamente gli aggiornamenti su `main`.

Il link finale avrà il formato `https://miracolo-trading-ai.<workers-subdomain>.workers.dev`. Il sottodominio è assegnato dal tuo account Cloudflare, quindi non viene inventato né dato per attivo prima della verifica.

## Sicurezza

Non inserire mai chiavi o token in Git, nel frontend, in URL o nella chat. Usa esclusivamente credenziali Alpaca PAPER. Il codice non abilita LIVE e non invia ordini. Prima di qualsiasi esecuzione PAPER dovranno essere completati Risk Gateway, riconciliazione ordini e ciclo di protezione stop-loss end-to-end.

## Test locali

```bash
python -m unittest discover -s tests -v
node --check web/app.js
node --input-type=module --check < cloudflare/worker.js
node --test tests/cloudflare-worker.test.mjs
``
