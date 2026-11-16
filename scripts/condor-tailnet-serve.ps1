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
& $tailscalePath serve status
if ($LASTEXITCODE -ne 0) {
    throw "Tailscale Serve e' stato configurato ma non riesco a leggerne lo stato."
}
Write-Host ""
Write-Host "Apri l'indirizzo HTTPS mostrato sopra da Android con Tailscale attivo."
Write-Host "Questo endpoint e' privato al tailnet. Non e' stato attivato Tailscale Funnel."
