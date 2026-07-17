param([hashtable]$Body)

$json = $Body | ConvertTo-Json -Depth 10
Write-Host "--- JSON ที่จะส่ง ---" -ForegroundColor Cyan
Write-Host $json
Write-Host "---------------------" -ForegroundColor Cyan

try {
  $r = Invoke-RestMethod -Uri "http://localhost:3001/production-logs/start" `
       -Method Post -ContentType "application/json" -Body $json
  Write-Host "✓ SUCCESS" -ForegroundColor Green
  $r | ConvertTo-Json -Depth 10
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host ("ERROR {0}" -f $statusCode) -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Yellow
    } else {
        Write-Host "ไม่มีรายละเอียด error body" -ForegroundColor DarkYellow
    }
}