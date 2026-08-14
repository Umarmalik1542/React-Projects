# Deployment — OTP system on the VPS (greeceserver.com)

Live setup notes. The routing server runs on a Windows VPS, behind the
existing nginx, and is reachable over HTTPS/WSS.

## Pieces

| Part | Where | Detail |
|------|-------|--------|
| Routing server | VPS `C:\Users\Administrator\Desktop\otp-server` | Node, listens on `127.0.0.1:5000` |
| Reverse proxy | nginx `C:\nginx\nginx-1.29.8` | Adds `/otp-send` + `/otp-ws` to `greeceserver.com` |
| Auto-start | Windows Task Scheduler task `OtpServer` | runs as SYSTEM, at startup, restarts on crash |

## Public endpoints
- Phone OTP → `POST/GET https://greeceserver.com/otp-send?key=<SEND_KEY>&number=<num>&text=<sms>`
- Phone register/heartbeat → `https://greeceserver.com/otp-register?key=<SEND_KEY>&number=<num>&ver=<v>`
- Browser extension → `wss://greeceserver.com/otp-ws` (sends `key=<ADMIN_KEY>`)
- Clients dashboard → `https://greeceserver.com/otp-clients` (password login)

nginx needs all four locations: `/otp-ws`, `/otp-send`, `/otp-register`, `/otp-clients`
(each `proxy_pass http://127.0.0.1:5000/<ws|otp|register|clients>`).

## Clients dashboard
- Open `https://greeceserver.com/otp-clients` → enter `DASH_PASSWORD` (cookie-remembered 30d).
- Columns: number, ver, **SMS / Notif / Batt** (each setting ✓/✗), last seen, Last SMS, Last OTP, Status.
- Status (truthful — app v2.2+ reports each setting every ~60s heartbeat):
  - 🟢 **Online** = connected **and** ready (SMS permission on + number set).
  - 🟡 **Setup: …** = app alive but a required setting is missing (shows which).
  - 🔴 **Offline** = not reachable (app dead / no net).
  - **Last SMS "never"** = SMS not reaching the app (OEM block / receiver not firing).
  - (Old apps < v2.2 don't report settings → fall back to Online when connected.)
- OTP hold: server keeps the **latest** OTP per number for **5 min**, so the browser gets it
  whether it starts waiting before or up to 5 min after the OTP arrives; a newer OTP replaces the old.
- Header shows the online (ready) count; auto-refreshes every 20s. Per-row `✕` removes an entry.
- Registry persists to `clients.json`.

## Approval (allowlist) — app v2.3+
- Clients enter **name + number**; the dashboard shows both.
- New clients land in **⏳ Pending** with ✓ Approve / ✗ Reject buttons; approved ones move to
  the main **✅ Approved** table, rejected to a collapsed list.
- **Gating**: the server only routes OTPs for **approved** numbers — pending/rejected are dropped,
  so junk registrations can't be used and stay out of the way.
- **Pre-approve**: add a number under "➕ Pre-approve (allowlist)" and any current/future client
  with that number auto-approves. Allowlist persists to `allowlist.json`.
- Existing clients from before this feature are grandfathered as approved (nothing breaks).
- The app shows its own state: ⏳ Approval pending / ✅ Approved / 🚫 Rejected.

## Keys / password (in `index.js`)
- `ADMIN_KEY` — browser extension (waits) + legacy `?key=` dashboard access. Keep private.
- `SEND_KEY` — phone app (OTP send + register).
- `DASH_PASSWORD` — dashboard login (default `greece123` — change it).
- Change to your own values; restart the service after editing.

## App auto-update
- The workflow publishes `version.txt` (latest `versionCode`) next to `OtpForwarder.apk`
  on the `otp-app` release.
- The app checks `version.txt` on open / via "Check for Update"; if newer it downloads
  the APK and launches the installer. First install of an updater-capable build is manual;
  later updates are one-tap.

## nginx — added inside the `listen 443 ssl` server block
```nginx
location /otp-ws {
    proxy_pass http://127.0.0.1:5000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
location /otp-send {
    proxy_pass http://127.0.0.1:5000/otp;
    proxy_set_header Host $host;
}
```
Apply: `cd C:\nginx\nginx-1.29.8 ; .\nginx.exe -t ; .\nginx.exe -s reload`
(If a stale worker keeps the old config: `Stop-Process -Name nginx -Force` then `Start-Process .\nginx.exe`.)

## Auto-start service (Task Scheduler)
```powershell
$node = "C:\Program Files\nodejs\node.exe"
$dir  = "C:\Users\Administrator\Desktop\otp-server"
$action    = New-ScheduledTaskAction -Execute $node -Argument "index.js" -WorkingDirectory $dir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "OtpServer" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
Start-ScheduledTask -TaskName "OtpServer"
```

### Manage the service
```powershell
Start-ScheduledTask  -TaskName OtpServer    # start
Stop-ScheduledTask   -TaskName OtpServer    # stop
Get-ScheduledTask    -TaskName OtpServer | Get-ScheduledTaskInfo   # status
```

### Update the server code later
1. Edit `C:\Users\Administrator\Desktop\otp-server\index.js`
2. Restart: `Stop-ScheduledTask -TaskName OtpServer; Start-Sleep 2; Start-ScheduledTask -TaskName OtpServer`
3. (If a node lingered: `Stop-Process -Name node -Force` before starting.)

## Health checks
```powershell
Invoke-RestMethod "http://127.0.0.1:5000/health"
Invoke-RestMethod "https://greeceserver.com/otp-send?number=3001234567&text=code558931&key=<SEND_KEY>"
```
