// ==UserScript==
// @name         OTP Auto-fill (appointment)
// @namespace    otp-autofill-system
// @version      3.3.0
// @description  Auto-requests OTP when a slot is selected, auto-fills the OTP from the phone, and submits when slot + captcha + checkbox are ready. Re-submits on slot change without a new OTP. Robust WebSocket: re-registers the wait on reconnect + keepalive.
// @match        https://pk-gr-services.gvcworld.eu/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict'

  // ====== CONFIG ============================================================
  const WS_URL = 'wss://greeceserver.com/otp-ws'  // VPS server (secure WebSocket)
  const ADMIN_KEY = 'gr-admin-7Kp2Qe9Zx'          // sirf is extension ke paas — secret
  const NUMBER_SELECTOR = '#ind_phonenumber'      // number wala field
  const OTP_SELECTOR = '#onetimepassword'         // OTP wala field
  const TIME_SELECTOR = '#selectedTimeMsg'        // selected time (khaali = koi slot nahi)
  const DATE_SELECTOR = '#selectedDateMsg'        // selected date
  const REQUEST_OTP_TEXT = 'request otp code'     // is text wale element par click = OTP request
  const SUBMIT_TEXT = 'book your appointment'     // submit element ka text
  const CHECKBOX_SELECTOR = '#submitinfo'         // confirm checkbox
  const AUTO_REQUEST_OTP = true                   // slot select hote hi Request-OTP auto-click
  const AUTO_SUBMIT = true                        // sab ready hote hi auto-submit
  // ==========================================================================

  const log = (...a) => console.log('%c[OTP]', 'color:#6366f1;font-weight:bold', ...a)

  // ---- status badge --------------------------------------------------------
  let badgeEl = null
  function badge(text, color = '#6366f1') {
    if (!badgeEl) {
      badgeEl = document.createElement('div')
      badgeEl.style.cssText =
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;font:600 13px system-ui,sans-serif;color:#fff;padding:8px 12px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:background .3s;pointer-events:none'
      document.body.appendChild(badgeEl)
    }
    badgeEl.textContent = '🔑 ' + text
    badgeEl.style.background = color
  }

  function normalizeNumber(raw) { return raw ? String(raw).replace(/\D/g, '').slice(-10) : '' }
  function getNumber() {
    const el = document.querySelector(NUMBER_SELECTOR)
    return el ? normalizeNumber(el.value || el.getAttribute('value')) : ''
  }
  function getTimeText() {
    const el = document.querySelector(TIME_SELECTOR)
    return el ? (el.textContent || '').trim() : ''
  }
  function getDateText() {
    const el = document.querySelector(DATE_SELECTOR)
    return el ? (el.textContent || '').trim() : ''
  }
  function findByText(text) {
    const w = text.toLowerCase()
    const els = document.querySelectorAll('button, a, span, input[type="submit"], input[type="button"]')
    for (const el of els) {
      const t = ((el.textContent || '') + ' ' + (el.value || '')).trim().toLowerCase()
      if (t.includes(w) && t.length < 80 && el.offsetParent !== null) return el
    }
    return null
  }
  function captchaSolved() {
    const tokens = document.querySelectorAll('textarea[name="g-recaptcha-response"]')
    if (tokens.length === 0) return true
    return Array.from(tokens).some((t) => t.value && t.value.length > 0)
  }

  // ---- state ---------------------------------------------------------------
  let hasOtp = false                // abhi koi valid (fresh) OTP filled hai?
  let lastSubmittedTime = ''        // jis time-slot ke liye submit ho chuka
  let lastOtpSlot = ''              // jis slot (date|time) ke liye OTP maanga ja chuka — dobara nahi
  let currentWaitNumber = null      // jis number ka wait chahiye (persist — reconnect par dobara register)

  // ---- WebSocket (robust: re-register on reconnect + keepalive) ------------
  let ws = null, wsReady = false
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    ws = new WebSocket(WS_URL)
    ws.onopen = () => {
      wsReady = true
      log('connected')
      badge(currentWaitNumber ? 'Waiting for OTP …' + currentWaitNumber : 'Connected to server',
            currentWaitNumber ? '#f59e0b' : '#0ea5e9')
      if (currentWaitNumber) registerWait()   // reconnect ke baad wait dobara bhejo
    }
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data) } catch { return }
      if (m.type === 'otp' && m.otp) fillOtp(m.otp)
      if (m.type === 'error') { log('server error:', m.error); badge('Server: ' + m.error, '#ef4444') }
    }
    ws.onclose = () => { wsReady = false; setTimeout(connect, 1500) }
    ws.onerror = () => { try { ws.close() } catch {} }
  }
  function registerWait() {
    if (wsReady && currentWaitNumber) {
      ws.send(JSON.stringify({ type: 'wait', number: currentWaitNumber, key: ADMIN_KEY, field: OTP_SELECTOR, url: location.href }))
      log('waiting for OTP of …' + currentWaitNumber)
      badge('Waiting for OTP …' + currentWaitNumber, '#f59e0b')
    }
  }
  function startWait(number) {
    if (!number) { badge('Number not found on page', '#ef4444'); return }
    currentWaitNumber = number
    if (wsReady) registerWait(); else connect()
  }
  // keepalive — connection ko idle timeout se bachao
  setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })) }, 25000)

  // ---- OTP request (fresh start) -------------------------------------------
  function onRequestOtp() {
    const f = document.querySelector(OTP_SELECTOR)
    if (f) f.value = ''          // purana OTP saaf (freshness)
    hasOtp = false
    lastSubmittedTime = ''
    startWait(getNumber())       // server bhi purana clear karega, fresh wait
  }

  // ---- Fill OTP ------------------------------------------------------------
  function fillOtp(otp) {
    const field = document.querySelector(OTP_SELECTOR)
    if (!field) { log('OTP field not found!'); badge('OTP field not found', '#ef4444'); return }
    field.value = otp
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    field.style.transition = 'background .3s'; field.style.background = '#dcfce7'
    hasOtp = true
    lastSubmittedTime = ''       // naya OTP -> dobara submit allow
    currentWaitNumber = null     // wait poora hua
    log('auto-filled OTP:', otp); badge('OTP filled: ' + otp, '#16a34a')
  }

  // ---- Detect a manual/auto click on the Request-OTP element ----------------
  document.addEventListener('click', (e) => {
    let el = e.target
    for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
      const txt = (el.textContent || '').trim().toLowerCase()
      if (txt.includes(REQUEST_OTP_TEXT) && txt.length < 80) { log('Request-OTP clicked'); onRequestOtp(); break }
    }
  }, true)

  // ---- Loop 1: Request-OTP click — har slot ke liye sirf EK dafa -----------
  //  Button slot select hone par dikhta hai. OTP sirf tab maangte hain jab slot
  //  (date|time) PEHLE wale se mukhtalif ho. Agar wahi slot ka button dobara
  //  (OTP expire par) aaye to dobara OTP NAHI maangte — spam se bachne ke liye.
  setInterval(() => {
    if (!AUTO_REQUEST_OTP) return
    const btn = findByText(REQUEST_OTP_TEXT)
    if (!btn) return
    const timeText = getTimeText()
    if (!timeText) return                          // koi slot select nahi
    const slot = getDateText() + '|' + timeText
    if (slot === lastOtpSlot) return               // is slot ka OTP pehle maang chuke -> skip
    lastOtpSlot = slot
    log('naya slot ' + slot + ' -> Request-OTP auto-click')
    btn.click()   // site ko OTP SMS bhejne ko trigger; click-listener onRequestOtp() chala dega
  }, 500)

  // ---- Loop 2: submit jab sab ready ho -------------------------------------
  //  slot select (time text) + fresh OTP + captcha + checkbox. Time badle to
  //  dobara submit (same OTP, naya OTP nahi).
  setInterval(() => {
    if (!AUTO_SUBMIT) return
    const timeText = getTimeText()
    if (!timeText) return                                  // koi slot select nahi
    const f = document.querySelector(OTP_SELECTOR)
    if (!hasOtp || !f || !f.value || f.value.length < 4) return  // fresh OTP nahi
    if (!captchaSolved()) return                           // captcha nahi
    if (timeText === lastSubmittedTime) return             // is slot ke liye ho chuka

    const cb = document.querySelector(CHECKBOX_SELECTOR)
    if (cb && !cb.checked) {
      cb.click()
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })) }
    }
    if (cb && !cb.checked) return                          // checkbox abhi tick nahi

    const btn = findByText(SUBMIT_TEXT)
    if (btn) {
      btn.click()
      lastSubmittedTime = timeText
      log('submitted for slot', timeText)
      badge('Submitted (' + timeText + ') ✅', '#16a34a')
    } else { badge('Submit btn not found', '#ef4444') }
  }, 500)

  connect()
  log('script loaded on', location.host)
  badge('OTP helper ready', '#6366f1')
})()
