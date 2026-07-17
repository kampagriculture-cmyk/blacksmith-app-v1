# test-post.ps1 — ยิง POST แล้วโชว์ error body ให้เห็นเต็มๆ
param([Parameter(Mandatory=$true)] $Body)

$json = $Body | ConvertTo-Json

try {
    $res = Invoke-RestMethod -Uri http://localhost:3001/production-logs `
        -Method Post -ContentType "application/json" -Body $json
    Write-Host "=== SUCCESS ===" -ForegroundColor Green
    $res | Format-List
}
catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host "=== FAILED : HTTP $status ===" -ForegroundColor Red

    $stream = $_.Exception.Response.GetResponseStream()
    $stream.Position = 0
    $raw = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    Write-Host $raw -ForegroundColor Yellow
}