# Miracolo Trading AI

Miracolo è una piattaforma **crypto-only** con **Alpaca PAPER come unico broker e unico sistema di esecuzione**. L'interfaccia è una dashboard web: il bot e il runtime non dipendono dalla pagina aperta.

## Architettura scelta

- **Alpaca PAPER**: unica integrazione broker. L'host API è fissato nel codice a `https://paper-api.alpaca.markets`.
- **Risk Gateway Miracolo**: unico punto autorizzato a validare le future richieste d'ordine. Non è ancora completo.
- **Worker persistente**: processo server-side da implementare per la continuità 24/7.
- **Dashboard web**: pannello di stato e lettura conto/posizioni/ordini Alpaca, senza credenziali broker o token privati nel browser.
- **Condor**: riferimento per organizzazione e usabilità della UI; non è una dipendenza runtime e non invia ordini.
- **Hummingbot, Binance browser simulator e TradingAgents**: non fanno parte del percorso di esecuzione.

## Stato reale

| Componente | Stato |
|---|---|
| Adapter Alpaca PAPER | Implementato |
| Credenziali conservate sul server | Previsto dal runtime |
| Dashboard semplificata mobile-first | Implementata |
| Health check senza dati sensibili | Implementato |
| Lettura privata account, asset, ordini e posizioni | Proxy Caddy server-side implementato; accesso remoto subordinato a Cloudflare Access |
| Policy di rischio deterministica | Implementata e testata; non ancora collegata all'invio ordini |
| Worker persistente 24/7 | Da implementare |
| Journal persistente e riconciliazione ordini | Da implementare |
| Invio ordini | **Bloccato** fino al completamento dei controlli |
| LIVE | **Disabilitato** |

La presenza delle credenziali sul server non equivale a un collegamento autenticato verificato con Alpaca. La dashboard non inventa saldo, prezzi, P&L o operazioni.

## Configurazione runtime

Le credenziali e il token privato devono essere configurati esclusivamente sul server, nel file non versionato `.env.runtime`. Caddy inoltra il token al backend server-side; il browser non lo riceve. Per accesso remoto è obbligatoria una policy Cloudflare Access:

```dotenv
APCA_API_KEY_ID=<Alpaca PAPER key>
APCA_API_SECRET_KEY=<Alpaca PAPER secret>
ALPACA_API_TIMEOUT=8
MIRACOLO_API_TOKEN=<random private token>
```

Non inserire mai chiavi o token in Git, nel frontend, in URL o nella chat. Consultare [docs/alpaca-paper.md](docs/alpaca-paper.md) e [docs/runtime-deployment.md](docs/runtime-deployment.md).

## Runtime 24/7

Una pagina web e Cloudflare Workers non sono un processo Python persistente. Per il bot continuo serve un host Linux sempre acceso, per esempio un PC dedicato o un VPS, con Docker e riavvio automatico dei servizi.

## Test

```bash
python -m unittest discover -s tests -v
node --check web/app.js
```

Nessun profitto è garantito. PAPER è un ambiente di collaudo e non dimostra che una strategia sarà profittevole in LIVE.
