# Allineamento della policy di rischio

## Decisione per lo stato attuale

La policy JavaScript in `cloudflare/risk-gateway.js` è la sola policy applicabile alla web app Cloudflare attuale. È comunque un modulo non collegato all'invio ordini: non autorizza oggi alcuna esecuzione.

La policy Python in `integration/condor-foundation` è codice di integrazione/prototipo e non deve essere considerata un secondo sistema di autorizzazione in produzione né un motivo per abilitare ordini.

## Differenze verificate

| Controllo | Cloudflare JS | Python Condor branch |
|---|---:|---:|
| Broker | Alpaca PAPER | PAPER generico |
| Perdita giornaliera massima | 15 USD | 15 USD |
| Posizioni aperte | 3 | 5 |
| Ordini al minuto | 2 | 5 |
| Notional massimo per ordine | 100 USD | Non previsto |
| Stop loss obbligatorio | Sì | Sì |
| Ordini AI diretti | No | No |
| Limite operazioni giornaliere | Nessuno | Nessuno |

## Regole

1. Non unire né distribuire le due policy come controlli concorrenti.
2. Prima di integrare il runtime Condor/Hummingbot, definire una sola configurazione di rischio versionata e condivisa.
3. Gli adattatori Cloudflare e Python devono leggere la stessa policy o validare lo stesso schema; non devono ridefinire soglie locali.
4. Ogni parametro deve avere test equivalenti in entrambi gli adattatori.
5. I valori della policy non vanno aumentati implicitamente durante il porting.
6. Il fail-closed resta obbligatorio: dati mancanti, policy non caricata o stato non riconciliato devono bloccare nuovi ordini.
7. L'invio ordini rimane disabilitato fino alla verifica end-to-end del Risk Gateway con Hummingbot PAPER, incluse idempotenza, stop protettivo, cancel, recovery e riconciliazione.

## Prossimo intervento tecnico

Quando si integra Condor/Hummingbot, sostituire la policy Python divergente con un adapter al contratto condiviso, mantenendo le soglie Cloudflare esistenti come riferimento iniziale. Eventuali cambi soglia richiedono motivazione, test e registrazione esplicita.
