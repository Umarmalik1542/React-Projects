// ============================================================================
//  OTP Routing Server  (v3 — routing + client registry/dashboard)
// ----------------------------------------------------------------------------
//  An OTP arrives from a PHONE (with its number). A BROWSER is waiting for the
//  OTP of that same number. This server matches them by phone number and
//  instantly pushes the OTP to the right browser.
//
//  Also keeps a registry of client phones (who registered, last seen, last OTP)
//  and serves a /clients dashboard so you can see active/inactive clients.
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

// ---- SECRET KEYS (edit these to your own random values) --------------------
const ADMIN_KEY = 'gr-admin-7Kp2Qe9Zx'  // BROWSER extension + /clients dashboard
const SEND_KEY = 'gr-send-4Tn8Lm3Vy'    // PHONE app (OTP send + register)
// ----------------------------------------------------------------------------

const WAIT_TTL_MS = 5 * 60 * 1000
const ORPHAN_OTP_TTL_MS = 60 * 1000
const ORPHAN_RACE_GRACE_MS = 10 * 1000
// Client ko "active" tab tak samjho jab tak is window ke andar dikha ho.
const ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000 // 12 hours

const waits = new Map()        // number -> { ws, field, expiresAt, ... }
const orphanOtps = new Map()   // number -> { otp, at }

// --- Client registry (persisted to clients.json) ----------------------------
const __dirname = dirname(fileURLToPath(import.meta.url))
const CLIENTS_FILE = join(__dirname, 'clients.json')
const clients = new Map()      // number -> { firstSeen, lastSeen, lastOtpAt, version }

try {
  const data = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'))
  for (const [k, v] of Object.entries(data)) clients.set(k, v)
  console.log(`[clients] loaded ${clients.size} from disk`)
} catch { /* pehli baar koi file nahi */ }

let saveTimer = null
function saveClients() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(CLIENTS_FILE, JSON.stringify(Object.fromEntries(clients))) }
    catch (e) { console.error('[clients] save failed', e.message) }
  }, 1000)
}
function touchClient(number, { otp = false, version = null } = {}) {
  if (!number) return
  const c = clients.get(number) || { firstSeen: now(), lastSeen: 0, lastOtpAt: 0, version: null }
  c.lastSeen = now()
  if (otp) c.lastOtpAt = now()
  if (version) c.version = version
  clients.set(number, c)
  saveClients()
}

// --- Helpers ----------------------------------------------------------------
function normalizeNumber(raw) {
  if (!raw) return ''
  return String(raw).replace(/\D/g, '').slice(-10)
}
function extractOtp(raw) {
  if (!raw) return null
  const s = String(raw)
  const m = s.match(/\b(\d{4,8})\b/) || s.match(/(\d{4,8})/)
  return m ? m[1] : null
}
const now = () => Date.now()

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

// --- HTTP API ---------------------------------------------------------------
const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// PHONE app posts the OTP here.
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

// PHONE app registers / heartbeats here.
function handleRegister(req, res) {
  const data = { ...req.query, ...req.body }
  if (data.key !== SEND_KEY) return res.status(401).json({ ok: false, error: 'Bad key.' })
  const number = normalizeNumber(data.number || data.n)
  if (!number) return res.status(400).json({ ok: false, error: 'Missing "number".' })
  touchClient(number, { version: data.ver || null })
  console.log(`[register] …${number} v${data.ver || '?'}`)
  return res.json({ ok: true, number })
}
app.post('/register', handleRegister)
app.get('/register', handleRegister)

// Dashboard (ADMIN_KEY se protected).
function fmtAgo(ts) {
  if (!ts) return 'never'
  const s = Math.floor((now() - ts) / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60); if (m < 60) return m + 'm'
  const h = Math.floor(m / 60); if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd'
}
function fmtTime(ts) {
  return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '-'
}
app.get('/clients', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).send('Unauthorized — add ?key=ADMIN_KEY')
  const list = [...clients.entries()].map(([num, c]) => ({ num, ...c })).sort((a, b) => b.lastSeen - a.lastSeen)
  const active = list.filter((c) => now() - c.lastSeen <= ACTIVE_WINDOW_MS).length
  const rows = list.map((c) => {
    const ok = now() - c.lastSeen <= ACTIVE_WINDOW_MS
    return `<tr><td>${c.num}</td><td>${fmtTime(c.firstSeen)}</td><td>${fmtAgo(c.lastSeen)} ago</td>` +
      `<td>${c.lastOtpAt ? fmtAgo(c.lastOtpAt) + ' ago' : '-'}</td>` +
      `<td style="color:${ok ? '#16a34a' : '#ef4444'}">${ok ? '🟢 Active' : '🔴 Inactive'}</td></tr>`
  }).join('')
  res.type('html').send(
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>OTP Clients</title>` +
    `<style>body{font:14px system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:18px}` +
    `h1{font-size:18px}table{border-collapse:collapse;width:100%;margin-top:10px}` +
    `th,td{padding:8px 10px;border-bottom:1px solid #334155;text-align:left;white-space:nowrap}` +
    `th{color:#94a3b8;font-weight:600}tr:hover td{background:#1e293b}.muted{color:#64748b;margin-top:10px}</style></head>` +
    `<body><h1>OTP Clients — ${active}/${list.length} active</h1>` +
    `<table><tr><th>Number</th><th>Registered</th><th>Last seen</th><th>Last OTP</th><th>Status</th></tr>${rows}</table>` +
    `<p class="muted">Auto-refresh 30s · active = last 12h · total ${list.length}</p></body></html>`
  )
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
        else console.log(`[wait] discarded stale OTP for …${number}`)
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
