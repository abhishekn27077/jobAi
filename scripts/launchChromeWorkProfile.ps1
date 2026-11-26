# CareerOS — Launch Chrome "Abhishek • Work" (Profile 21) with CDP Debugging
# Enables CareerOS Playwright Form Assistant & Antigravity to attach directly
# to your already-logged-in LinkedIn, Naukri, and Indeed Chrome session.

$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromeExe) {
  Write-Error "Google Chrome executable not found."
  exit 1
}

$userDataDir = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
Write-Host "Launching Chrome Profile 21 (Abhishek • Work / abhishekn27123@gmail.com) with CDP on 127.0.0.1:9222..."
Start-Process -FilePath $chromeExe -ArgumentList @(
  "--user-data-dir=`"$userDataDir`"",
  "--profile-directory=`"Profile 21`"",
  "--remote-debugging-port=9222"
)
