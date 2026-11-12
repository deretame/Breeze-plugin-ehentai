#Requires -Version 5.1
<#
.SYNOPSIS
    验证 Breeze 域名前置（IP 直连 / SNI 绕过）在 App 里是否真的生效。

.DESCRIPTION
    面向「用 App 实测」的场景，做三件事：

      1. 找到运行中的 Breeze 进程，读出它的版本，判断插件门控是否应该开启
         （宿主版本必须严格高于 3.0.37，否则插件会隐藏整个「网络」分区）
      2. 轮询该进程的 443 连接，把对端 IP 与内置前置表比对
      3. 汇总：命中了哪些前置 IP、有没有走代理、有没有普通 DNS 连接

    前置生效时，对端 IP 应该落在表里（172.66.x / 178.175.x / 185.132.132.x 等），
    而不是其它地址；如果开了系统代理，所有连接都会指向 127.0.0.1，先关代理再测。

.PARAMETER ProcessName
    App 进程名，默认 zephyr（Windows 构建的 BINARY_NAME）。

.PARAMETER IntervalSeconds
    轮询间隔，默认 2 秒。

.PARAMETER DurationSeconds
    观察时长；0 表示一直跑到 Ctrl+C。

.PARAMETER Once
    只采样一次就退出（适合脚本化检查）。

.PARAMETER FrontHostsFile
    可选：从 JSON 文件读取前置表（{ "host": ["ip", ...] }），默认用脚本内置的、
    与插件 src/network/ip-direct.ts 同步的表。

.EXAMPLE
    .\test-fronting.ps1
    一直观察，翻页 / 搜索时看有没有命中前置 IP。

.EXAMPLE
    .\test-fronting.ps1 -Once
    只采样一次，退出码 0 = 命中前置，1 = 没命中，2 = App 没运行。

.EXAMPLE
    .\test-fronting.ps1 -DurationSeconds 60
    观察 60 秒后自动汇总退出。
#>
[CmdletBinding()]
param(
    [string]$ProcessName = 'zephyr',
    [int]$IntervalSeconds = 2,
    [int]$DurationSeconds = 0,
    [switch]$Once,
    [string]$FrontHostsFile = ''
)

$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# 与插件 src/network/ip-direct.ts 的 DEFAULT_FRONT_HOSTS 保持一致。
# 表会随上游轮换，插件里改了这里也要跟着改（或用 -FrontHostsFile 传入）。
$DefaultFrontHosts = [ordered]@{
    'e-hentai.org'        = @('172.66.132.196', '172.66.140.62')
    'forums.e-hentai.org' = @('172.66.132.196', '172.66.140.62')
    'exhentai.org'        = @(
        '178.175.128.251', '178.175.128.252', '178.175.128.253', '178.175.128.254',
        '178.175.129.251', '178.175.129.252', '178.175.129.253', '178.175.129.254',
        '178.175.132.19', '178.175.132.20', '178.175.132.21', '178.175.132.22'
    )
    'api.e-hentai.org'    = @(
        '37.48.92.161', '212.7.202.51', '5.79.104.110', '37.48.81.204',
        '212.7.200.104', '89.149.222.80', '95.211.79.44'
    )
    'ehgt.org'            = @('185.132.132.79', '185.132.132.76', '62.112.8.152')
    's.exhentai.org'      = @('178.175.132.22', '178.175.129.254', '178.175.128.254')
}

$FrontingMinVersion = '3.0.37'

# ── 前置表 ────────────────────────────────────────────────────────────────

function Read-FrontHosts([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $DefaultFrontHosts }
    if (-not (Test-Path -LiteralPath $path)) {
        throw "FrontHostsFile 不存在: $path"
    }
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $table = [ordered]@{}
    foreach ($prop in $raw.PSObject.Properties) {
        $table[$prop.Name] = @($prop.Value)
    }
    return $table
}

function New-IpHostMap($table) {
    $map = @{}
    foreach ($hostName in $table.Keys) {
        foreach ($ip in $table[$hostName]) {
            if (-not $map.ContainsKey($ip)) { $map[$ip] = $hostName }
        }
    }
    return $map
}

# ── 版本 ──────────────────────────────────────────────────────────────────

function ConvertTo-VersionParts([string]$version) {
    if ([string]::IsNullOrWhiteSpace($version)) { return @(0, 0, 0) }
    $parts = $version.Trim().Split('.')
    $result = @()
    for ($i = 0; $i -lt 3; $i++) {
        $value = 0
        if ($i -lt $parts.Count) { [void][int]::TryParse(($parts[$i] -replace '[^\d].*$', ''), [ref]$value) }
        $result += $value
    }
    return $result
}

function Compare-AppVersion([string]$a, [string]$b) {
    $pa = ConvertTo-VersionParts $a
    $pb = ConvertTo-VersionParts $b
    for ($i = 0; $i -lt 3; $i++) {
        if ($pa[$i] -ne $pb[$i]) { return $pa[$i] - $pb[$i] }
    }
    return 0
}

# ── 连接 ──────────────────────────────────────────────────────────────────

function Get-AppConnections([int]$appPid) {
    Get-NetTCPConnection -OwningProcess $appPid -RemotePort 443 -ErrorAction SilentlyContinue |
        Select-Object RemoteAddress, State
}

