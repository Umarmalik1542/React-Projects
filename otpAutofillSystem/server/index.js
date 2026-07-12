// ============================================================================
//  OTP Routing Server  (v4 — routing + client registry/dashboard with login)
// ----------------------------------------------------------------------------
//  Routes an OTP from a phone to the browser waiting for that number, keeps a
//  client registry, and serves a password-protected /clients dashboard where
//  you can see active/inactive clients and remove old ones.
//
//  Runs on 127.0.0.1 only — the public reaches it through nginx (HTTPS/WSS).
// ============================================================================

import http from 'http'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const PORT = process.env.PORT || 5000
const HOST = process.env.HOST || '127.0.0.1'

// ---- SECRETS (edit to your own values) -------------------------------------
const ADMIN_KEY = 'gr-admin-7Kp2Qe9Zx'  // BROWSER extension (waits)
const SEND_KEY = 'gr-send-4Tn8Lm3Vy'    // PHONE app (OTP send + register)
const DASH_PASSWORD = 'greece123'        // /clients dashboard login password
// ----------------------------------------------------------------------------

const WAIT_TTL_MS = 5 * 60 * 1000
const ORPHAN_OTP_TTL_MS = 60 * 1000
const ORPHAN_RACE_GRACE_MS = 10 * 1000
const ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000
const ONLINE_WINDOW_MS = 3 * 60 * 1000   // ~60s heartbeat -> 3 min ke andar = LIVE online

const waits = new Map()
const orphanOtps = new Map()

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLIENTS_FILE = join(__dirname, 'clients.json')
const clients = new Map()
try {
  const data = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'))
  for (const [k, v] of Object.entries(data)) clients.set(k, v)
  console.log(`[clients] loaded ${clients.size}`)
} catch {}

let saveTimer = null
function saveClients() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(CLIENTS_FILE, JSON.stringify(Object.fromEntries(clients))) }
    catch (e) { console.error('[clients] save failed', e.message) }
  }, 1000)
}
const now = () => Date.now()
function touchClient(number, { otp = false, version = null, sms = false, otpFound = null } = {}) {
  if (!number) return
  const c = clients.get(number) || { firstSeen: now(), lastSeen: 0, lastOtpAt: 0, lastSmsAt: 0, version: null }
  c.lastSeen = now()
  if (otp) c.lastOtpAt = now()
  if (sms) { c.lastSmsAt = now(); if (otpFound !== null) c.lastSmsOtp = !!otpFound }
  if (version) c.version = version
  clients.set(number, c)
  saveClients()
}

function normalizeNumber(raw) { return raw ? String(raw).replace(/\D/g, '').slice(-10) : '' }
function extractOtp(raw) {
  if (!raw) return null
  const s = String(raw)
  const m = s.match(/\b(\d{4,8})\b/) || s.match(/(\d{4,8})/)
  return m ? m[1] : null
}

function deliver(number, otp) {
  const wait = waits.get(number)
  if (!wait) return false
  const open = wait.ws && wait.ws.readyState === wait.ws.OPEN
  if (open) wait.ws.send(JSON.stringify({ type: 'otp', number, otp, at: now() }))
  waits.delete(number)
  return open
}
setInterval(() => {
  const t = now()
  for (const [n, w] of waits) if (w.expiresAt <= t) waits.delete(n)
  for (const [n, o] of orphanOtps) if (t - o.at > ORPHAN_OTP_TTL_MS) orphanOtps.delete(n)
}, 10000)

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ---- Phone: OTP ----
function handleOtp(req, res) {
  const data = { ...req.query, ...req.body }
  if (data.key !== SEND_KEY) return res.status(401).json({ ok: false, error: 'Bad key.' })
  const number = normalizeNumber(data.number || data.phone || data.n)
  const otp = extractOtp(data.otp || data.code || data.text || data.message || data.body)
  if (!number) return res.status(400).json({ ok: false, error: 'Missing "number".' })
  if (!otp) return res.status(400).json({ ok: false, error: 'No OTP found.' })
  touchClient(number, { otp: true })
  const delivered = deliver(number, otp)
  if (!delivered) orphanOtps.set(number, { otp, at: now() })
  console.log(`[otp] number=…${number} otp=${otp} delivered=${delivered}`)
  return res.json({ ok: true, number, otp, delivered })
}
app.post('/otp', handleOtp)
app.get('/otp', handleOtp)

