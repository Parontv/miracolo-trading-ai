# Miracolo Trading AI

Miracolo integra **Condor e Hummingbot originali**, con **Alpaca PAPER come unico ambiente broker autorizzato per la fase iniziale**. Cloudflare ospita la web app Miracolo, le API edge e D1; Condor/Hummingbot richiedono il proprio runtime persistente.

## Architettura

- **Condor**: dashboard e control room originali, non ricostruite; sorgente upstream inclusa come Git submodule in `upstream/condor/`.
- **Hummingbot + Hummingbot API**: motore e servizi originali, secondo i requisiti upstream e l'installazione ufficiale Condor.
- **Cloudflare Worker**: accesso web Miracolo e API edge compatibili.
- **Cloudflare D1**: database Miracolo già previsto dal progetto; mantenere il database esistente e la relativa associazione, non crearne uno duplicato.
- **Cloudflare Workers Static Assets**: web app mobile-first dalla cartella `web/`, tema scuro.
- **Alpaca PAPER**: adapter esistente nel vecchio Miracolo Lab, separato da Hummingbot. La revisione Hummingbot fissata non include un connector Alpaca nativo: per eseguire Alpaca attraverso Hummingbot serve un connector dedicato, da sviluppare e collaudare prima di qualsiasi ordine.
- **Cloudflare Access/Tunnel**: accesso HTTPS protetto alla web app e alla dashboard Condor.

## Stato verificato del codice

| Componente | Stato |
|---|---|
| Web app Miracolo | Implementata, tema scuro |
| Link alla dashboard originale Condor | Implementato; richiede URL HTTPS e runtime Condor raggiungibile |
| Route Worker `/condor` | Implementata, rifiuta URL non HTTPS |
| Worker API e scanner | Presenti nel repository, da verificare nel deploy effettivo |
| D1 | Binding `DB` e migrazioni presenti; usare il database già esistente e verificare il suo ID |
| Alpaca PAPER | Endpoint di lettura presenti; esecuzione ordini non abilitata |
| Esecuzione automatica PAPER | Bloccata fino al completamento e test dell'intero percorso di rischio |
| LIVE | Disabilitato |

La scansione registra segnali EMA 9/21 su barre crypto chiuse da un minuto. Non invia ordini. La dashboard Miracolo non sostituisce le funzioni originali di Condor.

## Sorgente upstream Condor

Il submodule ufficiale è fissato al commit `2442752df1259651002034055a32d974da29a361`. Clonare il repository con `git clone --recurse-submodules` e verificare il pin con `git -C upstream/condor rev-parse HEAD`. Le istruzioni e i requisiti di installazione sono in [docs/condor-integration.md](docs/condor-integration.md). Non copiare né riscrivere la dashboard: si usa quella upstream.

## Collegamento Condor

Impostare il GitHub Actions secret `CONDOR_WEB_URL` con l'URL HTTPS della dashboard Condor, raggiungibile dal browser e protetto da Cloudflare Access. Il workflow lo carica come Worker Secret durante il deploy. Il link Condor nella barra laterale apre la dashboard originale in una nuova scheda. Non esporre direttamente la porta locale 8088 né la porta Hummingbot API 8000.

Il redirect conferma soltanto l'indirizzo configurato: la disponibilità di Condor, Hummingbot API e bot va verificata separatamente con i relativi health check.

## Pubblicazione Cloudflare e D1 esistente

Seguire [la guida runtime](docs/runtime-deployment.md). **Non creare un nuovo database D1**: il progetto deve continuare a usare quello già creato e associato in Cloudflare.

Il workflow legge l'ID D1 dal GitHub Actions secret `D1_DATABASE_ID` e lo inserisce temporaneamente in `wrangler.jsonc` durante il deploy. Verificare che il secret contenga l'UUID del database esistente chiamato `miracolo-trading-ai`. Conservare il binding `DB` e applicare solo le migrazioni previste dal repository. Non sostituire il database o cancellarne i dati.

Servono inoltre i secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`. Il nome host Workers è assegnato dall'account Cloudflare e va verificato dopo il deploy, non inventato.

## Sicurezza

Non inserire chiavi o token in Git, frontend, URL o chat. Usare esclusivamente credenziali Alpaca PAPER. LIVE resta disabilitato. Nessun ordine PAPER automatico va attivato prima di test end-to-end su preflight, rischio, fill parziali, stop protettivi, riavvio, riconciliazione e gestione delle emergenze.

## Test locali

```bash
python -m unittest discover -s tests -v
node --check web/app.js
node --input-type=module --check < cloudflare/worker.js
node --test tests/cloudflare-worker.test.mjs tests/cloudflare-risk-gateway.test.mjs tests/cloudflare-order-lifecycle.test.mjs
```
