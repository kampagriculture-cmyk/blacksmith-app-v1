param([int]$Id, [hashtable]$Body)

$json = $Body | ConvertTo-Json -Depth 10
Write-Host "--- JSON ที่จะส่ง (id=$Id) ---" -ForegroundColor Cyan
Write-Host $json
Write-Host "---------------------" -ForegroundColor Cyan

$url = "http://localhost:3001/production-logs/{0}" -f $Id

try {
    $r = Invoke-RestMethod -Uri $url -Method Patch -ContentType "application/json" -Body $json
    Write-Host "SUCCESS" -ForegroundColor Green
    $r | ConvertTo-Json -Depth 10
}
catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host ("ERROR {0}" -f $statusCode) -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Yellow
    } else {
        Write-Host "ไม่มีรายละเอียด error body" -ForegroundColor DarkYellow
    }
}

Write-Host "`n--- ประวัติการแก้ไข (id=$Id) ---" -ForegroundColor Cyan
try {
    $h = Invoke-RestMethod -Uri ("http://localhost:3001/production-logs/{0}/history" -f $Id) -Method Get
    $h | ConvertTo-Json -Depth 10
}
catch {
    Write-Host "ดึงประวัติไม่ได้" -ForegroundColor Red
}

# ตัวอย่างเรียก:
# .\test-edit.ps1 -Id 5 -Body @{ totalQty = 150; editedBy = "กัมพล"; editReason = "นับยอดผิดตอน checkout" }
