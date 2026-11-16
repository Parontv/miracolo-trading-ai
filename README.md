# Miracolo Trading AI

Miracolo è una piattaforma **crypto-only** con **Alpaca PAPER come unico broker**. L'app è una dashboard web servita direttamente da Cloudflare Workers; la scansione usa un Cron Trigger ogni minuto e non dipende dal browser aperto né da un server Linux sempre acceso.

## Architettura

- **Cloudflare Worker**: API same-origin e scanner schedulato.
- **Cloudflare D1**: journal persistente di stato e segnali.
- **Cloudflare Workers Static Assets**: dashboard mobile-first dalla cartella `web/`, tema scuro.
- **Condor Web**: voce dedicata nella web app che apre la dashboard originale Condor tramite URL HTTPS protetto (`CONDOR_WEB_URL`); non viene clonata né riscritta.
- **Alpaca PAPER**: unica integrazione broker; le chiavi sono Worker Secrets, mai esposte al browser.
- **Cloudflare Access**: protegge gli endpoint privati e la dashboard.
- **Condor**: dashboard originale e control room operativa. Il collegamento richiede un runtime Condor persistente raggiungibile via HTTPS e protetto da Cloudflare Access o Tailscale. Hummingbot resta il motore di esecuzione; non viene sostituito da un simulatore browser.

## Stato reale

| Componente | Stato |
|---|---|
| Dashboard web Miracolo | Implementata, tema scuro |
| Accesso alla dashboard originale Condor | Route `/condor` implementata; richiede `CONDOR_WEB_URL` HTTPS e runtime Condor attivo |
| Worker API Cloudflare | Implementata, da distribuire |
| Cron scanner crypto EMA 9/21 | Implementato con cursori per simbolo, recupero dei bar persi e controllo dati stale; da distribuire |
| Journal D1 | Segnali, cursori, prenotazioni rischio e schema registro ordini pronti; database da creare nell'account Cloudflare |
| Lettura privata Alpaca PAPER | Implementata nel Worker, richiede secrets e Cloudflare Access |
| Risk Gateway | Modulo Cloudflare e policy Python implementati e testati; controlli non ancora collegati all'invio ordini |
| Riconciliazione broker/journal | Implementata in sola lettura, con controlli su posizioni, ordini e stop; da verificare su account reale PAPER |
| Macchina a stati ordini | Implementata e testata, non ancora collegata all'invio ordini |
| Motore di esecuzione end-to-end | Ancora da implementare e testare |
| Invio ordini | **Bloccato** |
| LIVE | **Disabilitato** |

La scansione interroga separatamente BTC/USD, ETH/USD e QNT/USD, usa solo barre da 1 minuto chiuse e controlla che i dati siano recenti. I cursori D1 consentono di recuperare i crossover delle barre non ancora elaborate dopo un ritardo del Cron. La scansione registra segnali, non ordini. Nessun ordine viene inviato da questa versione.

## Collegamento Condor

Configura `CONDOR_WEB_URL` come variabile del Worker Cloudflare, con l’indirizzo HTTPS pubblico della dashboard Condor esposta tramite Cloudflare Tunnel e protetta da Cloudflare Access. Il link Condor nella barra laterale apre la dashboard originale in una nuova scheda. Non esporre direttamente la porta locale 8088 né la porta Hummingbot API 8000. La variabile deve puntare all’URL di Condor effettivamente raggiungibile dal browser dopo autenticazione.

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
node --test tests/cloudflare-worker.test.mjs tests/cloudflare-risk-gateway.test.mjs tests/cloudflare-order-lifecycle.test.mjs
``
