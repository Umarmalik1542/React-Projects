// ==UserScript==
// @name         OTP Auto-fill (appointment)
// @namespace    otp-autofill-system
// @version      1.0.0
// @description  Reads the phone number on the page, asks the routing server to wait, and auto-fills the OTP the moment it arrives from the phone.
// @match        https://CHANGE-ME.example.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict'

  // ====== CONFIG (edit these) ===============================================
  const SERVER = 'localhost:5000'              // laptop ka server (IP:port)
  const NUMBER_SELECTOR = '#ind_phonenumber'   // number wala field
  const OTP_SELECTOR = '#onetimepassword'      // OTP wala field
  const REQUEST_OTP_TEXT = 'request otp code'  // is text wale element par click = OTP request
  const SUBMIT_SELECTOR = null                 // Submit/Verify button (abhi pata nahi -> baad mein)
  const AUTO_SUBMIT = true                     // OTP + captcha ready hote hi submit
  // ==========================================================================

  const log = (...a) => console.log('%c[OTP]', 'color:#6366f1;font-weight:bold', ...a)

  function normalizeNumber(raw) {
    if (!raw) return ''
    return String(raw).replace(/\D/g, '').slice(-10)
  }

  function getNumber() {
    const el = document.querySelector(NUMBER_SELECTOR)
    return el ? normalizeNumber(el.value || el.getAttribute('value')) : ''
  }

  // ---- WebSocket to the routing server -------------------------------------
  let ws = null
  let wsReady = false
  let pendingWaitNumber = null

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    ws = new WebSocket(`ws://${SERVER}/ws`)
    ws.onopen = () => {
      wsReady = true
      log('connected to server')
      if (pendingWaitNumber) sendWait(pendingWaitNumber)
    }
    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.type === 'otp' && msg.otp) fillOtp(msg.otp)
    }
    ws.onclose = () => { wsReady = false; setTimeout(connect, 2000) }
    ws.onerror = () => ws.close()
  }

  function sendWait(number) {
    if (!number) return
    if (wsReady) {
      ws.send(JSON.stringify({ type: 'wait', number, field: OTP_SELECTOR, url: location.href }))
      log('waiting for OTP of number …' + number)
      pendingWaitNumber = null
    } else {
      pendingWaitNumber = number
      connect()
    }
  }

  // ---- Fill the OTP field --------------------------------------------------
  function fillOtp(otp) {
    const field = document.querySelector(OTP_SELECTOR)
    if (!field) { log('OTP field not found!'); return }
    field.value = otp
    // React/parsley-style frameworks ko batao ke value badli hai
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    field.style.transition = 'background .3s'
    field.style.background = '#dcfce7'
    log('auto-filled OTP:', otp)
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
    // Agar page par reCAPTCHA hai to uska token check karo; warna solved samjho.
    const tokens = document.querySelectorAll('textarea[name="g-recaptcha-response"]')
    if (tokens.length === 0) return true
    return Array.from(tokens).some((t) => t.value && t.value.length > 0)
  }

  function maybeSubmit() {
    if (!AUTO_SUBMIT || !SUBMIT_SELECTOR) return
    let tries = 0
    const timer = setInterval(() => {
      tries++
      const otpField = document.querySelector(OTP_SELECTOR)
      const otpReady = otpField && otpField.value && otpField.value.length >= 4
      if (otpReady && captchaSolved()) {
        const btn = document.querySelector(SUBMIT_SELECTOR)
        if (btn) { btn.click(); log('submitted ✅') }
        clearInterval(timer)
      }
      if (tries > 120) clearInterval(timer) // ~60s baad ruk jao
    }, 500)
  }

  log('script loaded on', location.host)
})()