function Get-ConnectionKind([string]$ip, $ipToHost) {
    if ($ip -eq '127.0.0.1' -or $ip -eq '::1') {
        return [pscustomobject]@{ Kind = '代理'; Host = '' }
    }
    if ($ipToHost.ContainsKey($ip)) {
        return [pscustomobject]@{ Kind = '前置'; Host = $ipToHost[$ip] }
    }
    return [pscustomobject]@{ Kind = '普通'; Host = '' }
}

function Write-Sample($connections, $ipToHost) {
    if (-not $connections -or $connections.Count -eq 0) {
        Write-Host '  (当前没有 443 连接，翻页 / 搜索 / 阅读时再看)' -ForegroundColor DarkGray
        return
    }

    $rows = foreach ($conn in $connections) {
        $kind = Get-ConnectionKind $conn.RemoteAddress $ipToHost
        [pscustomobject]@{
            RemoteAddress = $conn.RemoteAddress
            State         = $conn.State
            Kind          = $kind.Kind
            Host          = $kind.Host
        }
    }

    $rows | Sort-Object Kind, RemoteAddress -Unique | Format-Table -AutoSize | Out-String | Write-Host
}

# ── 主流程 ────────────────────────────────────────────────────────────────

if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
    Write-Error '需要 PowerShell 5.1+ 的 NetTCPIP 模块（Get-NetTCPConnection）'
    exit 3
}

$frontHosts = Read-FrontHosts $FrontHostsFile
$ipToHost = New-IpHostMap $frontHosts

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Host "没找到进程 '$ProcessName'，先把 Breeze App 启动起来。" -ForegroundColor Yellow
    Write-Host '提示：Windows 构建的可执行文件名是 zephyr.exe（安装后也叫这个名字）。' -ForegroundColor DarkGray
    exit 2
}

$appPath = $proc.Path
$fileVersion = ''
try { $fileVersion = (Get-Item -LiteralPath $appPath).VersionInfo.FileVersion } catch { }
if ([string]::IsNullOrWhiteSpace($fileVersion)) { $fileVersion = 'unknown' }

$gateOpen = (Compare-AppVersion $fileVersion $FrontingMinVersion) -gt 0

Write-Host ''
Write-Host '=== Breeze 域名前置检查 ===' -ForegroundColor Cyan
Write-Host ("进程      : {0} (pid {1})" -f $proc.ProcessName, $proc.Id)
Write-Host ("路径      : {0}" -f $appPath)
Write-Host ("文件版本  : {0}" -f $fileVersion)
Write-Host ("门控      : 需要 > {0} → {1}" -f $FrontingMinVersion, $(if ($gateOpen) { '应显示并可用' } else { '应隐藏（设置页没有「网络」分区）' })) `
    -ForegroundColor $(if ($gateOpen) { 'Green' } else { 'Yellow' })
$totalIps = 0
foreach ($hostName in $frontHosts.Keys) { $totalIps += $frontHosts[$hostName].Count }
Write-Host ("前置表    : {0} 个域名 / {1} 个 IP（去重后 {2} 个）" -f $frontHosts.Count, $totalIps, $ipToHost.Count)
Write-Host ''

$frontHits = @{}
$samples = 0
$deadline = if ($DurationSeconds -gt 0) { (Get-Date).AddSeconds($DurationSeconds) } else { $null }

try {
    do {
        $samples++
        $stamp = (Get-Date).ToString('HH:mm:ss')
        Write-Host ("[{0}] 第 {1} 次采样" -f $stamp, $samples) -ForegroundColor DarkGray

        $connections = Get-AppConnections $proc.Id
        foreach ($conn in $connections) {
            $kind = Get-ConnectionKind $conn.RemoteAddress $ipToHost
            if ($kind.Kind -eq '前置') {
                $key = $kind.Host
                if (-not $frontHits.ContainsKey($key)) { $frontHits[$key] = 0 }
                $frontHits[$key]++
            }
        }
        Write-Sample $connections $ipToHost

        if ($Once) { break }
        if ($deadline -and (Get-Date) -ge $deadline) { break }
        Start-Sleep -Seconds ([Math]::Max(1, $IntervalSeconds))
    } while ($true)
}
finally {
    Write-Host ''
    Write-Host '=== 汇总 ===' -ForegroundColor Cyan
    Write-Host ("采样次数  : {0}" -f $samples)

    if ($frontHits.Count -gt 0) {
        Write-Host '命中前置  :' -ForegroundColor Green
        foreach ($hostName in ($frontHits.Keys | Sort-Object)) {
            Write-Host ("  {0} × {1}" -f $hostName, $frontHits[$hostName]) -ForegroundColor Green
        }
        Write-Host '结论      : 前置已生效 ✅' -ForegroundColor Green
    }
    else {
        Write-Host '命中前置  : 0' -ForegroundColor Yellow
        Write-Host '结论      : 没看到前置连接 ❌' -ForegroundColor Yellow
        Write-Host '排查建议  :' -ForegroundColor DarkGray
        Write-Host '  1. 设置页是否出现「网络」分区（版本必须 > 3.0.37）' -ForegroundColor DarkGray
        Write-Host '  2. 开关是否打开、label 是否显示「生效：N 个域名 / M 个 IP」' -ForegroundColor DarkGray
        Write-Host '  3. 是否开着系统代理（对端会变成 127.0.0.1）' -ForegroundColor DarkGray
        Write-Host '  4. 采样时是否有真实请求（搜索 / 详情 / 阅读）' -ForegroundColor DarkGray
    }
}

if ($frontHits.Count -gt 0) { exit 0 } else { exit 1 }
