param([string]$Device = 'tv')

$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageVersion = (Get-Content -LiteralPath (Join-Path $project 'app\appinfo.json') -Raw | ConvertFrom-Json).version
$packagePath = Join-Path $project ("dist\com.personal.iyftv_{0}_all.ipk" -f $packageVersion)
$installCli = Join-Path $project 'node_modules\.bin\ares-install.cmd'
$launchCli = Join-Path $project 'node_modules\.bin\ares-launch.cmd'

if (-not (Test-Path -LiteralPath $installCli)) {
  throw '请先在项目根目录运行 npm ci。'
}

Push-Location $project
try {
  npm run package
  if ($LASTEXITCODE -ne 0) { throw '打包失败。' }
  if (-not (Test-Path -LiteralPath $packagePath)) { throw "找不到安装包：$packagePath" }

  & $installCli --device $Device $packagePath
  if ($LASTEXITCODE -ne 0) { throw '安装失败。请检查 Developer Mode、Key Server 和设备配对。' }

  & $launchCli --device $Device com.personal.iyftv
  if ($LASTEXITCODE -ne 0) { throw '安装成功，但启动失败。' }
} finally {
  Pop-Location
}
