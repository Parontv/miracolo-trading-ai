# Miracolo Trading AI

Miracolo è una piattaforma **crypto-only** con **Alpaca PAPER come unico broker**. L'app è una dashboard web servita direttamente da Cloudflare Workers; la scansione usa un Cron Trigger ogni minuto e non dipende dal browser aperto né da un server Linux sempre acceso.

## Architettura

- **Cloudflare Worker**: API same-origin e scanner schedulato.
- **Cloudflare D1**: journal persistente di stato e segnali.
- **Cloudflare Workers Static Assets**: dashboard mobile-first dalla cartella `web/`.
- **Alpaca PAPER**: unica integrazione broker; le chiavi sono Worker Secrets, mai esposte al browser.
- **Cloudflare Access**: protegge gli endpoint privati che leggono conto, posizioni, ordini e asset.
- **Condor**: solo riferimento UI/UX. Hummingbot e simulatori browser non sono nel percorso di esecuzione.

## Stato reale

| Componente | Stato |
|---|---|
| Dashboard statica | Implementata |
| Worker API Cloudflare | Implementata, da distribuire |
| Cron scanner crypto EMA 9/21 | Implementato, da distribuire e configurare |
| Journal D1 | Schema pronto, database da creare nell'account Cloudflare |
| Lettura privata Alpaca PAPER | Implementata nel Worker, richiede secrets e Cloudflare Access |
| Risk Gateway | Implementato e testato nel runtime Python, da portare nel percorso Worker prima di abilitare ordini |
| Invio ordini | **Bloccato** |
| LIVE | **Disabilitato** |

La scansione produce segnali, non ordini. Nessun ordine viene inviato da questa versione.

## Deploy Cloudflare

La configurazione è in `wrangler.jsonc`; la cartella statica è `web/`, il Worker è `cloudflare/worker.js` e lo schema D1 è `migrations/0001_init.sql`.

1. Crea un database D1 chiamato `miracolo-trading-ai` con `npx wrangler@4 d1 create miracolo-trading-ai` e inserisci il suo ID nel campo `database_id` di `wrangler.jsonc`.
2. Crea un API Token Cloudflare con permessi Workers Scripts:Edit e D1:Edit e recupera l'Account ID.
3. In GitHub, aggiungi i repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
4. Configura Cloudflare Access per l'hostname `<worker>.<workers-subdomain>.workers.dev`, con una policy Allow limitata alla tua email. L'audience tag dell'app va salvato in `ACCESS_AUD`; il team domain senza `.cloudflareaccess.com` va in `ACCESS_TEAM_DOMAIN`.
5. Il workflow GitHub `Deploy Cloudflare` applica le migrazioni D1, carica i Worker Secrets e distribuisce Worker e dashboard a ogni push su `main`.

Dopo il primo deploy, Cloudflare assegna un URL HTTPS `https://miracolo-trading-ai.<workers-subdomain>.workers.dev`. Il sottodominio dipende dal tuo account e non va indovinato.

## Sicurezza

Non inserire mai chiavi o token in Git, nel frontend, in URL o nella chat. Usa esclusivamente credenziali Alpaca PAPER. Il codice non abilita LIVE e non invia ordini. Prima di qualsiasi esecuzione PAPER dovranno essere completati Risk Gateway, riconciliazione ordini e ciclo di protezione stop-loss end-to-end.

## Test locali

```bash
python -m unittest discover -s tests -v
node --check web/app.js
node --input-type=module --check < cloudflare/worker.js
``
