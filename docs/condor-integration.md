# Integrazione Condor upstream

## Sorgente fissata

- Repository ufficiale: https://github.com/hummingbot/condor
- Percorso nel repository Miracolo: `upstream/condor/`
- Commit fissato: `2442752df1259651002034055a32d974da29a361`
- Hummingbot API ed engine: installati e configurati secondo la procedura ufficiale Condor; non duplicati nel codice Miracolo.

Il submodule conserva il codice upstream originale e la relativa licenza/attribuzione. Gli aggiornamenti devono essere revisionati e fissati esplicitamente.

## Clone e verifica

Clonare il repository includendo il submodule:

```bash
git clone --recurse-submodules https://github.com/Parontv/miracolo-trading-ai.git
cd miracolo-trading-ai
git submodule status
git -C upstream/condor rev-parse HEAD
```

Il commit deve corrispondere a `2442752df1259651002034055a32d974da29a361`. Se il submodule manca:

```bash
git submodule update --init --recursive
```

## Requisiti upstream rilevati

- Linux/macOS oppure Windows tramite WSL2 con Ubuntu.
- Python `>=3.12,<3.14`.
- Node.js 22 e npm per la dashboard web.
- `uv` per l'ambiente Python.
- Docker installato e avviato per Hummingbot API e i servizi richiesti.
- Host persistente per l'esecuzione continuativa.

Usare sempre il README e il Makefile del commit fissato come fonte definitiva. La procedura upstream include `make setup`, `make install`, `make doctor` e `make run`. Non avviare il motore con credenziali LIVE.

## Rete e accesso da telefono

Condor in Local mode espone la dashboard su `127.0.0.1:8088` senza login. Non esporre questa porta direttamente a LAN o Internet. Per l'accesso remoto usare una rete privata autenticata (Tailscale) oppure Cloudflare Tunnel con Cloudflare Access configurato correttamente davanti al servizio. Non pubblicare direttamente Hummingbot API sulla porta 8000, MQTT o database.

Il Worker Miracolo usa il secret `CONDOR_WEB_URL` per il link HTTPS verso la dashboard originale. Il redirect non dimostra che i bot siano attivi: verificare Condor con `make doctor`, `make status` e i health check Hummingbot API.

## Confini funzionali

- Condor rimane l'interfaccia operativa principale.
- Hummingbot/Hummingbot API restano il motore e i servizi originali.
- Miracolo gestisce accesso unificato, branding e integrazioni specifiche.
- Alpaca PAPER è un'integrazione separata già presente nel vecchio progetto Miracolo Lab: non va dichiarata come connettore Hummingbot nativo. La compatibilità va verificata prima di collegarla all'esecuzione Condor.
- LIVE resta disabilitato.

## Validazione

La workflow `Validate Condor upstream` verifica il commit del submodule, compila la dashboard originale e lancia i test frontend upstream. Questo non sostituisce i test di installazione backend, connessione Hummingbot API, exchange o runtime 24/7.

Prima di dichiarare operativo il sistema, eseguire su un host persistente:
1. `make setup` e `make install`.
2. `make doctor` senza errori bloccanti.
3. `make run` e `make status`.
4. Verifica della dashboard dal browser e del collegamento all'API.
5. Test PAPER end-to-end di dati, portfolio, ordine, cancellazione, stop, arresto/riavvio e riconciliazione.
