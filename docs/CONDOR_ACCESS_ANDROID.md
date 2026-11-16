# Accesso privato a Condor da Android (Windows + WSL2)

Questa procedura pubblica **solo la dashboard Condor** nel tailnet Tailscale. Non espone Hummingbot API (porta 8000), database, MQTT o altri servizi e non attiva Funnel.

## Installazione runtime

1. In Windows installa WSL2 con Ubuntu e Docker Desktop con integrazione WSL attiva.
2. Apri Ubuntu (WSL2), scegli una cartella vuota e avvia l'installer ufficiale Condor:

```bash
curl -fsSL https://raw.githubusercontent.com/hummingbot/deploy/main/setup.sh | bash
```

3. Nel wizard scegli **Local** se vuoi usare la dashboard browser senza Telegram. Seleziona anche Hummingbot API nello stesso host quando richiesto. Non inserire chiavi LIVE e non configurare exchange per ora.
4. Terminata l'installazione:

```bash
cd ~/condor
make doctor
make run
```

5. Verifica in Ubuntu che `http://127.0.0.1:8088` risponda.

## Accesso dal telefono

1. Installa Tailscale su Windows e Android e accedi allo stesso account/tailnet. Non attivare Funnel.
2. Da Windows apri PowerShell **come amministratore**, dalla cartella del repository, ed esegui:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\condor-tailnet-serve.ps1
```

3. Lo script verifica prima che Condor risponda localmente. Solo dopo configura Tailscale Serve in background verso `127.0.0.1:8088` e stampa l'URL HTTPS privato.
4. Apri quell'URL su Android con Tailscale connesso e salvalo nei preferiti.

Tailscale Serve è privato ai dispositivi autorizzati nel tailnet. La modalità Local di Condor non ha login: **non** esporre mai direttamente la porta 8088 su Internet o sulla LAN. Non usare `tailscale funnel`.

## Collegamento al dominio Miracolo

Il Worker Cloudflare è già pubblicato, ma il secret `CONDOR_WEB_URL` non era presente al deploy. Dopo aver ottenuto e verificato l'URL HTTPS Tailscale, aggiungilo nei GitHub Actions secrets del repository con il nome esatto `CONDOR_WEB_URL`, quindi rilancia il workflow **Deploy Cloudflare**. La root Miracolo potrà così reindirizzare a Condor.

`ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` sono separati e servono solo agli endpoint Worker protetti da Cloudflare Access. Non sostituiscono l'accesso Tailscale alla dashboard.

## Limiti verificati

- Condor/Hummingbot runtime gira sul PC: il PC deve restare acceso e connesso.
- La dashboard Condor non diventa un servizio Cloudflare Worker: il Worker effettua solo il redirect.
- Alpaca PAPER è configurato nei secrets del Worker, ma la revisione Hummingbot fissata non contiene un connector Alpaca. Nessun ordine Alpaca può essere eseguito da Condor finché il connector dedicato non viene implementato e testato.
- Non vengono create, inviate o abilitate operazioni LIVE.

## Configurazione Cloudflare Access per i dati Alpaca

La dashboard Miracolo usa endpoint Alpaca separati e protetti. Proteggi **solo il percorso API** per non mettere dietro login l'intera dashboard:

1. Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Imposta come hostname `miracolo-trading-ai.listaconcerti.workers.dev` e come path `/api/alpaca/*`.
3. Crea una policy **Allow** che includa esclusivamente il tuo indirizzo email.
4. Salva l'applicazione e copia l'**Application Audience (AUD) Tag**.
5. In Zero Trust → Settings → General recupera il **Team domain**.
6. Nei GitHub Actions secrets del repository imposta:
   - `ACCESS_TEAM_DOMAIN`: solo il nome del team, senza `.cloudflareaccess.com`;
   - `ACCESS_AUD`: il valore AUD dell'applicazione.
7. Rilancia **Deploy Cloudflare**.

La root e gli endpoint diagnostici restano pubblici; solo `/api/alpaca/*` richiede login. Al primo accesso ai dati, completa il login Cloudflare Access nello stesso browser e ricarica la dashboard. Non proteggere l'intero Worker in questa configurazione: il controllo automatico di deploy deve poter leggere l'endpoint pubblico `/api/health`.

