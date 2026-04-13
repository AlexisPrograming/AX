$taskName = 'AXIOM Startup'
$xml = (Get-ScheduledTask -TaskName $taskName | Export-ScheduledTask)

# Inject Priority 0 into Settings block
if ($xml -match '<Priority>\d+</Priority>') {
    $xml = $xml -replace '<Priority>\d+</Priority>', '<Priority>0</Priority>'
} else {
    $xml = $xml -replace '</Settings>', "  <Priority>0</Priority>`r`n  </Settings>"
}

$tmpXml = [System.IO.Path]::GetTempFileName() + '.xml'
[System.IO.File]::WriteAllText($tmpXml, $xml, [System.Text.Encoding]::Unicode)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Register-ScheduledTask -TaskName $taskName -Xml (Get-Content $tmpXml -Raw) | Out-Null
Remove-Item $tmpXml -Force

Write-Host "Done - AXIOM Startup task priority set to 0 (highest)" -ForegroundColor Green
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, @{N='Priority';E={$_.Settings.Priority}} | Format-List
