// ============================================================================
//  OTP Routing Server  (v2 — behind nginx, internet-facing)
// ----------------------------------------------------------------------------
//  An OTP arrives from a PHONE (with its number). A BROWSER is waiting for the
//  OTP of that same number. This server matches them by phone number and
//  instantly pushes the OTP to the right browser.
//
//  Rules:  key = phone number (last 10 digits) · 1 number = 1 browser ·
//          each wait is short-lived (TTL) and consumed on delivery ·
//          latest wait wins · early OTPs held briefly for a late wait.
//
//  Runs on 127.0.0.1 only — the public reaches it through nginx (HTTPS/WSS).
// ============================================================================

import http from 'http'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT || 5000
const HOST = process.env.HOST || '127.0.0.1' // sirf nginx ke liye (internet se direct nahi)

// ---- SECRET KEYS (edit these to your own random values) --------------------
const ADMIN_KEY = 'gr-admin-7Kp2Qe9Zx'  // sirf BROWSER extension ke paas (waits + OTP receive)
const SEND_KEY = 'gr-send-4Tn8Lm3Vy'    // PHONE app ke paas (OTP bhejne ke liye)
// ----------------------------------------------------------------------------

const WAIT_TTL_MS = 5 * 60 * 1000
const ORPHAN_OTP_TTL_MS = 60 * 1000
// Jab browser "wait" register kare, sirf is choti window ke andar aaya orphan OTP
// deliver hoga (natural race ke liye). Is se purana wala accept deliver na ho.
const ORPHAN_RACE_GRACE_MS = 10 * 1000

const waits = new Map()        // number -> { ws, field, expiresAt, ... }
const orphanOtps = new Map()   // number -> { otp, at }

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

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// PHONE app posts the OTP here.  Needs the SEND_KEY.
function handleOtp(req, res) {
  const data = { ...req.query, ...req.body }
  if (data.key !== SEND_KEY) return res.status(401).json({ ok: false, error: 'Bad key.' })
  const number = normalizeNumber(data.number || data.phone || data.n)
  const otp = extractOtp(data.otp || data.code || data.text || data.message || data.body)
  if (!number) return res.status(400).json({ ok: false, error: 'Missing "number".' })
  if (!otp) return res.status(400).json({ ok: false, error: 'No OTP found.' })
  const delivered = deliver(number, otp)
  if (!delivered) orphanOtps.set(number, { otp, at: now() })
  console.log(`[otp] number=…${number} otp=${otp} delivered=${delivered}`)
  return res.json({ ok: true, number, otp, delivered })
}
app.post('/otp', handleOtp)
app.get('/otp', handleOtp)

app.get('/health', (_req, res) =>
  res.json({ ok: true, waiting: waits.size, orphanOtps: orphanOtps.size }),
)
app.get('/', (_req, res) => res.type('text').send('OTP Routing Server running.'))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  ws.numbers = new Set()
  ws.authed = false

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }

    // BROWSER must authenticate with ADMIN_KEY before it can wait.
    if (msg.type === 'wait' && msg.number) {
      if (msg.key !== ADMIN_KEY) {
        ws.send(JSON.stringify({ type: 'error', error: 'unauthorized' }))
        return
      }
      ws.authed = true
      const number = normalizeNumber(msg.number)
      if (!number) return
      waits.set(number, {
        ws, field: msg.field || null, session: msg.session || null,
        expiresAt: now() + WAIT_TTL_MS,
      })
      ws.numbers.add(number)
      ws.send(JSON.stringify({ type: 'waiting', number }))
      console.log(`[wait] browser waiting for …${number}`)
      // Freshness: ek naya wait = fresh start. Purana orphan OTP har soorat hata
      // do; sirf bohot recent (race window) wala deliver karo.
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

server.listen(PORT, HOST, () => {
  console.log(`OTP Routing Server listening on http://${HOST}:${PORT}`)
})
