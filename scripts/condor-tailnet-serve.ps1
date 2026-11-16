$ErrorActionPreference = "Stop"

$tailscale = Get-Command "tailscale.exe" -ErrorAction SilentlyContinue
if (-not $tailscale) {
    $candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
    if (Test-Path $candidate) {
        $tailscalePath = $candidate
    } else {
        throw "Tailscale CLI non trovato. Installa e avvia Tailscale su Windows, poi ripeti."
    }
} else {
    $tailscalePath = $tailscale.Source
}

try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8088/" -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
        throw "HTTP $($response.StatusCode)"
    }
} catch {
    throw "Condor non risponde su http://127.0.0.1:8088. Avvialo in WSL con: cd ~/condor && make run. Dettaglio: $($_.Exception.Message)"
}

& $tailscalePath serve --bg "http://127.0.0.1:8088"
if ($LASTEXITCODE -ne 0) {
    throw "Configurazione Tailscale Serve non riuscita. Verifica che Tailscale sia connesso e che HTTPS/Serve sia abilitato nel tailnet."
}

Write-Host ""
Write-Host "Configurazione Tailscale Serve:"
$serveStatus = & $tailscalePath serve status 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Tailscale Serve e' stato configurato ma non riesco a leggerne lo stato."
}
$serveText = $serveStatus -join [Environment]::NewLine
Write-Host $serveText
$match = [regex]::Match($serveText, "https://[A-Za-z0-9.-]+\.ts\.net")
if (-not $match.Success) {
    throw "URL HTTPS Tailscale non individuato nell'output. Controlla 'tailscale serve status'."
}
$condorUrl = $match.Value

Write-Host ""
Write-Host "URL Condor privato: $condorUrl"
Write-Host "Questo endpoint e' privato al tailnet. Non e' stato attivato Tailscale Funnel."

$gh = Get-Command "gh.exe" -ErrorAction SilentlyContinue
if ($gh) {
    & $gh.Source auth status *> $null
    if ($LASTEXITCODE -eq 0) {
        $condorUrl | & $gh.Source secret set CONDOR_WEB_URL --repo "Parontv/miracolo-trading-ai"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Secret CONDOR_WEB_URL aggiornato su GitHub."
            & $gh.Source workflow run deploy-cloudflare.yml --ref main --repo "Parontv/miracolo-trading-ai"
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Deploy Cloudflare avviato. Verifica il workflow Deploy Cloudflare su GitHub Actions."
            } else {
                Write-Warning "Secret aggiornato, ma non sono riuscito ad avviare il workflow. Avvialo da GitHub Actions."
            }
        } else {
            Write-Warning "Non sono riuscito a salvare CONDOR_WEB_URL su GitHub."
        }
    } else {
        Write-Host "GitHub CLI non autenticata. Aggiungi manualmente il secret CONDOR_WEB_URL con valore: $condorUrl"
    }
} else {
    Write-Host "GitHub CLI non installata. Aggiungi manualmente il secret CONDOR_WEB_URL con valore: $condorUrl"
}
