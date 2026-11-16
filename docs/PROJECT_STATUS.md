# Stato operativo Miracolo Trading AI

Aggiornato: 2026-11-16

## Direzione vincolante

- Condor upstream è la dashboard principale, non un semplice riferimento grafico.
- Hummingbot + Hummingbot API sono il motore e il backend operativi.
- Miracolo mantiene accesso, integrazioni specifiche, Cloudflare Worker e database D1 esistente.
- Alpaca PAPER è l'unico broker ammesso nella fase iniziale; LIVE resta disabilitato.
- Non duplicare dashboard, orchestrazione, agenti o order lifecycle già presenti in Condor/Hummingbot.
- Nessun ordine automatico finché il connector Alpaca PAPER e il percorso di rischio end-to-end non sono verificati.

## Stato del branch main

Il branch `main` contiene:
- submodule ufficiale Condor in `upstream/condor`, fissato a `2442752df1259651002034055a32d974da29a361`;
- web shell diagnostica Miracolo in `web/`;
- Worker Cloudflare, API Alpaca PAPER di lettura e scanner EMA;
- binding e migrazioni Cloudflare D1;
- workflow CI e deploy.

**Importante:** la shell `web/` non è la dashboard Condor. Prima della correzione descritta nell'audit, la root del sito mostrava la shell Miracolo e Condor era disponibile solo tramite redirect opzionale `/condor`. Il runtime Compose esistente avvia Miracolo API/scanner e Caddy; non avvia Condor né Hummingbot API.

Nel branch `fix/condor-primary-dashboard-audit` la root `/` reindirizza alla dashboard Condor quando il secret `CONDOR_WEB_URL` è configurato e valido. Se manca, resta disponibile la shell diagnostica. Il redirect non avvia Condor: il runtime deve già essere installato e raggiungibile.

## Capacità Condor upstream

La versione fissata documenta:
- dashboard web con portfolio, PnL, grafici, ordini e pannello trading;
- monitoraggio bot Hummingbot;
- gestione server Hummingbot API e credenziali exchange;
- CEX e DEX, Gateway e liquidity pool;
- agenti AI e routine.

La lista esatta delle funzioni è nella documentazione upstream e in `docs/AUDIT_2026-11-16.md`. Non creare schermate Miracolo parallele per replicarle.

## Stato delle connessioni

| Componente | Stato |
|---|---|
| Deploy Cloudflare Worker e D1 | Deploy del 16 novembre completato con successo |
| Shell web Miracolo | Pubblicata, diagnostica/fallback |
| Condor upstream source | Presente come submodule, commit fissato |
| Condor runtime persistente | Non dimostrato attivo |
| Hummingbot API runtime | Non dimostrato attivo |
| Condor URL | Richiede secret `CONDOR_WEB_URL` |
| Alpaca PAPER REST | Lettura separata, dipende dai secrets e da Cloudflare Access |
| Alpaca come connector Hummingbot | Non implementato |
| Invio ordini | Disabilitato |
| Trading LIVE | Disabilitato |

## Vincoli infrastrutturali

Condor richiede un host persistente Linux/macOS o Windows tramite WSL2, Python 3.12, Node 22, uv e Docker per Hummingbot API. Cloudflare Workers non sostituisce questi processi persistenti.

Condor Local mode non ha login e ascolta su localhost. Per Android usare una rete privata autenticata, preferibilmente Tailscale Serve, o Cloudflare Tunnel con Access. Non esporre direttamente le porte 8088 o 8000, MQTT o database.

La preferenza di progetto è non introdurre un VPS a pagamento. In assenza di un host già disponibile e sempre acceso, non è possibile dichiarare il bot 24/7. Il link Cloudflare può fare da punto di ingresso, ma non ospita il motore.

## Alpaca e Hummingbot

La revisione Hummingbot fissata non include un connector Alpaca. L'adapter Alpaca PAPER di Miracolo è separato e attualmente di sola lettura nella UI Cloudflare. Non dichiarare che Condor può inviare ordini Alpaca finché non viene implementato un connector Hummingbot dedicato.

Piano: `docs/alpaca-hummingbot-connector-plan.md`.

## Priorità operative

1. Avviare Condor e Hummingbot API su un host persistente.
2. Eseguire `make doctor`, `make status` e verificare le API Hummingbot.
3. Configurare accesso privato HTTPS e il secret `CONDOR_WEB_URL`.
4. Verificare root Cloudflare → Condor da browser Android.
5. Verificare portfolio, server e bot con dati reali.
6. Implementare il connector Alpaca PAPER in Hummingbot e i test end-to-end.
7. Solo dopo tutti i test, valutare l'esecuzione PAPER. LIVE resta disabilitato.

## Secrets

Non inserire segreti in Git o chat. Per Cloudflare servono i secrets di deploy già previsti. Per la dashboard Condor serve `CONDOR_WEB_URL`. Per l'API Alpaca Worker servono chiavi PAPER e configurazione Cloudflare Access (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`). Il deploy non deve mai usare credenziali LIVE.

## Audit completo

Consultare `docs/AUDIT_2026-11-16.md` per riscontri, correzioni, blocchi infrastrutturali e criteri di accettazione.
