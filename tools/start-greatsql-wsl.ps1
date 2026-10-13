# Requires the WSL 2 VM architecture (including WSL 3.x) with Docker Engine/Compose.
# See docs/database-windows.md. Compatible with Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param(
  [ValidateNotNullOrEmpty()]
  [ValidatePattern('^[^"\r\n]+$')]
  [string]$Distribution = "Debian"
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-WslDocker {
  & wsl.exe -d $Distribution -u root --cd $repoPath --exec docker @args
  if ($LASTEXITCODE -ne 0) {
    throw "Docker command failed in WSL '$Distribution'. See docs/database-windows.md."
  }
}

# Check prerequisites before starting a persistent helper.
Invoke-WslDocker compose version
& wsl.exe -d $Distribution -u root --exec sh -c 'if ! docker info >/dev/null 2>&1; then service docker start; fi'
if ($LASTEXITCODE -ne 0) { throw "Could not start Docker in WSL '$Distribution'." }
Invoke-WslDocker info --format '{{.ServerVersion}}'

# The old mount did not persist the image's actual datadir. Never recreate such
# a container automatically: its writable layer may contain the only data copy.
$containerId = Invoke-WslDocker compose -p zafu-pchospital-wsl -f compose.greatsql.wsl.yml ps -a -q greatsql
if ($containerId) {
  $mounts = (Invoke-WslDocker inspect --format '{{json .Mounts}}' $containerId) | ConvertFrom-Json
  if (-not ($mounts | Where-Object { $_.Destination -eq "/data/GreatSQL" })) {
    throw "Existing GreatSQL uses the old data mount. Back up before recreating it; see docs/database-windows.md."
  }
}

# A systemd service alone does not keep WSL alive. Reuse one hidden helper.
$helperArguments = '-d "{0}" --exec sleep infinity' -f $Distribution
$helperPattern = '(?:^|\s)-d\s+"?' + [regex]::Escape($Distribution) + '"?\s+--exec\s+sleep\s+infinity\s*$'
$keepalive = Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" |
  Where-Object { $_.CommandLine -match $helperPattern } |
  Select-Object -First 1
$startedHelper = $null
if (-not $keepalive) {
  $startedHelper = Start-Process -FilePath wsl.exe -ArgumentList $helperArguments -WindowStyle Hidden -PassThru
  Write-Host "Started WSL keepalive (PID $($startedHelper.Id))."
}

try {
  Invoke-WslDocker compose -p zafu-pchospital-wsl -f compose.greatsql.wsl.yml up -d --wait --wait-timeout 180
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $connection = $client.ConnectAsync("127.0.0.1", 3307)
      if ($connection.Wait(1000) -and $client.Connected) {
        Write-Host "GreatSQL is healthy and reachable at 127.0.0.1:3307."
        return
      }
    } catch [System.AggregateException] {
      # Localhost forwarding can appear shortly after the container is healthy.
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Seconds 2
  }
  throw "Windows cannot reach GreatSQL at 127.0.0.1:3307. Check WSL localhost forwarding and port conflicts."
} catch {
  if ($startedHelper) { Stop-Process -Id $startedHelper.Id -ErrorAction SilentlyContinue }
  throw
}
