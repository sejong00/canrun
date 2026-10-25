<#
  CanRun 자체 실측 — Ollama 로컬 모델 속도 측정 (P0-5)
  사용법 (PowerShell):
    # 이미 받아 둔 모델만 잰다 (내려받기 없음)
    powershell -ExecutionPolicy Bypass -File scripts\own-bench\ollama-bench.ps1
    # 모델을 골라 잰다 — 없는 모델은 -Pull 을 붙였을 때만 내려받는다
    powershell -ExecutionPolicy Bypass -File scripts\own-bench\ollama-bench.ps1 -Models llama3.1:8b,qwen3:8b -Pull
    # 디스크를 아끼려면 -RemoveAfter: 이번에 내려받은 모델만 재고 나서 바로 지운다(원래 있던 모델은 그대로)
    powershell -ExecutionPolicy Bypass -File scripts\own-bench\ollama-bench.ps1 -Models llama3.1:8b,qwen3:8b -Pull -RemoveAfter
  하는 일:
    - 모델마다 한 번 데워 두고(버림) -Runs 번 잰다. 매번 프롬프트 첫 줄을 바꿔 Ollama 프롬프트 캐시를 피한다.
    - 생성 속도 tg = eval_count / eval_duration, 프롬프트 처리 pp = prompt_eval_count / prompt_eval_duration (Ollama API 응답값).
    - 컨텍스트 8192(사이트 기준), 생각 모드 끔, 출력 최대 256 토큰.
    - 잴 때 그래픽카드에 다 올라갔는지(size_vram / size)를 같이 적는다 — 일부만 올라가면 속도가 크게 달라진다.
    - 모델마다 끝나면 바로 메모리에서 내린다(keep_alive 0). 상시 실행·예약 작업은 만들지 않는다.
  결과: data\own-bench\raw\<날짜시각>\ 에 results.json(측정마다 한 줄) · summary.csv · system.json
#>
param(
  [string[]]$Models = @(),
  [int]$Runs = 3,
  [int]$NumCtx = 8192,
  [int]$NumPredict = 256,
  [switch]$Pull,
  [switch]$RemoveAfter,
  [string]$Url = 'http://127.0.0.1:11434'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $root "data\own-bench\raw\$stamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Api($path, $body, [int]$timeoutSec = 900) {
  $json = if ($body) { $body | ConvertTo-Json -Depth 8 -Compress } else { $null }
  if ($json) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri "$Url$path" -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec $timeoutSec
  }
  return Invoke-RestMethod -Uri "$Url$path" -Method Get -TimeoutSec 60
}

try { $ver = (Api '/api/version' $null).version } catch { Write-Host 'Ollama 서버에 연결하지 못했습니다. Ollama 를 켠 뒤 다시 실행하세요.' -ForegroundColor Red; exit 1 }

# --- 시스템 정보 (이름·용량만 — 개인정보 없음)
$gpu = (& nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>$null) -join '; '
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1e9, 1)
$sys = [ordered]@{ date = (Get-Date).ToString('s'); ollama = $ver; gpu = $gpu; cpu = $cpu; ramGB = $ramGB; numCtx = $NumCtx; numPredict = $NumPredict; runs = $Runs; os = [Environment]::OSVersion.VersionString }
$sys | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $outDir 'system.json')
Write-Host "Ollama $ver · $gpu · RAM ${ramGB}GB · 결과 폴더 $outDir"

$installed = @((Api '/api/tags' $null).models)
# -File 로 실행하면 'a,b' 가 문자열 하나로 들어온다 — 쉼표로 나눈다
$Models = @($Models | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Models.Count -eq 0) { $Models = $installed | ForEach-Object { $_.name } }
if ($Models.Count -eq 0) { Write-Host '받아 둔 모델이 없습니다. -Models 와 -Pull 로 모델을 정하세요.'; exit 0 }

$base = 'You are helping a reader understand how local language models use GPU memory. ' * 24  # 약 400~500 토큰
$prompt = "Explain in plain words, in about two paragraphs, why the memory bandwidth of a graphics card limits how fast a local language model can generate text."
$results = @()

