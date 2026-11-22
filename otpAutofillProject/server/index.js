// OTP Auto-fill relay server
// --------------------------------------------------------------------------
// Flow:
//   1. Desktop browser opens a WebSocket and "subscribes" with a session code.
//   2. The phone (an SMS-forwarder app or any HTTP client) sends the incoming
//      SMS text to POST/GET /otp with the SAME session code.
//   3. The server extracts the numeric OTP from the text and instantly pushes
//      it over WebSocket to every desktop subscribed to that session.
//
// No database, no external accounts. Everything is kept in memory and is
// reachable on your local network.

import http from 'http'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT || 4000

// sessionCode -> Set<WebSocket>  (the desktop clients waiting for an OTP)
const sessions = new Map()

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Pull the most likely OTP out of an SMS body.
// Matches a standalone run of 4-8 digits (e.g. "Your code is 482913").
function extractOtp(text) {
  if (!text) return null
  const str = String(text)
  // Prefer a 4-8 digit group that is not glued to other digits.
  const match = str.match(/\b(\d{4,8})\b/)
  if (match) return match[1]
  // Fallback: any run of digits.
  const loose = str.match(/(\d{4,8})/)
  return loose ? loose[1] : null
}

function pushToSession(session, otp) {
  const clients = sessions.get(session)
  if (!clients || clients.size === 0) return 0
  const payload = JSON.stringify({ type: 'otp', otp, at: Date.now() })
  let delivered = 0
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload)
      delivered++
    }
  }
  return delivered
}

// Phone hits this endpoint. Supports both POST (JSON / form) and GET (query),
// because most SMS-forwarder apps only do simple GET/POST with templated URLs.
function handleOtp(req, res) {
  const data = { ...req.query, ...req.body }
  const session = (data.session || data.s || '').toString().trim().toUpperCase()
  // Accept either an already-clean otp, or the full SMS text to parse.
  const otp = extractOtp(data.otp || data.code || data.text || data.message || data.body)

  if (!session) {
    return res.status(400).json({ ok: false, error: 'Missing "session" code.' })
  }
  if (!otp) {
    return res.status(400).json({ ok: false, error: 'Could not find an OTP in the message.' })
  }

  const delivered = pushToSession(session, otp)
  console.log(`[otp] session=${session} otp=${otp} delivered=${delivered}`)
  return res.json({ ok: true, session, otp, delivered })
}

app.post('/otp', handleOtp)
app.get('/otp', handleOtp)

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size })
})

app.get('/', (_req, res) => {
  res.type('text').send('OTP Auto-fill relay server is running. POST/GET /otp with ?session=CODE&text=SMS')
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  ws.session = null

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'subscribe' && msg.session) {
      const session = msg.session.toString().trim().toUpperCase()
      // Detach from any previous session first.
      if (ws.session && sessions.has(ws.session)) {
        sessions.get(ws.session).delete(ws)
      }
      ws.session = session
      if (!sessions.has(session)) sessions.set(session, new Set())
      sessions.get(session).add(ws)
      ws.send(JSON.stringify({ type: 'subscribed', session }))
      console.log(`[ws] subscribed session=${session} (clients=${sessions.get(session).size})`)
    }
  })

  ws.on('close', () => {
    if (ws.session && sessions.has(ws.session)) {
      const set = sessions.get(ws.session)
      set.delete(ws)
      if (set.size === 0) sessions.delete(ws.session)
    }
  })

  // Keep-alive ping so idle connections through routers stay open.
  ws.send(JSON.stringify({ type: 'hello' }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OTP relay server listening on http://0.0.0.0:${PORT}`)
  console.log(`WebSocket endpoint: ws://<this-machine-ip>:${PORT}/ws`)
})
