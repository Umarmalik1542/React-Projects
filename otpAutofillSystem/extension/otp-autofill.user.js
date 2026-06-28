// ==UserScript==
// @name         OTP Auto-fill (appointment)
// @namespace    otp-autofill-system
// @version      2.1.0
// @description  Reads the phone number on the page, asks the routing server to wait, and auto-fills the OTP the moment it arrives from the phone. Optional auto-submit once OTP + captcha are ready.
// @match        https://pk-gr-services.gvcworld.eu/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict'

  // ====== CONFIG ============================================================
  const WS_URL = 'wss://greeceserver.com/otp-ws'  // VPS server (secure WebSocket)
  const ADMIN_KEY = 'gr-admin-7Kp2Qe9Zx'          // sirf is extension ke paas — secret rakhein
  const NUMBER_SELECTOR = '#ind_phonenumber'      // number wala field
  const OTP_SELECTOR = '#onetimepassword'         // OTP wala field
  const REQUEST_OTP_TEXT = 'request otp code'     // is text wale element par click = OTP request
  const SUBMIT_TEXT = 'book your appointment'     // is text wale element par click = submit
  const CHECKBOX_SELECTOR = '#submitinfo'         // confirm checkbox — submit se pehle tick hoga
  const AUTO_SUBMIT = true                        // OTP + captcha + checkbox ready hote hi submit
  // ==========================================================================

  const log = (...a) => console.log('%c[OTP]', 'color:#6366f1;font-weight:bold', ...a)

  // ---- Small on-screen status badge ----------------------------------------
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

  function normalizeNumber(raw) {
    if (!raw) return ''
    return String(raw).replace(/\D/g, '').slice(-10)
  }
  function getNumber() {
    const el = document.querySelector(NUMBER_SELECTOR)
    return el ? normalizeNumber(el.value || el.getAttribute('value')) : ''
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

  // ---- WebSocket to the routing server -------------------------------------
  let ws = null
  let wsReady = false
  let pendingWaitNumber = null

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    ws = new WebSocket(WS_URL)
    ws.onopen = () => {
      wsReady = true
      log('connected to server')
      badge('Connected to server', '#0ea5e9')
      if (pendingWaitNumber) sendWait(pendingWaitNumber)
    }
    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.type === 'otp' && msg.otp) fillOtp(msg.otp)
      if (msg.type === 'error') { log('server error:', msg.error); badge('Server: ' + msg.error, '#ef4444') }
    }
    ws.onclose = () => { wsReady = false; setTimeout(connect, 2000) }
    ws.onerror = () => ws.close()
  }

  function sendWait(number) {
    if (!number) { badge('Number not found on page', '#ef4444'); return }
    if (wsReady) {
      ws.send(JSON.stringify({ type: 'wait', number, key: ADMIN_KEY, field: OTP_SELECTOR, url: location.href }))
      log('waiting for OTP of number …' + number)
      badge('Waiting for OTP …' + number, '#f59e0b')
      pendingWaitNumber = null
    } else {
      pendingWaitNumber = number
      connect()
    }
  }

  function fillOtp(otp) {
    const field = document.querySelector(OTP_SELECTOR)
    if (!field) { log('OTP field not found!'); badge('OTP field not found', '#ef4444'); return }
    field.value = otp
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    field.style.transition = 'background .3s'
    field.style.background = '#dcfce7'
    log('auto-filled OTP:', otp)
    badge('OTP filled: ' + otp, '#16a34a')
    maybeSubmit()
  }

  // ---- Detect the "Request OTP" click --------------------------------------
  document.addEventListener('click', (e) => {
    let el = e.target
    for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
      const txt = (el.textContent || '').trim().toLowerCase()
      if (txt.includes(REQUEST_OTP_TEXT) && txt.length < 80) {
        const number = getNumber()
        log('Request-OTP clicked, number =', number)
        sendWait(number)
        break
      }
    }
  }, true)

  // ---- Auto-submit when OTP + captcha are both ready -----------------------
  function captchaSolved() {
    const tokens = document.querySelectorAll('textarea[name="g-recaptcha-response"]')
    if (tokens.length === 0) return true
    return Array.from(tokens).some((t) => t.value && t.value.length > 0)
  }

  let submitting = false
  function maybeSubmit() {
    if (!AUTO_SUBMIT || submitting) return
    submitting = true
    let tries = 0
    const timer = setInterval(() => {
      tries++
      const otpField = document.querySelector(OTP_SELECTOR)
      const otpReady = otpField && otpField.value && otpField.value.length >= 4
      if (otpReady && captchaSolved()) {
        // Tick the confirmation checkbox (if present) before submitting.
        const cb = document.querySelector(CHECKBOX_SELECTOR)
        if (cb && !cb.checked) {
          cb.click()
          if (!cb.checked) {
            cb.checked = true
            cb.dispatchEvent(new Event('click', { bubbles: true }))
            cb.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }
        // Submit only once the checkbox is actually checked (or there is none).
        if (!cb || cb.checked) {
          const btn = findByText(SUBMIT_TEXT)
          if (btn) { btn.click(); log('submitted ✅'); badge('Submitted ✅', '#16a34a') }
          else { log('submit element not found'); badge('Submit btn not found', '#ef4444') }
          clearInterval(timer)
          submitting = false
        }
      }
      if (tries > 120) { clearInterval(timer); submitting = false }
    }, 500)
  }

  // Connect right away so the WebSocket is ready before the OTP request.
  connect()
  log('script loaded on', location.host)
  badge('OTP helper ready', '#6366f1')
})()
