import { useEffect, useMemo, useRef, useState } from 'react'

const OTP_LENGTH = 6

// Make a short, easy-to-type pairing code like "K7P2Q9".
function makeSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no confusing 0/O, 1/I
  let out = ''
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

// Default the server host to whatever host served this page, so opening the
// app from another device on the LAN "just works". Port defaults to 4000.
function defaultServer() {
  const host = window.location.hostname || 'localhost'
  return `${host}:4000`
}

export default function App() {
  const [server, setServer] = useState(
    () => localStorage.getItem('otp.server') || defaultServer(),
  )
  const [session, setSession] = useState(
    () => localStorage.getItem('otp.session') || makeSessionCode(),
  )
  const [digits, setDigits] = useState(() => Array(OTP_LENGTH).fill(''))
  const [status, setStatus] = useState('connecting') // connecting | online | offline
  const [autofilled, setAutofilled] = useState(false)

  const boxes = useRef([])
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  // Persist settings.
  useEffect(() => localStorage.setItem('otp.server', server), [server])
  useEffect(() => localStorage.setItem('otp.session', session), [session])

  // The URL the phone should hit. {text} is a placeholder most SMS-forwarder
  // apps replace with the full message body.
  const forwardUrl = useMemo(
    () => `http://${server}/otp?session=${session}&text={message}`,
    [server, session],
  )

  function fillFromOtp(otp) {
    const clean = String(otp).replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!clean) return
    const next = Array(OTP_LENGTH).fill('')
    for (let i = 0; i < clean.length; i++) next[i] = clean[i]
    setDigits(next)
    setAutofilled(true)
    // Focus the last filled box for a natural feel.
    const idx = Math.min(clean.length, OTP_LENGTH) - 1
    boxes.current[idx]?.focus()
    setTimeout(() => setAutofilled(false), 4000)
  }

  // WebSocket connection + auto-reconnect.
  useEffect(() => {
    let closed = false

    function connect() {
      const ws = new WebSocket(`ws://${server}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('online')
        ws.send(JSON.stringify({ type: 'subscribe', session }))
      }
      ws.onmessage = (e) => {
        let msg
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }
        if (msg.type === 'otp' && msg.otp) fillFromOtp(msg.otp)
      }
      ws.onclose = () => {
        setStatus('offline')
        if (!closed) reconnectRef.current = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }

    setStatus('connecting')
    connect()

    return () => {
      closed = true
      clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [server, session])

  // Manual typing helpers (auto-advance, backspace, paste).
  function onChangeBox(i, value) {
    const v = value.replace(/\D/g, '')
    if (!v) {
      setDigits((d) => d.map((x, idx) => (idx === i ? '' : x)))
      return
    }
    setDigits((d) => {
      const next = [...d]
      // Support pasting several digits into one box.
      const chars = v.split('')
      for (let k = 0; k < chars.length && i + k < OTP_LENGTH; k++) {
        next[i + k] = chars[k]
      }
      return next
    })
    const nextIdx = Math.min(i + v.length, OTP_LENGTH - 1)
    boxes.current[nextIdx]?.focus()
  }

  function onKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      boxes.current[i - 1]?.focus()
    }
  }

  function onPaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text')
    fillFromOtp(text)
  }

  function regenerate() {
    setSession(makeSessionCode())
    setDigits(Array(OTP_LENGTH).fill(''))
    setAutofilled(false)
  }

  function clearOtp() {
    setDigits(Array(OTP_LENGTH).fill(''))
    setAutofilled(false)
    boxes.current[0]?.focus()
  }

  const statusMeta = {
    connecting: { color: 'bg-amber-400', label: 'Connecting…' },
    online: { color: 'bg-emerald-400', label: 'Connected — waiting for OTP' },
    offline: { color: 'bg-rose-500', label: 'Offline — reconnecting…' },
  }[status]

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 shadow-2xl p-6 sm:p-8 backdrop-blur">
          {/* Status */}
          <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
            <span className={`h-2.5 w-2.5 rounded-full ${statusMeta.color} animate-pulse`} />
            {statusMeta.label}
          </div>

          <h1 className="text-2xl font-semibold mb-1">Enter OTP</h1>
          <p className="text-slate-400 text-sm mb-6">
            Code aapke phone par aate hi yahan{' '}
            <span className="text-emerald-400 font-medium">automatically</span> bhar jayega.
          </p>

          {/* OTP boxes */}
          <div
            className="flex justify-between gap-2 mb-3"
            onPaste={onPaste}
          >
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => (boxes.current[i] = el)}
                value={d}
                onChange={(e) => onChangeBox(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                inputMode="numeric"
                maxLength={OTP_LENGTH}
                aria-label={`OTP digit ${i + 1}`}
                className={`w-12 h-14 sm:w-13 sm:h-16 text-center text-2xl font-bold rounded-xl
                  border outline-none transition-all
                  ${autofilled
                    ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 focus:border-indigo-400 focus:bg-slate-800/60'}`}
              />
            ))}
          </div>

          {autofilled && (
            <p className="text-emerald-400 text-sm mb-3 flex items-center gap-1">
              ✓ Auto-filled from your phone
            </p>
          )}

          <div className="flex gap-2 mb-6">
            <button
              onClick={clearOtp}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-medium transition"
            >
              Clear
            </button>
            <button
              onClick={() => alert(`Submitting OTP: ${digits.join('')}`)}
              disabled={digits.some((d) => !d)}
              className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold transition"
            >
              Verify
            </button>
          </div>

          {/* Pairing details */}
          <div className="border-t border-slate-800 pt-5 space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-500">
                Pairing code (phone par yahi bhejna hai)
              </label>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-mono font-bold tracking-widest text-indigo-300">
                  {session}
                </span>
                <button
                  onClick={regenerate}
                  className="ml-auto text-xs text-slate-400 hover:text-slate-200 underline"
                >
                  regenerate
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-slate-500">
                Server address
              </label>
              <input
                value={server}
                onChange={(e) => setServer(e.target.value.trim())}
                placeholder="192.168.1.10:4000"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono focus:border-indigo-400 outline-none"
              />
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                Phone forwarding URL
              </summary>
              <div className="mt-2">
                <code className="block break-all text-xs bg-slate-800 rounded-lg p-3 text-emerald-300">
                  {forwardUrl}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(forwardUrl)}
                  className="mt-2 text-xs text-indigo-300 hover:text-indigo-200 underline"
                >
                  copy URL
                </button>
                <p className="text-xs text-slate-500 mt-2">
                  Apne Android SMS-forwarder app mein is URL ko paste karein.
                  <code className="text-slate-400"> {'{message}'}</code> ko app
                  khud SMS text se replace kar dega.
                </p>
              </div>
            </details>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          OTP Auto-fill · phone → server → desktop, realtime
        </p>
      </div>
    </div>
  )
}
