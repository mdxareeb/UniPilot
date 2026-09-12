param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$Minutes = 30
)

# qa-single-writer — keep one Playwright run alive while it owns the stack.
#
# Why: `npm run test` now owns its dev server (playwright.config.ts `webServer`,
# `reuseExistingServer: false`), and it resets/completes the QA identities and
# mutates their task/event rows. A second suite (or a second agent session, or a
# stray `next dev`) started during a run resets QA state and restarts the server
# under in-flight tests, which surfaces as ECONNRESET / ERR_CONNECTION_REFUSED /
# "browser has been closed" failures that look like flaky specs.
#
# What: for $Minutes, every 2s, terminate any node process that matches a
# Playwright run or dev server UNLESS its ancestor chain reaches $RootPid (the
# run this script was started for). Intermediate cmd.exe shells are handled by
# walking parents by id, not by name.
#
# Usage (start the suite yourself, then point the guard at it):
#   $p = Start-Process npm.cmd -ArgumentList run,test -PassThru
#   powershell -NoProfile -File frontend/scripts/qa-single-writer.ps1 -RootPid $p.Id
#
# The intended mode is still ONE session per working tree; this guard is the
# enforcement for when that trust breaks down, not a licence to share the stack.

$deadline = (Get-Date).AddMinutes($Minutes)

function Test-IsProtected([int]$ProcessId) {
  $cur = $ProcessId
  for ($i = 0; $i -lt 25; $i++) {
    if ($cur -eq $RootPid) { return $true }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    $parent = [int]$proc.ParentProcessId
    if ($parent -le 0 -or $parent -eq $cur) { return $false }
    $cur = $parent
  }
  return $false
}

while ((Get-Date) -lt $deadline) {
  $rootAlive = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
  if (-not $rootAlive) { break }

  $candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.CommandLine -match 'playwright|workerProcessEntry|next\s+dev|start-server' -and
      $_.CommandLine -notmatch 'mcp'
    }

  foreach ($c in $candidates) {
    if (-not (Test-IsProtected -ProcessId ([int]$c.ProcessId))) {
      taskkill /T /F /PID $c.ProcessId 2>$null | Out-Null
    }
  }
  Start-Sleep -Seconds 2
}
