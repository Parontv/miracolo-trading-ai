# Architettura Miracolo

## Decisione unica

Miracolo usa **Alpaca PAPER come unico broker e unico esecutore**. Il perimetro iniziale è crypto-only. LIVE è disabilitato e non deve essere configurabile dal frontend.

## Componenti

- **Dashboard Miracolo**: interfaccia italiana, mobile-first, per stato, conto, posizioni, ordini e controlli.
- **Alpaca adapter**: unico client broker, collegato esclusivamente all'endpoint PAPER.
- **Risk Gateway**: unico punto autorizzato a validare ogni ordine prima dell'invio.
- **Worker persistente**: processo server-side per analisi e gestione del bot 24/7, indipendente dal browser.
- **Journal**: registro persistente e riconciliazione di segnali, ordini, esecuzioni e posizioni.

Condor è stato consultato soltanto come riferimento per organizzazione e usabilità dell'interfaccia. Non è una dipendenza runtime. Hummingbot, Binance browser simulator e TradingAgents non fanno parte del percorso di esecuzione.

## Confini di sicurezza

1. Tutte le richieste d'ordine devono passare dal Risk Gateway.
2. Il bot non può inviare ordini se rischio, dati, stato del broker o journal non sono disponibili.
3. Le credenziali Alpaca e il token API restano sul server.
4. L'accesso remoto alla dashboard deve essere protetto da Cloudflare Access.
5. LIVE resta disabilitato.
6. L'invio ordini resta bloccato finché il gateway e il worker non sono completati e verificati.

## Runtime 24/7

La dashboard è soltanto il pannello di controllo. Il processo di trading richiede un host Linux sempre acceso con Docker, riavvio automatico e monitoraggio. Una scheda browser o un Cloudflare Worker non sostituiscono un processo Python persistente.

## Criteri per il rilascio PAPER

- Dati e conto letti dal conto Alpaca PAPER effettivo.
- Risk Gateway testato su tutti i percorsi d'ordine.
- Limiti di perdita, esposizione, numero operazioni, stop-loss e kill switch verificati.
- Journal e riconciliazione dopo riavvio verificati.
- Ciclo PAPER completo testato, dall'ingresso all'uscita.
- Nessun percorso LIVE disponibile.
