# ─────────────────────────────────────────────────────────────
#  AXIOM Auto-Start Setup
#  Run this ONCE as Administrator on any machine.
#  After running, AXIOM will start automatically at every login
#  with full admin rights — no UAC prompt needed again.
# ─────────────────────────────────────────────────────────────

param(
    [switch]$Remove   # Pass -Remove to unregister the task
)

# ── Paths ──────────────────────────────────────────────────────
$scriptDir  = Split-Path $MyInvocation.MyCommand.Path -Parent
$launchVbs  = Join-Path $scriptDir "launch-axiom.vbs"
$taskName   = "AXIOM Startup"
$axiomExe   = Join-Path $env:LOCALAPPDATA "Programs\axiom\AXIOM.exe"

# ── Guard: must be admin ───────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  ERROR: Run this script as Administrator." -ForegroundColor Red
    Write-Host "  Right-click PowerShell → 'Run as administrator', then re-run." -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

# ── Remove mode ────────────────────────────────────────────────
if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  AXIOM auto-start removed." -ForegroundColor Yellow
    exit 0
}

# ── Verify installed AXIOM.exe exists ─────────────────────────
if (-not (Test-Path $axiomExe)) {
    Write-Host ""
    Write-Host "  ERROR: AXIOM.exe not found at: $axiomExe" -ForegroundColor Red
    Write-Host "  Install AXIOM first by running 'AXIOM Setup x.x.x.exe'." -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "  Found AXIOM.exe: $axiomExe" -ForegroundColor Cyan

# ── Register the scheduled task ────────────────────────────────
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action  = New-ScheduledTaskAction `
    -Execute $axiomExe

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -Priority 0   # 0 = highest priority - AXIOM launches before other startup apps

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Highest    # ← this is what gives admin rights without UAC

# Remove existing task if present, then register fresh
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Starts AXIOM voice assistant at login with administrator privileges." `
    | Out-Null

Write-Host ""
Write-Host "  ✓  AXIOM will now start automatically at every login." -ForegroundColor Green
Write-Host "  ✓  Runs as Administrator — no UAC popup." -ForegroundColor Green
Write-Host "  ✓  Task name: '$taskName'" -ForegroundColor Green
Write-Host ""
Write-Host "  To remove auto-start later, run:" -ForegroundColor Gray
Write-Host "    powershell -File setup-autostart.ps1 -Remove" -ForegroundColor Gray
Write-Host ""

# Offer to start AXIOM right now
$startNow = Read-Host "  Start AXIOM now? (y/n)"
if ($startNow -eq 'y' -or $startNow -eq 'Y') {
    Start-Process $axiomExe
    Write-Host "  AXIOM is starting..." -ForegroundColor Cyan
}