foreach ($m in $Models) {
  $have = $installed | Where-Object { $_.name -eq $m -or $_.name -eq "${m}:latest" }
  $pulledNow = $false
  if (-not $have) {
    if (-not $Pull) { Write-Host "건너뜀: $m (받아 두지 않음 — 받으려면 -Pull)" -ForegroundColor Yellow; continue }
    Write-Host "내려받는 중: $m ..."
    Api '/api/pull' @{ model = $m; stream = $false } 7200 | Out-Null
    $installed = @((Api '/api/tags' $null).models)
    $have = $installed | Where-Object { $_.name -eq $m -or $_.name -eq "${m}:latest" }
    $pulledNow = $true
  }
  $show = Api '/api/show' @{ model = $m }
  $det = $show.details
  Write-Host "측정: $m ($($det.parameter_size) · $($det.quantization_level))"
  $opts = @{ num_ctx = $NumCtx; num_predict = $NumPredict; temperature = 0 }
  # 데우기 (버림)
  Api '/api/generate' @{ model = $m; prompt = "warm-up`n$prompt"; stream = $false; think = $false; options = $opts; keep_alive = '5m' } | Out-Null
  $ps = @((Api '/api/ps' $null).models) | Where-Object { $_.name -eq $have.name } | Select-Object -First 1
  $gpuShare = if ($ps -and $ps.size -gt 0) { [math]::Round($ps.size_vram / $ps.size, 3) } else { $null }
  for ($i = 1; $i -le $Runs; $i++) {
    $r = Api '/api/generate' @{ model = $m; prompt = "Run $i of $stamp. $base`n$prompt"; stream = $false; think = $false; options = $opts; keep_alive = '5m' }
    $tg = if ($r.eval_duration -gt 0) { [math]::Round($r.eval_count / ($r.eval_duration / 1e9), 2) } else { $null }
    $pp = if ($r.prompt_eval_duration -gt 0) { [math]::Round($r.prompt_eval_count / ($r.prompt_eval_duration / 1e9), 2) } else { $null }
    $row = [ordered]@{
      model = $have.name; digest = $have.digest; sizeBytes = $have.size; family = $det.family; parameterSize = $det.parameter_size
      quant = $det.quantization_level; format = $det.format; run = $i; numCtx = $NumCtx
      promptTokens = $r.prompt_eval_count; genTokens = $r.eval_count; ppTokS = $pp; tgTokS = $tg
      loadMs = [math]::Round($r.load_duration / 1e6); gpuShare = $gpuShare; ollama = $ver
    }
    $results += [pscustomobject]$row
    ($row | ConvertTo-Json -Compress) | Add-Content -Encoding UTF8 (Join-Path $outDir 'results.json')
    Write-Host ("  {0}회: 생성 {1} tok/s · 프롬프트 {2} tok/s ({3} 토큰) · GPU 몫 {4}" -f $i, $tg, $pp, $r.prompt_eval_count, $gpuShare)
  }
  # 바로 내리기
  Api '/api/generate' @{ model = $m; keep_alive = 0 } | Out-Null
  if ($RemoveAfter -and $pulledNow) {
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ model = $have.name } | ConvertTo-Json -Compress))
    Invoke-RestMethod -Uri "$Url/api/delete" -Method Delete -Body $bytes -ContentType 'application/json; charset=utf-8' | Out-Null
    Write-Host "  지움: $($have.name) (이번에 받은 모델)"
  }
}

$results | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path $outDir 'summary.csv')
$left = @((Api '/api/ps' $null).models)
if ($left.Count -eq 0) { Write-Host '끝 — 메모리에 남은 모델 없음.' -ForegroundColor Green }
else { Write-Host ('끝 — 아직 올라가 있는 모델: ' + (($left | ForEach-Object { $_.name }) -join ', ') + ' (다른 프로그램이 쓰는 중일 수 있음)') -ForegroundColor Yellow }
Write-Host "결과: $outDir"
