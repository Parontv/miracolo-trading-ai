# Piano di integrazione Condor

## Stato
Condor è collegato alla repository come **Git submodule**, fissato al commit upstream `a817f6633a90afe41523377bfd360c0b9316d423`. Il codice upstream non è stato copiato o modificato: gli aggiornamenti saranno revisionati e fissati esplicitamente.

## Cosa riutilizziamo
- Dashboard web React/TypeScript di Condor.
- Backend e client Hummingbot API.
- Portfolio, bot monitoring, executor e gestione posizioni.
- Agenti e routine già presenti.
- Modalità locale o Telegram, scegliendo quella più adatta al controllo Android.

Repository upstream: https://github.com/hummingbot/condor
Submodule locale: `upstream/condor/`
Licenza upstream dichiarata: MIT. Mantenere la licenza e le attribuzioni originali.

## Requisiti tecnici rilevati
- Python **3.12** (Condor richiede >=3.12 e <3.14).
- Node.js **22** per il frontend.
- `uv` per dipendenze Python.
- Docker per installare e gestire Hummingbot API.
- Host persistente per il funzionamento 24/7.

## Setup locale isolato
Clonare includendo il submodule:

```bash
git clone --recurse-submodules https://github.com/Parontv/miracolo-trading-ai.git
cd miracolo-trading-ai
git submodule status
cd upstream/condor
```

La riga di `git submodule status` deve riportare il commit fissato sopra. Se il codice manca dopo un clone normale:

```bash
git submodule update --init --recursive
```

Per avviare Condor in locale, usare il wizard ufficiale e scegliere **Local mode**, senza Telegram. In questa prima fase non installare né configurare credenziali exchange LIVE:

```bash
make setup
make install
make doctor
make run
```

La modalità locale non ha login e si lega a `127.0.0.1`: usarla solo sulla macchina locale. Non impostare `WEB_HOST=0.0.0.0` e non esporre la porta 8088 su LAN o Internet. Per accesso Android remoto servirà un livello privato autenticato, ad esempio Tailscale, dopo aver verificato il setup.

## Cosa aggiunge Miracolo
- Perimetro esclusivo crypto.
- Configurazione PAPER predefinita.
- Risk Gateway indipendente e obbligatorio.
- Regole di sizing, esposizione, perdita, frequenza e stop.
- Journal decisionale e misurazione dei risultati netti dopo commissioni.
- Analisi TradingAgents senza poteri di esecuzione.
- Interfaccia e messaggi in italiano, con priorità Android.

## Sequenza implementativa
1. **Pin e setup upstream**: fissare una revisione Condor, conservare MIT e avviare il progetto in ambiente isolato.
2. **Audit dei percorsi di ordine**: mappare tutte le chiamate CEX, executor e tool degli agenti verso Hummingbot API.
3. **Read-only integration**: collegare stato, mercati, portfolio, posizioni e ordini senza abilitare nuovi ordini.
4. **Risk Gateway**: introdurre un unico punto di autorizzazione server-side; nessun client o agente può bypassarlo.
5. **PAPER execution**: abilitare solo dopo test su ordini, stop, cancel, idempotenza, limiti e recovery.
6. **TradingAgents**: aggiungere analisi periodiche con output strutturato e non eseguibile.
7. **Hardening 24/7**: health checks, restart policy, log, alert, backup e rete privata.

## Gate di sicurezza
- Nessun secret in Git o nel frontend.
- Nessuna credenziale LIVE durante sviluppo e collaudo.
- Tutte le azioni di trading bloccate per default.
- Gli agenti AI non possono creare, modificare o cancellare ordini senza passare dal Risk Gateway.
- In caso di errore o perdita dati: fail closed, nessun nuovo ordine.
- Non dichiarare 24/7 finché un runtime persistente non è attivo e monitorato.
