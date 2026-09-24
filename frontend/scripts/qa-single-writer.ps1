param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$Minutes = 30,
  [switch]$Kill
)

# qa-single-writer — report competing Playwright/dev-server processes while a
# suite owns the stack (termination is opt-in).
#
# Why: `npm run test` now owns its dev server (playwright.config.ts `webServer`,
# `reuseExistingServer: false`), and it resets/completes the QA identities and
# mutates their task/event rows. A second suite (or a second agent session, or a
# stray `next dev`) started during a run resets QA state and restarts the server
# under in-flight tests, which surfaces as ECONNRESET / ERR_CONNECTION_REFUSED /
# "browser has been closed" failures that look like flaky specs.
#
# Why termination is opt-in: this guard used to `taskkill /T /F` every node
# process matching `playwright|workerProcessEntry|next dev|start-server` whose
# ancestor chain did not reach `-RootPid`. That ancestry test cannot prove
# ownership when the root pid is stale, when the run was started detached from
# the shell that holds the guard (for example a `Start-Process` run in another
# session), or when a guard left over from an earlier run overlaps a new one —
# and in those cases it terminates the run it was meant to protect, including
# that run's own webServer and workers. Without `-Kill` this script only
# reports; the one-writer rule itself is a process discipline, not a SIGKILL.
#
# Usage (report-only, the safe default):
#   $p = Start-Process npm.cmd -ArgumentList run,test -PassThru
#   powershell -NoProfile -File frontend/scripts/qa-single-writer.ps1 -RootPid $p.Id
#
# `-Kill` restores the old terminating behaviour. Use it only when the RootPid
# you pass is guaranteed to be the ancestor of the run you are protecting and no
# other session can be mid-run: a mis-scoped RootPid can kill an unrelated
# run's servers.

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

$reported = @{}

while ((Get-Date) -lt $deadline) {
  $rootAlive = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
  if (-not $rootAlive) { break }

  $candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.CommandLine -match 'playwright|workerProcessEntry|next\s+dev|start-server' -and
      $_.CommandLine -notmatch 'mcp'
    }

  foreach ($c in $candidates) {
    if (Test-IsProtected -ProcessId ([int]$c.ProcessId)) { continue }
    if ($Kill) {
      taskkill /T /F /PID $c.ProcessId 2>$null | Out-Null
      continue
    }
    $id = [int]$c.ProcessId
    if (-not $reported.ContainsKey($id)) {
      $reported[$id] = $true
      $snippet = [string]$c.CommandLine
      if ($snippet.Length -gt 160) { $snippet = $snippet.Substring(0, 160) }
      Write-Warning "qa-single-writer: competing process pid=$id (report only; pass -Kill to terminate): $snippet"
    }
  }
  Start-Sleep -Seconds 2
}
