// ============================================================================
//  OTP Routing Server  (Phase 1)
// ----------------------------------------------------------------------------
//  Job: an OTP arrives from a PHONE (with its number). A BROWSER somewhere is
//  waiting for the OTP of that same number. This server matches them by phone
//  number and instantly pushes the OTP to the right browser.
//
//  Key rules (decided with the user):
//    - Routing key  = phone number (normalized to last 10 digits)
//    - 1 number     = 1 browser  (no mix-ups)
//    - Each "Send OTP" click = a fresh, short-lived WAIT (TTL), consumed on
//      delivery. Latest wait for a number wins.
//    - If an OTP lands a moment before the browser registers its wait, we keep
//      it briefly so the late-arriving wait still gets it.
//
//  No database. Everything is in memory and meant for your local network.
// ============================================================================

import http from 'http'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT || 5000

// How long a browser's "I'm waiting" stays valid before it expires.
const WAIT_TTL_MS = 5 * 60 * 1000 // 5 minutes
// How long an OTP that arrived with NO waiting browser is held, in case the
// browser registers a moment late.
const ORPHAN_OTP_TTL_MS = 90 * 1000 // 90 seconds

// --- State (in memory) ------------------------------------------------------
// number -> { ws, session, field, url, requestedAt, expiresAt }
const waits = new Map()
// number -> { otp, at }   (OTPs that arrived before any browser was waiting)
const orphanOtps = new Map()

// --- Helpers ----------------------------------------------------------------

// Normalize ANY phone-number format to a single canonical key.
// "+92 300-1234567", "923001234567", "03001234567"  ->  "3001234567"
function normalizeNumber(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  return digits.slice(-10) // last 10 digits = the real subscriber number
}

// Pull a 4-8 digit OTP out of an SMS body (or accept an already-clean code).
function extractOtp(raw) {
  if (!raw) return null
  const str = String(raw)
  const m = str.match(/\b(\d{4,8})\b/) || str.match(/(\d{4,8})/)
  return m ? m[1] : null
}

function now() {
  return Date.now()
}

// Send an OTP to a specific waiting browser, then consume that wait.
function deliver(number, otp) {
  const wait = waits.get(number)
  if (!wait) return false
  const open = wait.ws && wait.ws.readyState === wait.ws.OPEN
  if (open) {
    wait.ws.send(JSON.stringify({ type: 'otp', number, otp, at: now() }))
  }
  waits.delete(number) // consume: one wait -> one OTP
  return open
}

// Periodic cleanup of expired waits / orphan OTPs.
setInterval(() => {
  const t = now()
  for (const [num, w] of waits) {
    if (w.expiresAt <= t) waits.delete(num)
  }
  for (const [num, o] of orphanOtps) {
    if (t - o.at > ORPHAN_OTP_TTL_MS) orphanOtps.delete(num)
  }
}, 10 * 1000)

// --- HTTP API ---------------------------------------------------------------
const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// The PHONE app posts the OTP here.
// Body/query: { number, otp }  (otp may be the raw SMS text — we extract it)
function handleOtp(req, res) {
  const data = { ...req.query, ...req.body }
  const number = normalizeNumber(data.number || data.phone || data.n)
  const otp = extractOtp(data.otp || data.code || data.text || data.message || data.body)

  if (!number) return res.status(400).json({ ok: false, error: 'Missing "number".' })
  if (!otp) return res.status(400).json({ ok: false, error: 'No OTP found in message.' })

  const deliveredToBrowser = deliver(number, otp)
  if (!deliveredToBrowser) {
    // No browser waiting yet — hold the OTP briefly for a late registration.
    orphanOtps.set(number, { otp, at: now() })
  }
  console.log(`[otp] number=…${number} otp=${otp} delivered=${deliveredToBrowser}`)
  return res.json({ ok: true, number, otp, delivered: deliveredToBrowser })
}
app.post('/otp', handleOtp)
app.get('/otp', handleOtp)

// Optional: the phone app announces which number it handles (handy for debugging).
app.post('/register/phone', (req, res) => {
  const number = normalizeNumber(req.body.number)
  if (!number) return res.status(400).json({ ok: false, error: 'Missing "number".' })
  console.log(`[phone] registered number=…${number}`)
  return res.json({ ok: true, number })
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, waiting: waits.size, orphanOtps: orphanOtps.size })
})

app.get('/', (_req, res) => {
  res
    .type('text')
    .send('OTP Routing Server is running. Phone -> POST /otp {number, otp}. Browser -> WebSocket /ws.')
})

// --- WebSocket (the BROWSER side) ------------------------------------------
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  ws.numbers = new Set() // numbers this socket is currently waiting for

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Browser clicked "Send OTP": start waiting for this number's OTP.
    if (msg.type === 'wait' && msg.number) {
      const number = normalizeNumber(msg.number)
      if (!number) return

      // latest-wins: replace any previous wait for this number.
      waits.set(number, {
        ws,
        session: msg.session || null,
        field: msg.field || null,
        url: msg.url || null,
        requestedAt: now(),
        expiresAt: now() + WAIT_TTL_MS,
      })
      ws.numbers.add(number)
      ws.send(JSON.stringify({ type: 'waiting', number }))
      console.log(`[wait] browser waiting for …${number}`)

      // Did an OTP for this number arrive just before we registered? Deliver it.
      const orphan = orphanOtps.get(number)
      if (orphan && now() - orphan.at <= ORPHAN_OTP_TTL_MS) {
        orphanOtps.delete(number)
        deliver(number, orphan.otp)
        console.log(`[wait] delivered held OTP for …${number}`)
      }
    }

    // Browser cancels waiting (e.g. user left the page).
    if (msg.type === 'cancel' && msg.number) {
      const number = normalizeNumber(msg.number)
      const w = waits.get(number)
      if (w && w.ws === ws) waits.delete(number)
      ws.numbers.delete(number)
    }
  })

  ws.on('close', () => {
    // Drop any waits owned by this socket.
    for (const number of ws.numbers) {
      const w = waits.get(number)
      if (w && w.ws === ws) waits.delete(number)
    }
  })

  ws.send(JSON.stringify({ type: 'hello' }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OTP Routing Server listening on http://0.0.0.0:${PORT}`)
  console.log(`  Phone:   POST http://<laptop-ip>:${PORT}/otp   { number, otp }`)
  console.log(`  Browser: WebSocket ws://<laptop-ip>:${PORT}/ws`)
})
