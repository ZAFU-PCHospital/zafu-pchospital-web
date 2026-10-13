# Local development only. WSL/Docker installation is described in docs/database-windows.md.
[CmdletBinding()]
param(
  [ValidateNotNullOrEmpty()]
  [ValidatePattern('^[^"\r\n]+$')]
  [string]$Distribution = "Debian"
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
& (Join-Path $PSScriptRoot "start-greatsql-wsl.ps1") -Distribution $Distribution

# Provision only databases/accounts; application tables always come from Prisma migrations.
# IF NOT EXISTS preserves existing data and passwords on subsequent runs.
$sql = @'
CREATE DATABASE IF NOT EXISTS zafu_pchospital_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `zafu\_pchospital\_shadow`.* TO 'app_user'@'%';
CREATE DATABASE IF NOT EXISTS zafu_pchospital_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'test_user'@'%' IDENTIFIED BY 'local-test-change-me';
GRANT ALL PRIVILEGES ON `zafu\_pchospital\_test`.* TO 'test_user'@'%';
'@
$sql | & wsl.exe -d $Distribution -u root --cd $repoPath --exec docker compose -p zafu-pchospital-wsl -f compose.greatsql.wsl.yml exec -T greatsql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'
if ($LASTEXITCODE -ne 0) { throw "Could not initialize the local shadow/test databases." }

$utf8 = [System.Text.UTF8Encoding]::new($false)
$envPath = Join-Path $repoPath ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  $content = [System.IO.File]::ReadAllText((Join-Path $repoPath ".env.example"))
  $content = $content.Replace(
    "DATABASE_URL=mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital",
    "DATABASE_URL=mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital?allowPublicKeyRetrieval=true"
  )
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    foreach ($key in @("AUTH_SECRET", "INVITE_CODE_PEPPER", "PII_AUDIT_PEPPER")) {
      $bytes = New-Object byte[] 32
      $random.GetBytes($bytes)
      $secret = [Convert]::ToBase64String($bytes)
      $content = [regex]::Replace($content, "(?m)^$key=[^\r\n]*", "$key=$secret")
    }
  } finally {
    $random.Dispose()
  }
  [System.IO.File]::WriteAllText($envPath, $content, $utf8)
  Write-Host "Created .env with three independent random secrets."
} else {
  Write-Host "Kept existing .env. Check its DATABASE_URL and secrets manually."
}

$testEnvPath = Join-Path $repoPath ".env.test.local"
if (-not (Test-Path -LiteralPath $testEnvPath)) {
  [System.IO.File]::WriteAllText($testEnvPath,
    "DATABASE_URL=mysql://test_user:local-test-change-me@127.0.0.1:3307/zafu_pchospital_test?allowPublicKeyRetrieval=true`n", $utf8)
  Write-Host "Created .env.test.local (isolated test database)."
} else {
  Write-Host "Kept existing .env.test.local."
}
Write-Host "Next: pnpm install, pnpm db:migrate:deploy, pnpm db:seed, pnpm db:health."
