# Piano di integrazione Condor

## Stato
Decisione architetturale: Condor è la base applicativa da integrare. Questa fase documenta l'integrazione e i suoi vincoli; non dichiara ancora Condor installato o collegato a un exchange.

## Cosa riutilizziamo
- Dashboard web React/TypeScript di Condor.
- Backend e client Hummingbot API.
- Portfolio, bot monitoring, executor e gestione posizioni.
- Agenti e routine già presenti.
- Modalità locale o Telegram, scegliendo quella più adatta al controllo Android.

Repository upstream: https://github.com/hummingbot/condor
Commit upstream esaminato: `a817f6633a90afe41523377bfd360c0b9316d423`

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

## Requisiti di deploy
Condor e Hummingbot API necessitano di un host persistente; Hummingbot API richiede Docker. Cloudflare Pages/Workers possono ospitare solo una UI o un piano di controllo leggero, non i processi Python sempre attivi. La modalità locale di Condor non ha login e deve rimanere su localhost o dietro accesso privato autenticato.

## Gate di sicurezza
- Nessun secret in Git o nel frontend.
- Nessuna credenziale LIVE durante sviluppo e collaudo.
- Tutte le azioni di trading bloccate per default.
- Gli agenti AI non possono creare, modificare o cancellare ordini senza passare dal Risk Gateway.
- In caso di errore o perdita dati: fail closed, nessun nuovo ordine.
- Non dichiarare 24/7 finché un runtime persistente non è attivo e monitorato.
