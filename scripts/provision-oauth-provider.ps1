param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("google_drive", "dropbox", "microsoft_graph")]
  [string]$Provider,
  [Parameter(Mandatory = $true)]
  [ValidateLength(3, 512)]
  [string]$ClientId,
  [string]$Origin = "https://tavonel.com",
  [string]$ProtectedTokenPath = "$HOME\.tavonel\oauth-broker-token.dpapi"
)

$ErrorActionPreference = "Stop"
$envSuffix = @{
  google_drive = "GOOGLE_DRIVE"
  dropbox = "DROPBOX"
  microsoft_graph = "MICROSOFT_GRAPH"
}[$Provider]
$secretName = "oauth/provider/$Provider/client-secret"
$reference = $null

if (-not (Test-Path -LiteralPath $ProtectedTokenPath)) {
  throw "Protected OAuth broker credential is not available for this Windows user."
}
$secureToken = Get-Content -Raw -LiteralPath $ProtectedTokenPath | ConvertTo-SecureString
$token = [System.Net.NetworkCredential]::new("", $secureToken).Password
$providerSecret = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($providerSecret) -or $providerSecret.Length -gt 65536) {
  throw "The clipboard does not contain a valid provider secret."
}

try {
  $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  $write = Invoke-RestMethod -Uri "$Origin/api/internal/oauth-secrets/v1/secrets/write" -Method Post -Headers $headers -Body (
    @{ name = $secretName; value = $providerSecret.Trim() } | ConvertTo-Json -Compress
  )
  $reference = $write.reference
  if ($reference -notmatch '^vercel://oauth/[0-9a-f-]{36}$') {
    throw "The broker returned an invalid managed reference."
  }
  $ClientId | pnpm dlx vercel@latest env add "TAVONEL_OAUTH_${envSuffix}_CLIENT_ID" production --no-sensitive --force --yes | Out-Null
  $reference | pnpm dlx vercel@latest env add "TAVONEL_OAUTH_${envSuffix}_CLIENT_SECRET_REF" production --no-sensitive --force --yes | Out-Null
  [pscustomobject]@{
    Provider = $Provider
    BrokerReferenceStored = $true
    VercelRuntimeConfigured = $true
    PlaintextPersisted = $false
  }
} catch {
  if ($reference) {
    try {
      Invoke-WebRequest -Uri "$Origin/api/internal/oauth-secrets/v1/secrets/delete" -Method Post -Headers $headers -Body (
        @{ reference = $reference } | ConvertTo-Json -Compress
      ) | Out-Null
    } catch {
      Write-Warning "Compensating broker deletion needs operator review."
    }
  }
  throw
} finally {
  Set-Clipboard -Value ""
  $providerSecret = $null
  $token = $null
  $secureToken.Dispose()
}
