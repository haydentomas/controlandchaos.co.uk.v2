$ErrorActionPreference = 'Stop'
$key = $null
$password = $null
$confirmation = $null
$names = @('SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'CC_RECOVERY_EMAIL', 'CC_RECOVERY_USER_ID', 'CC_RECOVERY_PASSWORD')
$previous = @{}
foreach ($name in $names) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    $env:SUPABASE_URL = 'https://fqzcaragavsutdkswsnm.supabase.co'
    $env:CC_RECOVERY_EMAIL = Read-Host 'Account email'
    $env:CC_RECOVERY_USER_ID = Read-Host 'Account UID from Supabase Authentication > Users (NOT avatar/profile UUID)'
    $key = Read-Host 'V2 secret key (sb_secret_...)' -AsSecureString
    $password = Read-Host 'New password (at least 12 characters)' -AsSecureString
    $confirmation = Read-Host 'Repeat new password' -AsSecureString
    $env:CC_RECOVERY_PASSWORD = [System.Net.NetworkCredential]::new('', $password).Password
    if ($env:CC_RECOVERY_PASSWORD -cne [System.Net.NetworkCredential]::new('', $confirmation).Password) {
        throw 'Passwords do not match. Nothing was sent to Supabase.'
    }
    $env:SUPABASE_SECRET_KEY = [System.Net.NetworkCredential]::new('', $key).Password
    & node (Join-Path $PSScriptRoot 'recover-creator-account.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Recovery did not complete. Review the message above before retrying.' }
}
finally {
    foreach ($name in $names) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
    if ($key) { $key.Dispose() }
    if ($password) { $password.Dispose() }
    if ($confirmation) { $confirmation.Dispose() }
}
