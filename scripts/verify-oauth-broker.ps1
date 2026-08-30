param(
  [string]$Origin = "https://tavonel.com",
  [string]$ProtectedTokenPath = "$HOME\.tavonel\oauth-broker-token.dpapi"
)

$ErrorActionPreference = "Stop"

function Get-HttpFailureStatus([scriptblock]$Request) {
  try {
    & $Request | Out-Null
    return 200
  } catch {
    return [int]$_.Exception.Response.StatusCode
  }
}

if (-not (Test-Path -LiteralPath $ProtectedTokenPath)) {
  throw "Protected OAuth broker credential is not available for this Windows user."
}
$secureToken = Get-Content -Raw -LiteralPath $ProtectedTokenPath | ConvertTo-SecureString
$token = [System.Net.NetworkCredential]::new("", $secureToken).Password
try {
  $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  $endpoint = "$Origin/api/internal/oauth-secrets/v1/secrets"
  $unauthorized = Get-HttpFailureStatus {
    Invoke-WebRequest -Uri "$endpoint/write" -Method Post -ContentType "application/json" -Body '{"name":"canary","value":"x"}'
  }
  $secret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $write = Invoke-RestMethod -Uri "$endpoint/write" -Method Post -Headers $headers -Body (
    @{ name = "canary/production/roundtrip"; value = $secret } | ConvertTo-Json -Compress
  )
  try {
    $read = Invoke-RestMethod -Uri "$endpoint/read" -Method Post -Headers $headers -Body (
      @{ reference = $write.reference } | ConvertTo-Json -Compress
    )
  } finally {
    $deleteStatus = (Invoke-WebRequest -Uri "$endpoint/delete" -Method Post -Headers $headers -Body (
      @{ reference = $write.reference } | ConvertTo-Json -Compress
    )).StatusCode
  }
  $afterDelete = Get-HttpFailureStatus {
    Invoke-WebRequest -Uri "$endpoint/read" -Method Post -Headers $headers -Body (
      @{ reference = $write.reference } | ConvertTo-Json -Compress
    )
  }
  [pscustomobject]@{
    UnauthorizedStatus = $unauthorized
    WriteReferenceValid = $write.reference -match '^vercel://oauth/[0-9a-f-]{36}$'
    RoundTripMatches = $read.value -ceq $secret
    DeleteStatus = $deleteStatus
    ReadAfterDeleteStatus = $afterDelete
  }
} finally {
  $token = $null
  $secureToken.Dispose()
}
