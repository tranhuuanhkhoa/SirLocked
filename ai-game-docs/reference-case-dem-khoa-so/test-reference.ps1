[CmdletBinding()]
param(
    [int]$MongoPort = 27026,
    [int]$ApiPort = 5326,
    [int]$FrontendPort = 5286
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mongoExe = Join-Path $repoRoot '.tools/mongodb-it-8.0.8/mongod.exe'
if (!(Test-Path -LiteralPath $mongoExe)) {
    throw 'The bundled local MongoDB binary is missing. Use scripts/test-v3-full-stack.ps1 with your own loopback MongoDB instead.'
}
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $MongoPort)
try { $probe.Start() } finally { $probe.Stop() }
$runRoot = Join-Path $repoRoot ('tmp/reference-case-' + [Guid]::NewGuid().ToString('N'))
$dbPath = Join-Path $runRoot 'mongo'
New-Item -ItemType Directory -Path $dbPath -Force | Out-Null
$mongoLog = Join-Path $runRoot 'mongo.log'
$mongo = Start-Process -FilePath $mongoExe -ArgumentList @('--bind_ip','127.0.0.1','--port',"$MongoPort",'--dbpath',('"'+$dbPath+'"'),'--logpath',('"'+$mongoLog+'"')) -WindowStyle Hidden -PassThru
try {
    $ready = $false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        if ($mongo.HasExited) { throw "Local MongoDB exited. See $mongoLog" }
        $client = [Net.Sockets.TcpClient]::new()
        try { $client.Connect('127.0.0.1',$MongoPort); $ready = $true; break }
        catch { Start-Sleep -Milliseconds 250 }
        finally { $client.Dispose() }
    }
    if (!$ready) { throw 'Local MongoDB did not start.' }
    & (Join-Path $repoRoot 'scripts/test-v3-full-stack.ps1') -PointClick -CaseJsonPath (Join-Path $PSScriptRoot 'case.json') `
        -MongoConnectionString "mongodb://127.0.0.1:$MongoPort/?serverSelectionTimeoutMS=3000" -ApiPort $ApiPort -FrontendPort $FrontendPort `
        *>&1 | Tee-Object -FilePath (Join-Path $runRoot 'test.log')
    if ($LASTEXITCODE -ne 0) { throw "Reference case playthrough failed with exit code $LASTEXITCODE." }
}
finally {
    if (!$mongo.HasExited) { Stop-Process -Id $mongo.Id -Force }
    Write-Host "Reference test logs: $runRoot"
}
