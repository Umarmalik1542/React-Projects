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
// OTP ko 5 min tak hold karo: browser pehle wait kare ya OTP ke baad kabhi kare,
// dono soorat mein latest OTP mil jaye. (Naya OTP purane ko replace kar deta hai.)
const ORPHAN_OTP_TTL_MS = 5 * 60 * 1000
const ORPHAN_RACE_GRACE_MS = 5 * 60 * 1000
const ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000
const ONLINE_WINDOW_MS = 3 * 60 * 1000   // ~60s heartbeat -> 3 min ke andar = LIVE online

const waits = new Map()
const orphanOtps = new Map()

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLIENTS_FILE = join(__dirname, 'clients.json')
const clients = new Map()
try {
  const data = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'))
  for (const [k, v] of Object.entries(data)) {
    if (v.approved === undefined) v.approved = 'approved' // grandfather existing clients (na toote)
    clients.set(k, v)
  }
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

// ---- Approval allowlist (pre-approved numbers -> auto-approve on register) ----
const ALLOW_FILE = join(__dirname, 'allowlist.json')
const allowlist = new Set()
try { for (const n of JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8'))) allowlist.add(n) } catch {}
function saveAllow() {
  try { fs.writeFileSync(ALLOW_FILE, JSON.stringify([...allowlist])) }
  catch (e) { console.error('[allow] save failed', e.message) }
}
function isApproved(number) {
  const c = clients.get(number)
  return !!c && c.approved === 'approved'
}

const now = () => Date.now()
function touchClient(number, { otp = false, version = null, smsSeen = false, otpFound = null, flags = null, name = null } = {}) {
  if (!number) return
  const isNew = !clients.has(number)
  const c = clients.get(number) || { firstSeen: now(), lastSeen: 0, lastOtpAt: 0, lastSmsAt: 0, version: null }
  if (isNew) c.approved = allowlist.has(number) ? 'approved' : 'pending'
  // pending client agar allowlist me aa gaya -> auto approve (manual reject ko override nahi karta)
  if (c.approved === 'pending' && allowlist.has(number)) c.approved = 'approved'
  c.lastSeen = now()
  if (otp) c.lastOtpAt = now()
  if (smsSeen) { c.lastSmsAt = now(); if (otpFound !== null) c.lastSmsOtp = !!otpFound }
  if (version) c.version = version
  if (name) c.name = name
  if (flags) {
    if (flags.sms   !== undefined) c.sms    = flags.sms   // SMS permission on?
    if (flags.notif !== undefined) c.notif  = flags.notif // notifications on?
    if (flags.batt  !== undefined) c.batt   = flags.batt  // battery unrestricted?
    if (flags.num   !== undefined) c.numSet = flags.num   // number set? (NOT 'num' — collides with phone-number key)
    delete c.num                                          // purani buggy value saaf karo
  }
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
  // GATING: sirf approved clients ke OTP route hote hain
  if (!isApproved(number)) {
    console.log(`[otp] number=…${number} otp=${otp} DROPPED (not approved)`)
    return res.json({ ok: true, number, delivered: false, approved: false })
  }
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
  const truthy = (v) => v === '1' || v === 1 || v === 'true'
  const smsSeen = truthy(data.smsseen)                 // an SMS reached the app (diagnostic)
  const otpFound = truthy(data.otpfound)
  const flags = {}                                     // readiness (heartbeat)
  if (data.sms   !== undefined) flags.sms   = truthy(data.sms)
  if (data.notif !== undefined) flags.notif = truthy(data.notif)
  if (data.batt  !== undefined) flags.batt  = truthy(data.batt)
  if (data.num   !== undefined) flags.num   = truthy(data.num)
  const name = data.name ? String(data.name).trim().slice(0, 40) : null
  touchClient(number, {
    version: data.ver || null,
    smsSeen, otpFound: smsSeen ? otpFound : null,
    flags: Object.keys(flags).length ? flags : null,
    name,
  })
  if (smsSeen) console.log(`[sms-seen] number=…${number} otpFound=${otpFound}`)
  const c = clients.get(number)
  return res.json({ ok: true, number, approved: c ? c.approved : 'pending' })
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

const tick = (v) => v === undefined ? '<span style="color:#64748b">–</span>'
  : (v ? '<span style="color:#16a34a">✓</span>' : '<span style="color:#ef4444">✗</span>')
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
  (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

function statusOf(c) {
  const connected = now() - c.lastSeen <= ONLINE_WINDOW_MS
  const ready = c.sms !== undefined ? c.sms === true : true
  if (connected && ready) return { dot: '🟢', label: 'Online', color: '#16a34a' }
  if (connected) {
    const miss = []
    if (c.numSet === false) miss.push('number')
    if (c.sms === false) miss.push('SMS')
    return { dot: '🟡', label: 'Setup: ' + (miss.join(', ') || 'settings'), color: '#eab308' }
  }
  return { dot: '🔴', label: 'Offline', color: '#ef4444' }
}
const smsCellOf = (c) => c.lastSmsAt
  ? `${fmtAgo(c.lastSmsAt)} ago${c.lastSmsOtp === false ? ' <span style="color:#64748b">(no code)</span>' : ''}`
  : '<span style="color:#ef4444">never</span>'

function dashboardPage() {
  const list = [...clients.entries()].map(([num, c]) => ({ ...c, num })).sort((a, b) => b.lastSeen - a.lastSeen)
  const approvedL = list.filter((c) => c.approved === 'approved')
  const pendingL = list.filter((c) => c.approved === 'pending')
  const rejectedL = list.filter((c) => c.approved === 'rejected')
  const online = approvedL.filter((c) => statusOf(c).dot === '🟢').length

  // ---- Pending review section ----
  const pendingRows = pendingL.map((c) =>
    `<tr><td>${esc(c.name) || '<span style="color:#64748b">—</span>'}</td><td>${c.num}</td><td>${c.version || '-'}</td>` +
    `<td>${fmtAgo(c.lastSeen)} ago</td>` +
    `<td><a class="btn ok" href="?approve=${c.num}">✓ Approve</a> ` +
    `<a class="btn no" href="?reject=${c.num}">✗ Reject</a></td></tr>`).join('')
  const pendingBlock = pendingL.length
    ? `<h2>⏳ Pending review (${pendingL.length})</h2>` +
      `<table><tr><th>Name</th><th>Number</th><th>Ver</th><th>Last seen</th><th>Action</th></tr>${pendingRows}</table>`
    : ''

  // ---- Approved (main) section ----
  const approvedRows = approvedL.map((c) => {
    const st = statusOf(c)
    return `<tr><td>${esc(c.name) || '<span style="color:#64748b">—</span>'}</td><td>${c.num}</td><td>${c.version || '-'}</td>` +
      `<td style="text-align:center">${tick(c.sms)}</td>` +
      `<td style="text-align:center">${tick(c.notif)}</td>` +
      `<td style="text-align:center">${tick(c.batt)}</td>` +
      `<td>${fmtAgo(c.lastSeen)} ago</td><td>${smsCellOf(c)}</td>` +
      `<td>${c.lastOtpAt ? fmtAgo(c.lastOtpAt) + ' ago' : '-'}</td>` +
      `<td style="color:${st.color}">${st.dot} ${st.label}</td>` +
      `<td><a class="btn no" href="?reject=${c.num}">reject</a> ` +
      `<a href="?remove=${c.num}" onclick="return confirm('Remove ${c.num}?')" style="color:#f87171;text-decoration:none">✕</a></td></tr>`
  }).join('')

  // ---- Rejected (collapsed) ----
  const rejectedRows = rejectedL.map((c) =>
    `<tr><td>${esc(c.name) || '—'}</td><td>${c.num}</td>` +
    `<td><a class="btn ok" href="?approve=${c.num}">approve</a> ` +
    `<a href="?remove=${c.num}" onclick="return confirm('Remove ${c.num}?')" style="color:#f87171;text-decoration:none">✕</a></td></tr>`).join('')
  const rejectedBlock = rejectedL.length
    ? `<details style="margin-top:14px"><summary style="cursor:pointer;color:#94a3b8">🚫 Rejected (${rejectedL.length})</summary>` +
      `<table><tr><th>Name</th><th>Number</th><th>Action</th></tr>${rejectedRows}</table></details>`
    : ''

  // ---- Allowlist (pre-approve) ----
  const allowChips = [...allowlist].map((n) =>
    `<span class="chip">${n} <a href="?unallow=${n}" style="color:#f87171;text-decoration:none">✕</a></span>`).join(' ') || '<span style="color:#64748b">koi nahi</span>'

  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="20">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>OTP Clients</title>` +
    `<style>body{font:14px system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:18px}` +
    `h1{font-size:18px;display:inline-block}h2{font-size:15px;margin:20px 0 4px}a.logout{float:right;color:#94a3b8;font-size:13px}` +
    `.pill{font-size:13px;padding:2px 10px;border-radius:20px;margin-left:8px}` +
    `table{border-collapse:collapse;width:100%;margin-top:8px}` +
    `th,td{padding:8px 10px;border-bottom:1px solid #334155;text-align:left;white-space:nowrap}` +
    `th{color:#94a3b8;font-weight:600}.muted{color:#64748b;margin-top:10px}` +
    `.btn{display:inline-block;padding:3px 9px;border-radius:6px;text-decoration:none;font-size:12px}` +
    `.btn.ok{background:#052e16;color:#4ade80}.btn.no{background:#3f1d1d;color:#f87171}` +
    `.chip{background:#1e293b;padding:3px 8px;border-radius:14px;font-size:12px;margin-right:4px}` +
    `form.allow{margin:8px 0}form.allow input{padding:7px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0}` +
    `form.allow button{padding:7px 12px;border:0;border-radius:6px;background:#6366f1;color:#fff;cursor:pointer}</style></head>` +
    `<body><h1>OTP Clients</h1>` +
    `<span class="pill" style="background:#052e16;color:#4ade80">🟢 ${online} online</span>` +
    `<span class="pill" style="background:#1e293b;color:#94a3b8">${approvedL.length} approved · ${pendingL.length} pending</span>` +
    `<a class="logout" href="?logout=1">logout</a>` +
    pendingBlock +
    `<h2>✅ Approved (${approvedL.length})</h2>` +
    `<table><tr><th>Name</th><th>Number</th><th>Ver</th><th>SMS</th><th>Notif</th><th>Batt</th><th>Last seen</th><th>Last SMS</th><th>Last OTP</th><th>Status</th><th></th></tr>${approvedRows}</table>` +
    rejectedBlock +
    `<h2>➕ Pre-approve (allowlist)</h2>` +
    `<form class="allow" method="get" action="/otp-clients"><input name="allow" placeholder="Number pehle se approve (e.g. 03001234567)"> <button>Add</button></form>` +
    `<div>${allowChips}</div>` +
    `<p class="muted">Auto-refresh 20s · 🟢 Online = connected + SMS on · 🟡 Setup = setting missing · 🔴 Offline · Sirf <b>Approved</b> ke OTP route hote hain · Allowlist number auto-approve karta hai.</p></body></html>`
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
  // Approve / Reject / re-Pending a client
  for (const [q, status] of [['approve', 'approved'], ['reject', 'rejected'], ['pending', 'pending']]) {
    if (req.query[q]) {
      const num = normalizeNumber(req.query[q])
      const c = clients.get(num)
      if (c) { c.approved = status; saveClients() }
      return res.redirect('/otp-clients')
    }
  }
  // Pre-approve allowlist: add a number (auto-approves current + future client)
  if (req.query.allow) {
    const num = normalizeNumber(req.query.allow)
    if (num) {
      allowlist.add(num); saveAllow()
      const c = clients.get(num)
      if (c && c.approved !== 'approved') { c.approved = 'approved'; saveClients() }
    }
    return res.redirect('/otp-clients')
  }
  if (req.query.unallow) {
    const num = normalizeNumber(req.query.unallow)
    if (num && allowlist.delete(num)) saveAllow()
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