// ---- Phone: register / heartbeat ----
function handleRegister(req, res) {
  const data = { ...req.query, ...req.body }
  if (data.key !== SEND_KEY) return res.status(401).json({ ok: false, error: 'Bad key.' })
  const number = normalizeNumber(data.number || data.n)
  if (!number) return res.status(400).json({ ok: false, error: 'Missing "number".' })
  const sms = data.sms === '1' || data.sms === 1 || data.sms === 'true'
  const otpFound = data.otpfound === '1' || data.otpfound === 1 || data.otpfound === 'true'
  touchClient(number, { version: data.ver || null, sms, otpFound: sms ? otpFound : null })
  if (sms) console.log(`[sms-seen] number=…${number} otpFound=${otpFound}`)
  return res.json({ ok: true, number })
}
app.post('/register', handleRegister)
app.get('/register', handleRegister)

// ---- Dashboard (password login) ----
function getCookie(req, name) {
  const h = req.headers.cookie || ''
  for (const part of h.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}
function dashAuthed(req) {
  return getCookie(req, 'otp_dash') === DASH_PASSWORD || req.query.key === ADMIN_KEY
}
function fmtAgo(ts) {
  if (!ts) return 'never'
  const s = Math.floor((now() - ts) / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60); if (m < 60) return m + 'm'
  const h = Math.floor(m / 60); if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd'
}
function fmtTime(ts) { return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '-' }

function loginPage(error) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OTP Dashboard</title>` +
    `<style>body{font:15px system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}` +
    `form{background:#1e293b;padding:28px;border-radius:14px;width:280px}h1{font-size:18px;margin:0 0 16px}` +
    `input{width:100%;padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;margin-bottom:12px;box-sizing:border-box}` +
    `button{width:100%;padding:10px;border:0;border-radius:8px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer}` +
    `.err{color:#ef4444;font-size:13px;margin-bottom:8px}</style></head>` +
    `<body><form method="post"><h1>🔑 OTP Dashboard</h1>${error ? '<div class="err">' + error + '</div>' : ''}` +
    `<input type="password" name="password" placeholder="Password" autofocus><button type="submit">Login</button></form></body></html>`
}

function dashboardPage() {
  const list = [...clients.entries()].map(([num, c]) => ({ num, ...c })).sort((a, b) => b.lastSeen - a.lastSeen)
  const online = list.filter((c) => now() - c.lastSeen <= ONLINE_WINDOW_MS).length
  const active = list.filter((c) => now() - c.lastSeen <= ACTIVE_WINDOW_MS).length
  const rows = list.map((c) => {
    const age = now() - c.lastSeen
    let dot, label, color
    if (age <= ONLINE_WINDOW_MS) { dot = '🟢'; label = 'Online'; color = '#16a34a' }
    else if (age <= ACTIVE_WINDOW_MS) { dot = '🟡'; label = 'Idle'; color = '#eab308' }
    else { dot = '🔴'; label = 'Offline'; color = '#ef4444' }
    const smsCell = c.lastSmsAt
      ? `${fmtAgo(c.lastSmsAt)} ago${c.lastSmsOtp === false ? ' <span style="color:#64748b">(no code)</span>' : ''}`
      : '<span style="color:#ef4444">never</span>'
    return `<tr><td>${c.num}</td><td>${c.version || '-'}</td><td>${fmtTime(c.firstSeen)}</td>` +
      `<td>${fmtAgo(c.lastSeen)} ago</td><td>${smsCell}</td><td>${c.lastOtpAt ? fmtAgo(c.lastOtpAt) + ' ago' : '-'}</td>` +
      `<td style="color:${color}">${dot} ${label}</td>` +
      `<td><a href="?remove=${c.num}" onclick="return confirm('Remove ${c.num}?')" style="color:#f87171;text-decoration:none">✕ remove</a></td></tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="15">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>OTP Clients</title>` +
    `<style>body{font:14px system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:18px}` +
    `h1{font-size:18px;display:inline-block}a.logout{float:right;color:#94a3b8;font-size:13px}` +
    `.pill{font-size:13px;padding:2px 10px;border-radius:20px;margin-left:8px}` +
    `table{border-collapse:collapse;width:100%;margin-top:10px}` +
    `th,td{padding:8px 10px;border-bottom:1px solid #334155;text-align:left;white-space:nowrap}` +
    `th{color:#94a3b8;font-weight:600}.muted{color:#64748b;margin-top:10px}</style></head>` +
    `<body><h1>OTP Clients</h1>` +
    `<span class="pill" style="background:#052e16;color:#4ade80">🟢 ${online} online</span>` +
    `<span class="pill" style="background:#1e293b;color:#94a3b8">${active}/${list.length} active (12h)</span>` +
    `<a class="logout" href="?logout=1">logout</a>` +
    `<table><tr><th>Number</th><th>Ver</th><th>Registered</th><th>Last seen</th><th>Last SMS</th><th>Last OTP</th><th>Status</th><th></th></tr>${rows}</table>` +
    `<p class="muted">Auto-refresh 15s · 🟢 online = last 3 min · 🟡 idle = last 12h · 🔴 offline · <b>Last SMS "never"</b> = phone tak SMS nahi ja raha (receiver fire nahi ho raha) · total ${list.length}</p></body></html>`
}

app.get('/clients', (req, res) => {
  if (req.query.logout) {
    res.setHeader('Set-Cookie', 'otp_dash=; HttpOnly; Path=/; Max-Age=0')
    return res.send(loginPage('Logged out'))
  }
  if (!dashAuthed(req)) return res.send(loginPage(''))
  if (req.query.remove) {
    const num = normalizeNumber(req.query.remove)
    if (num && clients.delete(num)) saveClients()
    return res.redirect('/otp-clients')
  }
  res.type('html').send(dashboardPage())
})

app.post('/clients', (req, res) => {
  if ((req.body.password || '') === DASH_PASSWORD) {
    res.setHeader('Set-Cookie', `otp_dash=${encodeURIComponent(DASH_PASSWORD)}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}`)
    return res.redirect('/otp-clients')
  }
  return res.status(401).send(loginPage('Ghalat password'))
})

app.get('/health', (_req, res) =>
  res.json({ ok: true, waiting: waits.size, orphanOtps: orphanOtps.size, clients: clients.size }),
)
app.get('/', (_req, res) => res.type('text').send('OTP Routing Server running.'))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (ws) => {
  ws.numbers = new Set()
  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg.type === 'wait' && msg.number) {
      if (msg.key !== ADMIN_KEY) { ws.send(JSON.stringify({ type: 'error', error: 'unauthorized' })); return }
      const number = normalizeNumber(msg.number)
      if (!number) return
      waits.set(number, { ws, field: msg.field || null, session: msg.session || null, expiresAt: now() + WAIT_TTL_MS })
      ws.numbers.add(number)
      ws.send(JSON.stringify({ type: 'waiting', number }))
      console.log(`[wait] browser waiting for …${number}`)
      const orphan = orphanOtps.get(number)
      if (orphan) {
        orphanOtps.delete(number)
        if (now() - orphan.at <= ORPHAN_RACE_GRACE_MS) deliver(number, orphan.otp)
      }
    }
    if (msg.type === 'cancel' && msg.number) {
      const number = normalizeNumber(msg.number)
      const w = waits.get(number)
      if (w && w.ws === ws) waits.delete(number)
      ws.numbers.delete(number)
    }
  })
  ws.on('close', () => {
    for (const number of ws.numbers) {
      const w = waits.get(number)
      if (w && w.ws === ws) waits.delete(number)
    }
  })
  ws.send(JSON.stringify({ type: 'hello' }))
})

server.listen(PORT, HOST, () => console.log(`OTP Routing Server listening on http://${HOST}:${PORT}`))
